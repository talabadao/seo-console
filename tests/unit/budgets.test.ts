// Budgets & limits: stored limits vs server defaults, validation, account and project limits enforced together
// (with refunds), concurrency, limit changes mid-period, the Preview smoke-test allowance staying intact, usage
// history surviving, and old usage addresses reaching the right Settings page. Real Postgres (PGlite).
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
import { migration as budgetLimits } from "@/db/migrations/0006_budget_limits";
import { BudgetInputError, effectiveLimits, setLimit } from "@/lib/budgets";
import { allowanceState } from "@/lib/providers/ledger";
import { SerpRefused, meterSerpSearch, serpSearch, type SerpKey } from "@/lib/providers/serpapi";
import { buildShellPath, parseShellPath, switchProject } from "@/lib/v2/nav";

const KEY: SerpKey = { key: "test-key-not-real", source: "account", fingerprint: "fp" };
const ctx = (projectId: number) => ({ userId: 1, projectId, runId: null, key: KEY });
const month = new Date().toISOString().slice(0, 7);
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ organic_results: [] }), { status: 200 }));

beforeAll(async () => {
  await pg.exec(`CREATE TABLE users (id BIGSERIAL PRIMARY KEY, email TEXT); CREATE TABLE projects (id BIGSERIAL PRIMARY KEY, user_id BIGINT, name TEXT);
    INSERT INTO users (email) VALUES ('owner@example.com'); INSERT INTO projects (user_id, name) VALUES (1, 'A'), (1, 'B');`);
  for (const s of aiArea.statements) await pg.exec(s);
  for (const s of budgetLimits.statements) await pg.exec(s);
});

beforeEach(async () => {
  await pg.exec("DELETE FROM provider_usage; DELETE FROM provider_allowances; DELETE FROM budget_limits;");
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("AI_AREA_SERPAPI_MONTHLY_CAP", "");
  vi.stubEnv("AI_AREA_DAILY_USD_LIMIT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function send(projectId: number, n: number) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    try {
      await serpSearch({ engine: "google", q: `q${i}` }, ctx(projectId));
      out.push("ok");
    } catch (e) {
      out.push(e instanceof SerpRefused ? "refused" : "error");
    }
  }
  return out;
}

describe("limits", () => {
  it("fall back to the server defaults until set, and say which applies", async () => {
    const l = await effectiveLimits(1, 1);
    const get = (scope: string, metric: string) => l.find((x) => x.scope === scope && x.metric === metric)!;
    expect(get("project", "serpapi_requests_month")).toMatchObject({ value: 500, source: "default" });
    expect(get("account", "model_usd_day")).toMatchObject({ value: 5, source: "default" });
    expect(get("account", "serpapi_requests_month")).toMatchObject({ value: null, source: "default" });
    expect(get("project", "model_usd_month")).toMatchObject({ value: null, source: "default" });
    const set = await setLimit(1, "project", 1, "serpapi_requests_month", 120);
    expect(set).toMatchObject({ value: 120, source: "configured", defaultValue: 500 });
    expect(await setLimit(1, "project", 1, "serpapi_requests_month", null)).toMatchObject({ value: 500, source: "default" });
  });

  it("validates input and never stores a bad value", async () => {
    await expect(setLimit(1, "account", null, "model_usd_day", -1)).rejects.toBeInstanceOf(BudgetInputError);
    await expect(setLimit(1, "account", null, "model_usd_day", Number.NaN)).rejects.toBeInstanceOf(BudgetInputError);
    await expect(setLimit(1, "account", null, "nope", 3)).rejects.toBeInstanceOf(BudgetInputError);
    await expect(setLimit(1, "project", null, "serpapi_requests_month", 3)).rejects.toBeInstanceOf(BudgetInputError);
    expect((await pg.query("SELECT 1 FROM budget_limits")).rows).toHaveLength(0);
    expect(await setLimit(1, "project", 1, "serpapi_requests_month", 7.9)).toMatchObject({ value: 7 });
  });
});

describe("account and project limits together", () => {
  it("stops at whichever is reached first and gives back what a refused request took", async () => {
    await setLimit(1, "project", 1, "serpapi_requests_month", 3);
    await setLimit(1, "account", null, "serpapi_requests_month", 4);
    expect(await send(1, 4)).toEqual(["ok", "ok", "ok", "refused"]);
    // Project B: only one left account-wide.
    expect(await send(2, 2)).toEqual(["ok", "refused"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await allowanceState(`serpapi-month:user:1:${month}`)).toEqual({ used: 4, max: 4 });
    // B's own monthly allowance was refunded for the refused request: 1 used, not 2.
    expect((await allowanceState(`serpapi-month:user:1:project:2:${month}`))!.used).toBe(1);
    expect((await allowanceState(`serpapi-month:user:1:project:1:${month}`))!.used).toBe(3);
  });

  it("holds under concurrent requests", async () => {
    await setLimit(1, "project", 1, "serpapi_requests_month", 3);
    await setLimit(1, "account", null, "serpapi_requests_month", 100);
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => serpSearch({ engine: "google", q: `c${i}` }, ctx(1))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await allowanceState(`serpapi-month:user:1:${month}`))!.used).toBe(3);
  });

  it("applies a changed limit to the current month without resetting what was used", async () => {
    await setLimit(1, "project", 1, "serpapi_requests_month", 3);
    expect(await send(1, 4)).toEqual(["ok", "ok", "ok", "refused"]);
    await setLimit(1, "project", 1, "serpapi_requests_month", 5);
    expect(await send(1, 3)).toEqual(["ok", "ok", "refused"]);
    expect(await allowanceState(`serpapi-month:user:1:project:1:${month}`)).toEqual({ used: 5, max: 5 });
    // Usage history is the ledger, untouched by limit changes.
    expect((await pg.query("SELECT 1 FROM provider_usage")).rows).toHaveLength(5);
  });
});

describe("Maps reviews share the same SerpApi budget", () => {
  it("counts review searches against the project's limit, together with AI Area searches", async () => {
    await setLimit(1, "project", 1, "serpapi_requests_month", 3);
    expect(await send(1, 2)).toEqual(["ok", "ok"]);
    const done = await meterSerpSearch({ userId: 1, projectId: 1, fingerprint: "fp" }, "google_maps_reviews");
    await done(true);
    await expect(meterSerpSearch({ userId: 1, projectId: 1, fingerprint: "fp" }, "google_maps_reviews")).rejects.toBeInstanceOf(SerpRefused);
    const ops = (await pg.query<{ operation: string }>("SELECT operation FROM provider_usage ORDER BY id")).rows.map((r) => r.operation);
    expect(ops).toEqual(["google", "google", "google_maps_reviews"]);
  });
});

describe("Preview smoke-test allowance", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PREVIEW_SERPAPI_TEST_PROJECT_ID", "1");
  });

  it("isn't raised or reset by Settings limits, which can only make it stricter", async () => {
    expect(await send(1, 2)).toEqual(["ok", "ok"]);
    await setLimit(1, "project", 1, "serpapi_requests_month", 1000);
    expect(await allowanceState("preview-serpapi-test:total")).toEqual({ used: 2, max: 5 });
    expect(await send(1, 5)).toEqual(["ok", "ok", "ok", "refused", "refused"]);
    expect(await allowanceState("preview-serpapi-test:total")).toEqual({ used: 5, max: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("a lower project limit applies on top", async () => {
    await setLimit(1, "project", 1, "serpapi_requests_month", 1);
    expect(await send(1, 3)).toEqual(["ok", "refused", "refused"]);
    expect(await allowanceState("preview-serpapi-test:total")).toEqual({ used: 1, max: 5 });
  });
});

describe("account settings addresses", () => {
  it("live at /account, with an optional project filter", () => {
    expect(parseShellPath(["account"])).toEqual({ kind: "account", section: "", projectId: null });
    expect(parseShellPath(["account", "usage"], "?project=17")).toEqual({ kind: "account", section: "usage", projectId: 17 });
    expect(parseShellPath(["account", "nonsense"])).toEqual({ kind: "account", section: "", projectId: null });
    expect(buildShellPath({ kind: "account", section: "budgets", projectId: 4 })).toBe("/account/budgets?project=4");
  });

  it("older addresses land on the same page with the same project, never a fixed one", () => {
    expect(parseShellPath(["p", "4", "ai-area", "usage"])).toEqual({ kind: "account", section: "usage", projectId: 4 });
    expect(parseShellPath(["p", "17", "ai-area", "usage"])).toEqual({ kind: "account", section: "usage", projectId: 17 });
    expect(parseShellPath(["p", "17", "settings", "account", "budgets"])).toEqual({ kind: "account", section: "budgets", projectId: 17 });
    expect(parseShellPath(["p", "17", "settings", "account"])).toEqual({ kind: "account", section: "", projectId: 17 });
    expect(parseShellPath(["portfolio", "ai-area", "usage"])).toEqual({ kind: "account", section: "usage", projectId: null });
    expect(parseShellPath(["portfolio", "settings", "account", "usage"])).toEqual({ kind: "account", section: "usage", projectId: null });
    expect(buildShellPath(parseShellPath(["p", "17", "ai-area", "usage"])!)).toBe("/account/usage?project=17");
  });

  it("stay open when switching projects or choosing All projects", () => {
    const here = parseShellPath(["account", "budgets"], "?project=4")!;
    expect(switchProject(here, 9)).toEqual({ kind: "account", section: "budgets", projectId: 9 });
    expect(switchProject(here, null)).toEqual({ kind: "account", section: "budgets", projectId: null });
  });
});
