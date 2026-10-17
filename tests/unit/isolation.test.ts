// Account isolation, at the route level, on the real schema (baseline + every migration, PGlite). Two allowlisted
// accounts: A owns project 1 (with a GSC property, GA4 property, KPI targets, lead events, SE Ranking mapping,
// tracking config, an Organic SERP snapshot, saved results in the shared cache, a PageSpeed page, a notification,
// an encrypted SerpApi key and a project budget). Signed in as B, every project-scoped route is called with A's ids
// — reads and writes — and must not return A's data or change it. Account-scoped routes must show B only B's
// rows. A 401 for "no session" isn't the evidence here: every call below is authenticated (as B).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
    exec: async (sql: string) => pg.exec(sql),
  },
  tableExists: async (name: string) => (await pg.query<{ t: string | null }>("SELECT to_regclass($1) AS t", [`public.${name}`])).rows[0].t != null,
  withTransaction: async <T,>(fn: (q: (sql: string, ...args: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>) =>
    pg.transaction(async (tx) => fn(async (sql, ...args) => (await tx.query(toPositional(sql), args)).rows as Record<string, unknown>[])),
  rawSql: async () => {
    throw new Error("rawSql not available in tests");
  },
}));

let acting: Record<string, unknown> | null = null;
vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return { ...actual, currentUser: async () => acting };
});
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: () => {} };
});
// No network: anything that tries to reach a provider fails loudly.
vi.stubGlobal("fetch", async (url: unknown) => {
  throw new Error(`network blocked in isolation tests: ${String(url)}`);
});

import { NextRequest } from "next/server";
import { BASELINE_STATEMENTS } from "@/lib/schema";
import { MIGRATIONS } from "@/db/migrations";
import { saveCredential, readCredential } from "@/lib/credentials/store";

const KEY = Buffer.alloc(32, 5).toString("base64");
const A = 1;
const B = 2;
const B_PROJECT = 2;

async function as(userId: number) {
  acting = (await pg.query("SELECT * FROM users WHERE id = $1", [userId])).rows[0] as Record<string, unknown>;
}
const req = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

type Handler = (r: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(mod: Record<string, unknown>, method: string, path: string, params: Record<string, string> = {}, body?: unknown) {
  const h = mod[method] as Handler | undefined;
  if (!h) throw new Error(`${path} has no ${method}`);
  const res = await h(req(path, method, body), ctx(params));
  const text = await res.text();
  return { status: res.status, text };
}

/** A's identifying values that must never appear in a response to B. */
const SECRETS_OF_A = ["Góc Săn Deal", "gocsandeal", "a-serpapi-key-0001", "A-only snapshot", "A-only notification", "sc-domain:gocsandeal.com"];
const leaks = (text: string) => SECRETS_OF_A.filter((s) => text.includes(s));

beforeAll(async () => {
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", KEY);
  vi.stubEnv("SERANKING_API_KEY", "");
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  await pg.exec(`
    INSERT INTO users (id, email, created_at, updated_at) VALUES (1, 'tinledoihoa@gmail.com', 0, 0), (2, 'analytics@artemisdigital.com', 0, 0);
    -- B has granted Google scopes, so GA/GSC routes get past "reconnect" and reach their ownership checks.
    UPDATE users SET google_scopes = 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly openid email' WHERE id = 2;
    INSERT INTO sites (user_id, source, property, permission_level, created_at) VALUES (1, 'google', 'sc-domain:gocsandeal.com', 'siteOwner', 0);
    INSERT INTO ga_properties (user_id, property_id, display_name, time_zone, created_at) VALUES (1, '111', 'Góc Săn Deal GA4', 'Asia/Ho_Chi_Minh', 0);
    INSERT INTO projects (id, user_id, name, website_url, gsc_property, ga_property_id, created_at, updated_at)
      VALUES (1, 1, 'Góc Săn Deal', 'https://gocsandeal.com/', 'sc-domain:gocsandeal.com', '111', 0, 0), (2, 2, 'B project', 'https://b.example/', NULL, NULL, 0, 0);
    INSERT INTO project_settings (project_id, lead_events, seranking_site_id, updated_at) VALUES (1, '["generate_lead"]', 42, 0);
    INSERT INTO kpi_targets (project_id, metric, period, target, updated_at) VALUES (1, 'traffic_organic', '2026-10', 5000, 1);
    INSERT INTO psi_pages (project_id, url, created_at) VALUES (1, 'https://gocsandeal.com/', 0);
    INSERT INTO serp_snapshots (id, user_id, project_id, engine, params, params_hash, depth, stop_on_found, status, started_at, results)
      VALUES (900, 1, 1, 'google', '{"query":"A-only snapshot"}', 'h', 10, true, 'done', 1, '[]');
    INSERT INTO report_cache (scope, cache_key, kind, provider, user_id, project_id, query, payload, fetched_at, fresh_until)
      VALUES ('user:1', 'k1', 'summary:gsc', 'gsc', 1, 1, '{"projectId":1}', '{"state":"live","note":"gocsandeal"}', 1, 9999999999999);
    INSERT INTO notifications (id, user_id, project_id, rule, dedupe_key, severity, title, body, source_at, created_at)
      VALUES (700, 1, 1, 'performance', 'x', 'info', 'A-only notification', 'b', 1, 1);
    INSERT INTO ga4_saved_reports (id, user_id, project_id, property_id, name, spec, created_at, updated_at)
      VALUES (500, 1, 1, '111', 'gocsandeal leads', '{"dimensions":["landingPage"],"metrics":["sessions"],"preset":"last28","compare":"previous","filters":[],"sort":null,"limit":50,"chart":"table"}', 1, 1);
  `);
  await saveCredential(A, "serpapi", { apiKey: "a-serpapi-key-0001" });
});
afterAll(() => vi.unstubAllEnvs());

describe("project-scoped routes refuse another account's project id", () => {
  const routes: Array<[string, string, string, Record<string, string>, unknown?]> = [
    ["@/app/api/projects/[id]/route", "PUT", "/api/projects/1", { id: "1" }, { name: "hacked" }],
    ["@/app/api/projects/[id]/route", "DELETE", "/api/projects/1", { id: "1" }],
    ["@/app/api/projects/[id]/kpi-targets/route", "GET", "/api/projects/1/kpi-targets?from=2026-01&to=2026-12", { id: "1" }],
    ["@/app/api/projects/[id]/kpi-targets/route", "PUT", "/api/projects/1/kpi-targets", { id: "1" }, { changes: [{ period: "2026-10", metric: "traffic_organic", value: 1, expectedUpdatedAt: 1 }] }],
    ["@/app/api/projects/[id]/lead-events/route", "GET", "/api/projects/1/lead-events", { id: "1" }],
    ["@/app/api/projects/[id]/lead-events/route", "PUT", "/api/projects/1/lead-events", { id: "1" }, { events: ["x"] }],
    ["@/app/api/projects/[id]/seranking/route", "GET", "/api/projects/1/seranking", { id: "1" }],
    ["@/app/api/projects/[id]/seranking/route", "PUT", "/api/projects/1/seranking", { id: "1" }, { siteId: null }],
    ["@/app/api/projects/[id]/serpapi-key/route", "PUT", "/api/projects/1/serpapi-key", { id: "1" }, { key: "x" }],
    ["@/app/api/projects/[id]/serpapi-key/route", "DELETE", "/api/projects/1/serpapi-key", { id: "1" }],
    ["@/app/api/v2/summary/[id]/route", "GET", "/api/v2/summary/1", { id: "1" }],
    ["@/app/api/v2/llm-traffic/[id]/route", "GET", "/api/v2/llm-traffic/1", { id: "1" }],
    ["@/app/api/v2/thumbnails/[id]/route", "GET", "/api/v2/thumbnails/1?url=https://gocsandeal.com/", { id: "1" }],
    ["@/app/api/v2/seranking/[id]/route", "GET", "/api/v2/seranking/1", { id: "1" }],
    ["@/app/api/v2/seranking/[id]/overview/route", "GET", "/api/v2/seranking/1/overview", { id: "1" }],
    ["@/app/api/v2/seranking/[id]/competition/route", "GET", "/api/v2/seranking/1/competition?peek=1", { id: "1" }],
    ["@/app/api/v2/seranking/[id]/audit/route", "GET", "/api/v2/seranking/1/audit", { id: "1" }],
    ["@/app/api/v2/seranking/[id]/backlinks/route", "GET", "/api/v2/seranking/1/backlinks", { id: "1" }],
    ["@/app/api/v2/seranking/[id]/backlinks/route", "POST", "/api/v2/seranking/1/backlinks", { id: "1" }],
    ["@/app/api/v2/organic-serp/[id]/route", "GET", "/api/v2/organic-serp/1", { id: "1" }],
    ["@/app/api/v2/organic-serp/[id]/snapshots/[sid]/route", "GET", "/api/v2/organic-serp/1/snapshots/900", { id: "1", sid: "900" }],
    ["@/app/api/ai-area/[id]/tracking/route", "GET", "/api/ai-area/1/tracking", { id: "1" }],
    ["@/app/api/ai-area/[id]/tracking/route", "PUT", "/api/ai-area/1/tracking", { id: "1" }, { keywords: [] }],
    ["@/app/api/ai-area/[id]/tracking/run/route", "POST", "/api/ai-area/1/tracking/run", { id: "1" }, {}],
    ["@/app/api/ai-area/[id]/serp-status/route", "GET", "/api/ai-area/1/serp-status", { id: "1" }],
    ["@/app/api/ai-area/[id]/brand/route", "GET", "/api/ai-area/1/brand", { id: "1" }],
    ["@/app/api/ai-area/[id]/brand/cycle/route", "DELETE", "/api/ai-area/1/brand/cycle", { id: "1" }],
    ["@/app/api/ai-area/[id]/brand/run/route", "POST", "/api/ai-area/1/brand/run", { id: "1" }, {}],
    ["@/app/api/pagespeed/route", "GET", "/api/pagespeed?projectId=1", {}],
    ["@/app/api/pagespeed/history/route", "GET", "/api/pagespeed/history?pageId=1", {}],
    ["@/app/api/pagespeed/run/route", "POST", "/api/pagespeed/run", {}, { pageId: 1 }],
    ["@/app/api/pagespeed/route", "DELETE", "/api/pagespeed?pageId=1", {}],
    ["@/app/api/reviews/route", "GET", "/api/reviews?projectId=1", {}],
    ["@/app/api/performance/route", "GET", "/api/performance?property=sc-domain:gocsandeal.com", {}],
    ["@/app/api/settings/site/route", "GET", "/api/settings/site?property=sc-domain:gocsandeal.com", {}],
    ["@/app/api/weekly-report/config/route", "GET", "/api/weekly-report/config?propertyId=111", {}],
    ["@/app/api/ga/report/route", "GET", "/api/ga/report?propertyId=111", {}],
    ["@/app/api/ga/key-event-drill/route", "GET", "/api/ga/key-event-drill?propertyId=111&eventName=x", {}],
    ["@/app/api/ga/source-medium-drill/route", "GET", "/api/ga/source-medium-drill?propertyId=111&sourceMedium=google%20%2F%20organic", {}],
    ["@/app/api/ga/landing-heatmap/route", "GET", "/api/ga/landing-heatmap?propertyId=111", {}],
    ["@/app/api/weekly-report/route", "GET", "/api/weekly-report?propertyId=111", {}],
    ["@/app/api/opportunities/[kind]/route", "GET", "/api/opportunities/cannibalization?property=sc-domain:gocsandeal.com", { kind: "cannibalization" }],
    ["@/app/api/index/route", "GET", "/api/index?property=sc-domain:gocsandeal.com", {}],
    ["@/app/api/account/budgets/route", "GET", "/api/account/budgets?project=1", {}],
    ["@/app/api/account/budgets/route", "PUT", "/api/account/budgets", {}, { scope: "project", projectId: 1, metric: "serpapi_requests_month", value: 1 }],
    ["@/app/api/account/usage/route", "GET", "/api/account/usage?project=1", {}],
    ["@/app/api/v2/ga4/[id]/template/route", "GET", "/api/v2/ga4/1/template?template=leads", { id: "1" }],
    ["@/app/api/v2/ga4/[id]/metadata/route", "GET", "/api/v2/ga4/1/metadata", { id: "1" }],
    ["@/app/api/v2/ga4/[id]/check/route", "POST", "/api/v2/ga4/1/check", { id: "1" }, { spec: {} }],
    ["@/app/api/v2/ga4/[id]/run/route", "POST", "/api/v2/ga4/1/run", { id: "1" }, { spec: {}, reportId: 500 }],
    ["@/app/api/v2/ga4/[id]/reports/route", "GET", "/api/v2/ga4/1/reports", { id: "1" }],
    ["@/app/api/v2/ga4/[id]/reports/route", "POST", "/api/v2/ga4/1/reports", { id: "1" }, { duplicateOf: 500 }],
    ["@/app/api/v2/ga4/[id]/reports/[reportId]/route", "GET", "/api/v2/ga4/1/reports/500", { id: "1", reportId: "500" }],
    ["@/app/api/v2/ga4/[id]/reports/[reportId]/route", "PUT", "/api/v2/ga4/1/reports/500", { id: "1", reportId: "500" }, { name: "hacked" }],
    ["@/app/api/v2/ga4/[id]/reports/[reportId]/route", "DELETE", "/api/v2/ga4/1/reports/500", { id: "1", reportId: "500" }],
  ];

  it.each(routes)("%s %s as account B → refused, nothing of A's", async (modPath, method, path, params, body) => {
    await as(B);
    const mod = (await import(/* @vite-ignore */ modPath)) as Record<string, unknown>;
    const r = await call(mod, method, path, params, body);
    // 410: a retired endpoint that saves nothing for anyone.
    expect([400, 403, 404, 410], `${method} ${path} → ${r.status} ${r.text.slice(0, 160)}`).toContain(r.status);
    expect(leaks(r.text), `${method} ${path} leaked`).toEqual([]);
  });

  it("B can't reach A's snapshot through B's own project either", async () => {
    await as(B);
    const mod = await import("@/app/api/v2/organic-serp/[id]/snapshots/[sid]/route");
    const r = await call(mod as Record<string, unknown>, "GET", "/api/v2/organic-serp/2/snapshots/900", { id: String(B_PROJECT), sid: "900" });
    expect(r.status).toBe(404);
  });

  it("B can't read or delete A's saved GA4 report through B's own project", async () => {
    await as(B);
    const mod = (await import("@/app/api/v2/ga4/[id]/reports/[reportId]/route")) as Record<string, unknown>;
    for (const method of ["GET", "DELETE"]) {
      const r = await call(mod, method, "/api/v2/ga4/2/reports/500", { id: String(B_PROJECT), reportId: "500" });
      expect(r.status).toBe(404);
      expect(leaks(r.text)).toEqual([]);
    }
    const list = await call((await import("@/app/api/v2/ga4/[id]/reports/route")) as Record<string, unknown>, "GET", "/api/v2/ga4/2/reports", { id: String(B_PROJECT) });
    expect(JSON.parse(list.text).reports).toEqual([]);
  });

  it("A's data is unchanged after all of B's attempts", async () => {
    const q = async (sql: string) => (await pg.query(sql)).rows[0];
    expect(await q("SELECT name, project_id, user_id FROM ga4_saved_reports WHERE id = 500")).toEqual({ name: "gocsandeal leads", project_id: 1, user_id: 1 });
    expect(await q("SELECT COUNT(*)::int AS n FROM ga4_saved_reports")).toEqual({ n: 1 });
    expect(await q("SELECT name FROM projects WHERE id = 1")).toEqual({ name: "Góc Săn Deal" });
    expect(await q("SELECT target FROM kpi_targets WHERE project_id = 1 AND period = '2026-10'")).toEqual({ target: 5000 });
    expect(await q("SELECT lead_events, seranking_site_id FROM project_settings WHERE project_id = 1")).toEqual({ lead_events: '["generate_lead"]', seranking_site_id: 42 });
    expect(await q("SELECT COUNT(*)::int AS n FROM psi_pages WHERE project_id = 1")).toEqual({ n: 1 });
    expect(await q("SELECT COUNT(*)::int AS n FROM budget_limits WHERE project_id = 1")).toEqual({ n: 0 });
    expect(await q("SELECT read_at FROM notifications WHERE id = 700")).toEqual({ read_at: null });
    expect((await readCredential(A, "serpapi"))?.values.apiKey).toBe("a-serpapi-key-0001");
  });
});

describe("account-scoped routes show B only B's own rows", () => {
  it("credentials: B sees no key, can't delete A's", async () => {
    await as(B);
    const list = await call((await import("@/app/api/account/credentials/route")) as Record<string, unknown>, "GET", "/api/account/credentials");
    expect(list.status).toBe(200);
    expect(JSON.parse(list.text).statuses?.find((s: { provider: string }) => s.provider === "serpapi")?.saved ?? false).toBe(false);
    expect(leaks(list.text)).toEqual([]);
    await call((await import("@/app/api/account/credentials/[provider]/route")) as Record<string, unknown>, "DELETE", "/api/account/credentials/serpapi", { provider: "serpapi" });
    expect((await readCredential(A, "serpapi"))?.values.apiKey).toBe("a-serpapi-key-0001");
  });

  it("notifications: B lists none of A's and can't mark A's read", async () => {
    await as(B);
    const list = await call((await import("@/app/api/notifications/route")) as Record<string, unknown>, "GET", "/api/notifications?project=all");
    expect(leaks(list.text)).toEqual([]);
    const mark = await call((await import("@/app/api/notifications/read/route")) as Record<string, unknown>, "POST", "/api/notifications/read", {}, { ids: [700] });
    expect(JSON.parse(mark.text).changed).toBe(0);
  });

  it("sync & cache: B's status lists none of A's saved results", async () => {
    await as(B);
    const s = await call((await import("@/app/api/account/sync/route")) as Record<string, unknown>, "GET", "/api/account/sync");
    expect(s.status).toBe(200);
    expect(JSON.parse(s.text).entries).toEqual([]);
    expect(leaks(s.text)).toEqual([]);
  });

  it("projects list: B sees only B's project", async () => {
    await as(B);
    const p = await call((await import("@/app/api/projects/route")) as Record<string, unknown>, "GET", "/api/projects");
    expect(p.status).toBe(200);
    expect(JSON.parse(p.text).projects.map((x: { id: number }) => x.id)).toEqual([B_PROJECT]);
  });

  it("Docs: B (not a publisher) can't publish; both owner-named publishers can", async () => {
    vi.stubEnv("DOCS_ADMIN_EMAILS", "tin@artemisdigital.com,tinledoihoa@gmail.com");
    await as(B);
    const r = await call((await import("@/app/api/docs/route")) as Record<string, unknown>, "POST", "/api/docs", {}, { title: "TEMP isolation test" });
    expect(r.status).toBe(403);
    await as(A); // tinledoihoa@gmail.com is a publisher
    const ok = await call((await import("@/app/api/docs/route")) as Record<string, unknown>, "POST", "/api/docs", {}, { title: "TEMP isolation test" });
    expect(ok.status).toBe(200);
    await pg.query("DELETE FROM doc_articles WHERE title = 'TEMP isolation test'");
  });
});
