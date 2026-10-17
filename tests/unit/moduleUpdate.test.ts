// Module update (2026-10-17): SerpApi readiness states (credential vs verification vs execution permission, the
// Preview smoke-test allowance, last-attempt classification), manual-only datasets never refreshed by reads or the
// scheduler, the SE Ranking Data API spending policy, provider icon mapping and keyword change windows. Real schema
// on PGlite; no provider is called.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { pg } = await vi.hoisted(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  return { pg: new PGlite() };
});
const toPositional = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};
vi.mock("@/lib/db", () => ({
  db: {
    prepare: (sql: string) => ({
      get: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows[0],
      all: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows,
      run: async (...args: unknown[]) => {
        const r = await pg.query(toPositional(sql), args);
        return { count: r.affectedRows ?? 0, rows: r.rows };
      },
    }),
  },
  tableExists: async (name: string) => (await pg.query<{ t: string | null }>("SELECT to_regclass($1) AS t", [`public.${name}`])).rows[0].t != null,
  withTransaction: async <T,>(fn: (q: (sql: string, ...args: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>) =>
    pg.transaction(async (tx) => fn(async (sql, ...args) => (await tx.query(toPositional(sql), args)).rows as Record<string, unknown>[])),
}));

import { BASELINE_STATEMENTS } from "@/lib/schema";
import { MIGRATIONS } from "@/db/migrations";
import { saveCredential, recordVerification, credentialFingerprint } from "@/lib/credentials/store";
import { classifyAttempt, serpReadiness } from "@/lib/providers/serpReadiness";
import { takeAllowance } from "@/lib/providers/ledger";
import { allowanceKeys } from "@/lib/providers/policy";
import { enqueueDueRefreshes, readThrough, registerKind, runJob, enqueue } from "@/lib/sync/cache";
import { linkProfileDecision } from "@/lib/seranking/dataApi";
import { iconForPlatform, iconForSource, PROVIDER_ICONS } from "@/lib/providerIcons";
import { viewReport, type SeRawReport } from "@/lib/seranking/metrics";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const KEY = Buffer.alloc(32, 7).toString("base64");
const preview = (extra: Record<string, string> = {}) => ({ VERCEL_ENV: "preview", CREDENTIALS_ENCRYPTION_KEY: KEY, ...extra });

beforeAll(async () => {
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  await pg.exec(`INSERT INTO users (email, created_at, updated_at, workspace_id, kind) VALUES ('tin@artemisdigital.com', 0, 0, 1, 'person'), ('analytics@artemisdigital.com', 0, 0, 1, 'shared-connection');
    INSERT INTO projects (id, user_id, name, website_url, created_at, updated_at, workspace_id) VALUES (7, 1, 'Wewine', 'https://wewine.vn/', 0, 0, 1), (8, 1, 'Other', 'https://other.example/', 0, 0, 1), (9, 2, 'Theirs', 'https://theirs.example/', 0, 0, 1);`);
});
beforeEach(async () => {
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", KEY);
  await pg.exec("DELETE FROM account_credentials; DELETE FROM provider_allowances; DELETE FROM provider_usage; DELETE FROM sync_jobs; DELETE FROM report_cache;");
});

describe("SerpApi readiness", () => {
  it("no smoke-test project configured on Preview: blocked with the env remedy, even with a verified key", async () => {
    await saveCredential(1, "serpapi", { apiKey: "abc-key-1234" });
    await recordVerification(1, "serpapi", (await credentialFingerprint(1, "serpapi"))!, true, "ok");
    const r = await serpReadiness(1, 7, preview());
    expect(r.credential).toMatchObject({ state: "saved", source: "account", verification: "verified" });
    expect(r.execution).toMatchObject({ allowed: false, code: "preview-no-test-project" });
    expect(r.execution.remedy).toContain("PREVIEW_SERPAPI_TEST_PROJECT_ID");
  });

  it("the test project may search; other projects are refused; the allowance is cumulative", async () => {
    await saveCredential(1, "serpapi", { apiKey: "abc-key-1234" });
    const env = preview({ PREVIEW_SERPAPI_TEST_PROJECT_ID: "7" });
    expect((await serpReadiness(1, 8, env)).execution.code).toBe("preview-other-project");
    const ok = await serpReadiness(1, 7, env);
    expect(ok.execution).toMatchObject({ allowed: true, code: "ok" });
    expect(ok.credential.verification).toBe("not-verified");
    expect(ok.previewAllowance).toEqual({ used: 0, max: 5 });
    await takeAllowance(allowanceKeys.previewSerpTotal(), 5, 5, "Preview SerpApi smoke test");
    const used = await serpReadiness(1, 7, env);
    expect(used.execution).toMatchObject({ allowed: false, code: "preview-allowance-exhausted" });
    expect(used.previewAllowance).toEqual({ used: 5, max: 5 });
    // A new key or a "redeploy" (new env object) doesn't reset it.
    await saveCredential(1, "serpapi", { apiKey: "replacement-key-9" });
    expect((await serpReadiness(1, 7, preview({ PREVIEW_SERPAPI_TEST_PROJECT_ID: "7" }))).execution.code).toBe("preview-allowance-exhausted");
  });

  it("no key: blocked with the credentials remedy", async () => {
    const r = await serpReadiness(1, 7, preview({ PREVIEW_SERPAPI_TEST_PROJECT_ID: "7" }));
    expect(r.credential.state).toBe("missing");
    expect(r.execution).toMatchObject({ allowed: false, code: "no-key" });
  });

  it("reports the last attempt for this project only, classified", async () => {
    await saveCredential(1, "serpapi", { apiKey: "abc-key-1234" });
    await pg.query(
      `INSERT INTO provider_usage (user_id, project_id, provider, operation, units, unit_type, status, error, created_at, completed_at) VALUES
       (1, 7, 'serpapi', 'google', 1, 'search', 'error', 'This SerpApi key has no searches left.', 1, 2),
       (1, 8, 'serpapi', 'google', 1, 'search', 'ok', NULL, 3, 4)`,
    );
    const r = await serpReadiness(1, 7, preview({ PREVIEW_SERPAPI_TEST_PROJECT_ID: "7" }));
    expect(r.lastAttempt).toMatchObject({ code: "out-of-searches", operation: "google" });
    expect(classifyAttempt("error", "SerpApi rejected the API key.")).toBe("invalid-key");
    expect(classifyAttempt("error", "SerpApi is rate-limiting this key (HTTP 429); try again in a minute.")).toBe("rate-limited");
    expect(classifyAttempt("error", "SerpApi didn't answer in time")).toBe("timeout");
    expect(classifyAttempt("error", "fetch failed")).toBe("network");
    expect(classifyAttempt("ok", null)).toBe("ok");
  });
});

describe("manual-only datasets", () => {
  let calls = 0;
  registerKind<{ projectId: number }, { n: number }>({
    kind: "test:manual",
    provider: "fake-paid",
    freshMs: 1000,
    manualOnly: true,
    async run() {
      calls++;
      return { payload: { n: calls } };
    },
  });

  it("plain reads never fetch, cold or stale; the scheduler skips them; only an explicit refresh does", async () => {
    calls = 0;
    const read = (force = false) => readThrough<{ projectId: number }, { n: number }>({ kind: "test:manual", workspaceId: 1, actorUserId: 1, projectId: 7, query: { projectId: 7 }, waitMs: 2000, force });
    expect((await read()).state).toBe("pending");
    expect(calls).toBe(0);
    expect((await read(true)).payload).toEqual({ n: 1 });
    await pg.query("UPDATE report_cache SET fresh_until = 1, last_read_at = $1", [Date.now()]);
    expect(await read()).toMatchObject({ state: "stale", payload: { n: 1 }, refreshing: false });
    expect(await enqueueDueRefreshes({ activeSinceMs: 86_400_000, limit: 10 })).toBe(0);
    expect(calls).toBe(1);
    // A job queued some other way still runs (it's the explicit path's mechanism).
    const id = await enqueue({ kind: "test:manual", workspaceId: 1, actorUserId: 1, projectId: 7, query: { projectId: 7 }, reason: "manual" });
    await pg.query("UPDATE report_cache SET fetched_at = 0");
    expect(await runJob(id)).toBe("done");
    expect(calls).toBe(2);
  });
});

describe("SE Ranking Data API policy", () => {
  it("blocked on Preview and without a budget; allowed with a monthly credit allowance", () => {
    expect(linkProfileDecision(1, { VERCEL_ENV: "preview", SERANKING_DATA_CREDITS_MONTH: "5000" })).toMatchObject({ allowed: false, code: "preview" });
    expect(linkProfileDecision(1, { VERCEL_ENV: "production" })).toMatchObject({ allowed: false, code: "no-budget" });
    const ok = linkProfileDecision(1, { VERCEL_ENV: "production", SERANKING_DATA_CREDITS_MONTH: "3000" }, new Date("2026-10-17T00:00:00Z"));
    expect(ok).toMatchObject({ allowed: true, allowances: [{ key: "seranking-data-month:user:1:2026-10", max: 3000 }] });
  });
});

describe("provider icons", () => {
  it("maps sources and LLM platforms to the supplied local files, unchanged", () => {
    expect(iconForSource("Google Search Console")).toBe("google-search-console");
    expect(iconForSource("Google Analytics 4")).toBe("google-analytics");
    expect(iconForSource("SE Ranking")).toBe("se-ranking");
    expect(iconForSource("Asana")).toBe("asana");
    expect(iconForSource("Stored sync history")).toBeNull();
    for (const id of ["chatgpt", "claude", "copilot", "gemini", "perplexity"]) expect(iconForPlatform(id)).toBe(id);
    expect(iconForPlatform("deepseek")).toBeNull();
    const manifest = JSON.parse(readFileSync(join("public", "icons", "providers", "manifest.json"), "utf8")) as Array<{ id: string; file: string; sha256: string }>;
    for (const [id, icon] of Object.entries(PROVIDER_ICONS)) {
      expect(icon.src.startsWith("/icons/providers/"), id).toBe(true);
      const file = join("public", icon.src);
      expect(existsSync(file), file).toBe(true);
      const entry = manifest.find((m) => m.id === id)!;
      expect(createHash("sha256").update(readFileSync(file)).digest("hex"), id).toBe(entry.sha256);
    }
  });
});

describe("keyword change windows", () => {
  it("1, 7 and 30 days before the latest check; null when either side isn't ranking", () => {
    const days = (n: number) => new Date(Date.parse("2026-10-15T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
    const raw: SeRawReport = {
      site: { id: 1, title: "s", url: "https://s.example/" },
      from: days(40),
      to: days(0),
      engines: [{ id: 1, name: "Google", region: null, language: null, device: null, keywordCount: 2 }],
      groups: [],
      keywords: {
        "1": [
          { id: "a", name: "a", groupId: null, volume: 1, landing: null, features: [], ownFeatures: [], positions: [{ date: days(30), pos: 20 }, { date: days(7), pos: 9 }, { date: days(1), pos: 6 }, { date: days(0), pos: 4 }] },
          { id: "b", name: "b", groupId: null, volume: 1, landing: null, features: [], ownFeatures: [], positions: [{ date: days(30), pos: 0 }, { date: days(0), pos: 12 }] },
        ],
      },
    };
    const [a, b] = viewReport(raw, { compareDays: 7 }).keywords;
    expect([a.change1, a.change7, a.change30]).toEqual([2, 5, 16]);
    expect([b.change1, b.change7, b.change30]).toEqual([null, null, null]);
    expect(a.recent).toHaveLength(4);
  });
});
