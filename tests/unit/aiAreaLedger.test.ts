// AI Area accounting against a real Postgres engine (PGlite, in process): migration 0003's tables, atomic
// allowances, the Preview SerpApi smoke-test policy, metered model calls, run locks and chunk leases.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
}));

import { migration as aiArea } from "@/db/migrations/0003_ai_area";
import { migration as accountCredentials } from "@/db/migrations/0005_account_credentials";
import { saveCredential } from "@/lib/credentials/store";
import { allowanceState, takeAllowance, CapReached } from "@/lib/providers/ledger";
import { llmDecision, serpDecision } from "@/lib/providers/policy";
import { SerpRefused, serpSearch, type SerpKey } from "@/lib/providers/serpapi";
import { LlmRefused, meteredCall } from "@/lib/providers/llm";
import { PRICING_VERSION } from "@/lib/providers/pricing";
import { claimRun, finishRun, releaseRun, startRun, RunInProgress, STALE_MS } from "@/lib/ai-area/runs";
import { trackKeyword } from "@/lib/ai-area/tracking/run";
import { estimateTracking } from "@/lib/ai-area/tracking/job";
import { defaultConfig } from "@/lib/ai-area/tracking/store";

const KEY: SerpKey = { key: "test-key-not-real", source: "account", fingerprint: "fp-test" };
const ctx = (projectId: number) => ({ userId: 1, projectId, runId: "run-1", key: KEY });

async function usageRows(projectId?: number) {
  const r = await pg.query<{ provider: string; status: string; operation: string; est_cost_usd: number | null; pricing_version: string | null; input_tokens: number | null }>(
    `SELECT provider, status, operation, est_cost_usd, pricing_version, input_tokens FROM provider_usage ${projectId ? "WHERE project_id = $1" : ""} ORDER BY id`,
    projectId ? [projectId] : [],
  );
  return r.rows;
}

const fetchMock = vi.fn();

beforeAll(async () => {
  await pg.exec(`CREATE TABLE users (id BIGSERIAL PRIMARY KEY, email TEXT); CREATE TABLE projects (id BIGSERIAL PRIMARY KEY, user_id BIGINT, serpapi_key TEXT, serpapi_key_updated_at BIGINT);
    INSERT INTO users (email) VALUES ('owner@example.com'); INSERT INTO projects (user_id) VALUES (1), (1);`);
  for (const s of aiArea.statements) await pg.exec(s);
  for (const s of accountCredentials.statements) await pg.exec(s);
});

beforeEach(async () => {
  await pg.exec("DELETE FROM provider_usage; DELETE FROM provider_allowances; DELETE FROM ai_runs;");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ search_metadata: { status: "Success" }, organic_results: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PREVIEW_SERPAPI_TEST_PROJECT_ID", "1");
  vi.stubEnv("PREVIEW_SERPAPI_TEST_MAX_REQUESTS", "5");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Preview SerpApi policy", () => {
  it("allows only the smoke-test project, never more than 5 requests", async () => {
    const d = await serpDecision(1, 1);
    expect(d.allowed && d.allowances[0]).toMatchObject({ key: "preview-serpapi-test:total", max: 5, syncMax: false });
    expect((await serpDecision(1, 2)).allowed).toBe(false);
    const capped = await serpDecision(1, 1, { VERCEL_ENV: "preview", PREVIEW_SERPAPI_TEST_PROJECT_ID: "1", PREVIEW_SERPAPI_TEST_MAX_REQUESTS: "50" });
    expect(capped.allowed && capped.allowances[0].max).toBe(5);
    expect((await serpDecision(1, 1, { VERCEL_ENV: "preview" })).allowed).toBe(false);
  });

  it("changing the test project keeps the cumulative allowance: earlier usage on the old project still counts", async () => {
    // Before the change: 3 requests were recorded against the old per-project allowance for project 1 (e.g. Wewine).
    await pg.exec("INSERT INTO provider_allowances (key, max_units, used_units, note, created_at, updated_at) VALUES ('preview-serpapi-test:project:1', 5, 3, 'old', 0, 0)");
    await pg.exec("INSERT INTO provider_usage (user_id, project_id, provider, operation, units, unit_type, status, created_at) VALUES (1, 1, 'serpapi', 'google', 1, 'search', 'ok', 1)");
    const env = { VERCEL_ENV: "preview", PREVIEW_SERPAPI_TEST_PROJECT_ID: "2", PREVIEW_SERPAPI_TEST_MAX_REQUESTS: "5" };
    const d = await serpDecision(1, 2, env);
    expect(d.allowed).toBe(true);
    expect(await allowanceState("preview-serpapi-test:total")).toEqual({ used: 3, max: 5 });
    // Raising the configured maximum or calling again never resets or grants more.
    await serpDecision(1, 2, { ...env, PREVIEW_SERPAPI_TEST_MAX_REQUESTS: "50" });
    expect(await allowanceState("preview-serpapi-test:total")).toEqual({ used: 3, max: 5 });
    // The old project is now refused; the new one gets only the 2 that remain.
    expect((await serpDecision(1, 1, env)).allowed).toBe(false);
    const { takeAllowances } = await import("@/lib/providers/ledger");
    if (d.allowed) {
      await takeAllowances(d.allowances, 2);
      await expect(takeAllowances(d.allowances, 1)).rejects.toThrow();
    }
    expect(await allowanceState("preview-serpapi-test:total")).toEqual({ used: 5, max: 5 });
    // History is untouched.
    expect((await pg.query("SELECT used_units FROM provider_allowances WHERE key = 'preview-serpapi-test:project:1'")).rows[0]).toEqual({ used_units: 3 });
    expect((await pg.query("SELECT COUNT(*)::int AS n FROM provider_usage")).rows[0]).toEqual({ n: 1 });
  });

  it("usage across several earlier projects is summed and capped at the maximum", async () => {
    await pg.exec("INSERT INTO provider_allowances (key, max_units, used_units, note, created_at, updated_at) VALUES ('preview-serpapi-test:project:1', 5, 4, 'old', 0, 0), ('preview-serpapi-test:project:9', 5, 4, 'old', 0, 0)");
    await serpDecision(1, 1);
    expect(await allowanceState("preview-serpapi-test:total")).toEqual({ used: 5, max: 5 });
  });

  it("refuses other projects without sending or recording anything", async () => {
    await expect(serpSearch({ engine: "google", q: "x" }, ctx(2))).rejects.toBeInstanceOf(SerpRefused);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await usageRows()).toHaveLength(0);
  });

  it("stops at 5 requests in total, counting failed requests (retries) too", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "Internal error" }), { status: 500 }));
    const outcomes: string[] = [];
    for (let i = 0; i < 7; i++) {
      try {
        await serpSearch({ engine: "google", q: `q${i}` }, ctx(1));
        outcomes.push("ok");
      } catch (e) {
        outcomes.push(e instanceof SerpRefused ? "refused" : "error");
      }
    }
    expect(outcomes).toEqual(["error", "ok", "ok", "ok", "ok", "refused", "refused"]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const rows = await usageRows(1);
    expect(rows.map((r) => r.status)).toEqual(["error", "ok", "ok", "ok", "ok"]);
    expect(await allowanceState("preview-serpapi-test:total")).toEqual({ used: 5, max: 5 });
  });

  it("can't be overshot by concurrent requests", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => serpSearch({ engine: "google", q: `c${i}` }, ctx(1))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof SerpRefused)).toHaveLength(7);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("doesn't refill when work resumes: what was used before still counts", async () => {
    for (let i = 0; i < 3; i++) await serpSearch({ engine: "google", q: `a${i}` }, ctx(1));
    // A later session (new run, new process) reads the same allowance.
    const later = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => serpSearch({ engine: "google", q: `b${i}` }, { ...ctx(1), runId: "run-2" })));
    expect(later.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("allowance updates are atomic at the database level", async () => {
    const takes = await Promise.allSettled(Array.from({ length: 20 }, () => takeAllowance("k", 1, 3, "test")));
    expect(takes.filter((t) => t.status === "fulfilled")).toHaveLength(3);
    expect(takes.filter((t) => t.status === "rejected" && t.reason instanceof CapReached)).toHaveLength(17);
  });
});

describe("Preview model calls", () => {
  it("are refused, even with the broader Preview external-writes switch on", async () => {
    vi.stubEnv("ALLOW_PREVIEW_EXTERNAL_WRITES", "1");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
    expect((await llmDecision(1)).allowed).toBe(false);
    const call = vi.fn();
    await expect(meteredCall({ userId: 1, projectId: 1 }, "openai", "t", "gpt-4o-mini", { input: 10, output: 10 }, call)).rejects.toBeInstanceOf(LlmRefused);
    expect(call).not.toHaveBeenCalled();
    expect(await usageRows()).toHaveLength(0);
  });
});

describe("metered model calls (outside Preview)", () => {
  beforeEach(async () => {
    vi.stubEnv("VERCEL_ENV", "");
    // The account's own OpenAI key, stored encrypted; the resolver hands it to the call.
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    await pg.exec("DELETE FROM account_credentials;");
    await saveCredential(1, "openai", { apiKey: "sk-test-not-real" });
    vi.stubEnv("AI_AREA_DAILY_USD_LIMIT", "0.01");
  });

  it("records tokens and an estimated cost with the pricing version, and corrects the allowance to it", async () => {
    const out = await meteredCall({ userId: 1, projectId: 1 }, "openai", "brand-analysis", "gpt-4o-mini", { input: 5000, output: 800 }, async () => ({
      result: "ok",
      usage: { input: 1000, output: 100 },
    }));
    expect(out.result).toBe("ok");
    const expected = (1000 * 0.15 + 100 * 0.6) / 1_000_000;
    expect(out.costUsd).toBeCloseTo(expected, 10);
    const [row] = await usageRows();
    expect(row).toMatchObject({ provider: "openai", status: "ok", pricing_version: PRICING_VERSION });
    expect(Number(row.input_tokens)).toBe(1000);
    const day = new Date().toISOString().slice(0, 10);
    expect((await allowanceState(`llm-usd:user:1:${day}`))?.used).toBeCloseTo(expected, 10);
  });

  it("refuses a call whose expected cost doesn't fit the daily limit, before calling", async () => {
    const call = vi.fn();
    // gpt-5.5: 8000 in + 1000 out ≈ $0.07, over the $0.01 limit.
    await expect(meteredCall({ userId: 1, projectId: 1 }, "openai", "t", "gpt-5.5", { input: 8000, output: 1000 }, call)).rejects.toMatchObject({ reason: "cap" });
    expect(call).not.toHaveBeenCalled();
  });

  it("records a failed call and keeps its reservation (the provider may have billed it)", async () => {
    await expect(
      meteredCall({ userId: 1, projectId: 1 }, "openai", "t", "gpt-4o-mini", { input: 5000, output: 800 }, async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
    expect((await usageRows()).map((r) => r.status)).toEqual(["error"]);
    const day = new Date().toISOString().slice(0, 10);
    expect((await allowanceState(`llm-usd:user:1:${day}`))?.used).toBeGreaterThan(0);
  });

  it("refuses when the provider key isn't configured", async () => {
    await expect(meteredCall({ userId: 1, projectId: 1 }, "anthropic", "t", "claude-haiku-5-5", { input: 1, output: 1 }, vi.fn())).rejects.toMatchObject({ reason: "not-configured" });
  });
});

describe("run locks", () => {
  it("allows one running run per project and kind", async () => {
    const id = await startRun(1, 1, "tracking", "manual", {});
    await expect(startRun(1, 1, "tracking", "manual", {})).rejects.toBeInstanceOf(RunInProgress);
    // Another kind or another project isn't blocked.
    await expect(startRun(1, 1, "brand", "manual", {})).resolves.toBeTruthy();
    await expect(startRun(1, 2, "tracking", "manual", {})).resolves.toBeTruthy();
    await finishRun(id, "done", {});
    await expect(startRun(1, 1, "tracking", "manual", {})).resolves.toBeTruthy();
  });

  it("concurrent starts produce exactly one run", async () => {
    const starts = await Promise.allSettled(Array.from({ length: 6 }, () => startRun(1, 1, "tracking", "manual", {})));
    expect(starts.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(starts.filter((s) => s.status === "rejected" && s.reason instanceof RunInProgress)).toHaveLength(5);
  });

  it("lets only one request work on a run at a time (chunk lease)", async () => {
    const id = await startRun(1, 1, "tracking", "manual", {});
    const claims = await Promise.all([claimRun(id, 60_000), claimRun(id, 60_000), claimRun(id, 60_000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await releaseRun(id);
    expect(await claimRun(id, 60_000)).toBe(true);
  });

  it("releases an abandoned run", async () => {
    const id = await startRun(1, 1, "tracking", "manual", {});
    await pg.query("UPDATE ai_runs SET started_at = $1 WHERE id = $2", [Date.now() - STALE_MS - 1000, id]);
    await expect(startRun(1, 1, "tracking", "manual", {})).resolves.toBeTruthy();
    const old = await pg.query<{ status: string }>("SELECT status FROM ai_runs WHERE id = $1", [id]);
    expect(old.rows[0].status).toBe("error");
  });
});

describe("tracking estimate and partial stops", () => {
  const config = { ...defaultConfig({ name: "WeWine", websiteUrl: "https://wewine.vn/" }) };
  config.keywords = [{ id: "k1", keyword: "rượu vang", active: true, createdAt: "2026-10-16" }];

  it("estimates one keyword at depth 10 within the 5-request smoke-test allowance", () => {
    const est = estimateTracking(config);
    expect(est.total).toEqual({ min: 2, typical: 3, max: 4 });
  });

  it("keeps page-1 results when a later request is refused", async () => {
    let calls = 0;
    const search = async (params: Record<string, string>) => {
      calls++;
      if (params.engine !== "google") throw new SerpRefused("cap reached");
      return { organic_results: [{ position: 1, title: "WeWine – rượu vang", link: "https://wewine.vn/", displayed_link: "wewine.vn", snippet: "rượu vang" }] };
    };
    const snap = await trackKeyword(config.keywords[0], config.settings, config.brand, search);
    expect(snap.stopped).toBe(true);
    expect(snap.organicResults.length).toBe(1);
    // Page 1 was sent; the refused AI Mode request wasn't.
    expect(snap.searchesUsed).toBe(1);
    expect(calls).toBe(2);
  });
});
