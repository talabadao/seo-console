// Workspace isolation and project permissions, at the route level, on the real schema (baseline + every migration,
// PGlite). Workspace 1: A manages project 1 (GSC and GA4 through the workspace's shared connection, KPI targets, lead
// events, SE Ranking mapping, a PageSpeed page, an Organic SERP snapshot, a shared cached result) and has personal
// data (an encrypted SerpApi key, a notification, a private saved GA4 report). B is in the same workspace and only
// views project 1. C is in another workspace. Every call is authenticated; a 401 is never the evidence here.
// - C, addressing project 1 by id through every project-scoped route (reads and writes): refused, nothing leaked.
// - B, the viewer: every management action on project 1 is refused with 403 naming the managers; A's personal data
//   never appears; B's own personal settings stay B's.
// - Afterwards nothing of A's or the project's changed and no work was queued.
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
const A = 1; // manages project 1
const B = 2; // same workspace: views project 1, manages project 2
const C = 3; // another workspace
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
const load = async (modPath: string) => (await import(/* @vite-ignore */ modPath)) as Record<string, unknown>;

/** Workspace 1's project data: never in a response to another workspace. */
const PROJECT_DATA = ["Góc Săn Deal", "gocsandeal", "A-only snapshot", "sc-domain:gocsandeal.com"];
/** A's personal data: never in a response to anyone else, including B in the same workspace. */
const PERSONAL_OF_A = ["a-serpapi-key-0001", "A-only notification", "A private report"];
const leaks = (text: string, list: string[]) => list.filter((s) => text.includes(s));

beforeAll(async () => {
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", KEY);
  vi.stubEnv("SERANKING_API_KEY", "");
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  await pg.exec(`
    INSERT INTO workspaces (id, name, created_at) VALUES (2, 'Other team', 0);
    INSERT INTO users (id, email, name, kind, status, workspace_id, created_at, updated_at) VALUES
      (1, 'tinledoihoa@gmail.com', 'Tin', 'person', 'active', 1, 0, 0),
      (2, 'colleague@headsonpillows.com', 'Colleague', 'person', 'active', 1, 0, 0),
      (3, 'outsider@other-team.example', 'Outsider', 'person', 'active', 2, 0, 0);
    INSERT INTO user_identities (user_id, issuer, subject, email, hosted_domain, created_at) VALUES
      (1, 'https://accounts.google.com', 's1', 'tinledoihoa@gmail.com', NULL, 0),
      (2, 'https://accounts.google.com', 's2', 'colleague@headsonpillows.com', 'headsonpillows.com', 0),
      (3, 'https://accounts.google.com', 's3', 'outsider@other-team.example', NULL, 0);
    -- Workspace 1's shared Google connection, discovering the property; workspace 2 has its own (no properties).
    INSERT INTO google_connections (id, workspace_id, issuer, subject, email, scopes, status, created_at, updated_at) VALUES
      (1, 1, 'https://accounts.google.com', 'c1', 'analytics@artemisdigital.com', 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly openid email', 'ok', 0, 0),
      (2, 2, 'https://accounts.google.com', 'c2', 'data@other-team.example', 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly openid email', 'ok', 0, 0);
    INSERT INTO sites (user_id, connection_id, source, property, permission_level, created_at) VALUES (NULL, 1, 'google', 'sc-domain:gocsandeal.com', 'siteOwner', 0);
    INSERT INTO ga_properties (user_id, connection_id, property_id, display_name, time_zone, created_at) VALUES (NULL, 1, '111', 'Góc Săn Deal GA4', 'Asia/Ho_Chi_Minh', 0);
    INSERT INTO projects (id, user_id, name, website_url, gsc_property, ga_property_id, gsc_connection_id, ga_connection_id, workspace_id, created_by, primary_manager_id, created_at, updated_at) VALUES
      (1, 1, 'Góc Săn Deal', 'https://gocsandeal.com/', 'sc-domain:gocsandeal.com', '111', 1, 1, 1, 1, 1, 0, 0),
      (2, 2, 'B project', 'https://b.example/', NULL, NULL, NULL, NULL, 1, 2, 2, 0, 0),
      (3, 3, 'Other team project', 'https://other.example/', NULL, NULL, NULL, NULL, 2, 3, 3, 0, 0);
    INSERT INTO project_members (project_id, user_id, added_at) VALUES (1, 1, 0), (2, 2, 0), (3, 3, 0);
    INSERT INTO project_settings (project_id, lead_events, seranking_site_id, updated_at) VALUES (1, '["generate_lead"]', 42, 0);
    INSERT INTO kpi_targets (project_id, metric, period, target, updated_at) VALUES (1, 'traffic_organic', '2026-10', 5000, 1);
    INSERT INTO psi_pages (id, project_id, url, created_at) VALUES (1, 1, 'https://gocsandeal.com/', 0);
    INSERT INTO serp_snapshots (id, user_id, project_id, engine, params, params_hash, depth, stop_on_found, status, started_at, results)
      VALUES (900, 1, 1, 'google', '{"query":"A-only snapshot"}', 'h', 10, true, 'done', 1, '[]');
    INSERT INTO report_cache (scope, cache_key, kind, provider, user_id, project_id, query, payload, fetched_at, fresh_until)
      VALUES ('ws:1', 'k1', 'summary:gsc', 'gsc', NULL, 1, '{"projectId":1}', '{"state":"live","note":"gocsandeal"}', 1, 9999999999999);
    INSERT INTO notifications (id, user_id, project_id, rule, dedupe_key, severity, title, body, source_at, created_at)
      VALUES (700, 1, 1, 'performance', 'x', 'info', 'A-only notification', 'b', 1, 1);
    INSERT INTO ga4_saved_reports (id, user_id, project_id, property_id, name, spec, created_at, updated_at)
      VALUES (500, 1, 1, '111', 'A private report', '{"dimensions":["landingPage"],"metrics":["sessions"],"preset":"last28","compare":"previous","filters":[],"sort":null,"limit":50,"chart":"table"}', 1, 1);
  `);
  await saveCredential(A, "serpapi", { apiKey: "a-serpapi-key-0001" });
});
afterAll(() => vi.unstubAllEnvs());

type Route = [modPath: string, method: string, path: string, params: Record<string, string>, body?: unknown];

/** Every project-scoped route, reads and writes, addressed at workspace 1's project 1. */
const PROJECT_ROUTES: Route[] = [
  ["@/app/api/projects/[id]/route", "PUT", "/api/projects/1", { id: "1" }, { name: "hacked" }],
  ["@/app/api/projects/[id]/route", "DELETE", "/api/projects/1", { id: "1" }],
  ["@/app/api/projects/[id]/members/route", "GET", "/api/projects/1/members", { id: "1" }],
  ["@/app/api/projects/[id]/members/route", "POST", "/api/projects/1/members", { id: "1" }, { userIds: [2, 3] }],
  ["@/app/api/projects/[id]/members/route", "DELETE", "/api/projects/1/members", { id: "1" }, { userId: 1, newPrimaryId: 2 }],
  ["@/app/api/projects/[id]/members/route", "PUT", "/api/projects/1/members", { id: "1" }, { primaryManagerId: 2 }],
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
  ["@/app/api/ai-area/[id]/brand/route", "PUT", "/api/ai-area/1/brand", { id: "1" }, { brandName: "hacked" }],
  ["@/app/api/ai-area/[id]/brand/cycle/route", "DELETE", "/api/ai-area/1/brand/cycle", { id: "1" }],
  ["@/app/api/ai-area/[id]/brand/run/route", "POST", "/api/ai-area/1/brand/run", { id: "1" }, {}],
  ["@/app/api/ai-area/[id]/brand/prompts/route", "POST", "/api/ai-area/1/brand/prompts", { id: "1" }, { text: "x" }],
  ["@/app/api/ai-area/[id]/brand/suggest/route", "POST", "/api/ai-area/1/brand/suggest", { id: "1" }, {}],
  ["@/app/api/pagespeed/route", "GET", "/api/pagespeed?projectId=1", {}],
  ["@/app/api/pagespeed/route", "POST", "/api/pagespeed", {}, { projectId: 1, url: "https://gocsandeal.com/x" }],
  ["@/app/api/pagespeed/history/route", "GET", "/api/pagespeed/history?pageId=1", {}],
  ["@/app/api/pagespeed/run/route", "POST", "/api/pagespeed/run", {}, { pageId: 1 }],
  ["@/app/api/pagespeed/route", "DELETE", "/api/pagespeed?pageId=1", {}],
  ["@/app/api/reviews/route", "GET", "/api/reviews?projectId=1", {}],
  ["@/app/api/reviews/sync/route", "POST", "/api/reviews/sync", {}, { projectId: 1 }],
  ["@/app/api/performance/route", "GET", "/api/performance?property=sc-domain:gocsandeal.com", {}],
  ["@/app/api/settings/site/route", "GET", "/api/settings/site?property=sc-domain:gocsandeal.com", {}],
  ["@/app/api/settings/site/route", "POST", "/api/settings/site", {}, { property: "sc-domain:gocsandeal.com", brandTerms: ["hacked"] }],
  ["@/app/api/settings/indexing/route", "POST", "/api/settings/indexing", {}, { property: "sc-domain:gocsandeal.com", autoSubmit: true }],
  ["@/app/api/settings/ga/route", "POST", "/api/settings/ga", {}, { projectId: 1, aiDomains: ["hacked.example"] }],
  ["@/app/api/index/check/route", "POST", "/api/index/check", {}, { property: "sc-domain:gocsandeal.com" }],
  ["@/app/api/index/inspect/route", "POST", "/api/index/inspect", {}, { property: "sc-domain:gocsandeal.com", urls: ["https://gocsandeal.com/"] }],
  ["@/app/api/index/submit/route", "POST", "/api/index/submit", {}, { property: "sc-domain:gocsandeal.com", urls: ["https://gocsandeal.com/"] }],
  ["@/app/api/weekly-report/config/route", "GET", "/api/weekly-report/config?propertyId=111", {}],
  ["@/app/api/weekly-report/config/route", "POST", "/api/weekly-report/config", {}, { propertyId: "111", asanaProjectGid: "hacked" }],
  ["@/app/api/weekly-report/asana/route", "POST", "/api/weekly-report/asana", {}, { propertyId: "111", statusType: "on_track", title: "x" }],
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

/** Management actions on project 1 (the subset of PROJECT_ROUTES that changes the project or runs something). */
const MANAGEMENT_ROUTES = PROJECT_ROUTES.filter(
  ([mod, method]) =>
    method !== "GET" &&
    !mod.includes("/account/") && // personal budgets are the viewer's own
    !mod.includes("/v2/ga4/") && // GA4 checks, runs and private saved reports are reporting, not project changes
    !mod.endsWith("serpapi-key/route") &&
    !mod.includes("/weekly-report/asana/"), // covered below with its Preview write block
);

describe("another workspace: every project-scoped route refuses workspace 1's ids", () => {
  it.each(PROJECT_ROUTES)("%s %s as C → refused, nothing of workspace 1's", async (modPath, method, path, params, body) => {
    await as(C);
    const r = await call(await load(modPath), method, path, params, body);
    // 410: a retired endpoint that saves nothing for anyone.
    expect([400, 403, 404, 410], `${method} ${path} → ${r.status} ${r.text.slice(0, 160)}`).toContain(r.status);
    expect(leaks(r.text, [...PROJECT_DATA, ...PERSONAL_OF_A]), `${method} ${path} leaked`).toEqual([]);
  });

  it("C can't reach a snapshot or saved report through C's own project", async () => {
    await as(C);
    const snap = await call(await load("@/app/api/v2/organic-serp/[id]/snapshots/[sid]/route"), "GET", "/api/v2/organic-serp/3/snapshots/900", { id: "3", sid: "900" });
    expect(snap.status).toBe(404);
    const rep = await call(await load("@/app/api/v2/ga4/[id]/reports/[reportId]/route"), "GET", "/api/v2/ga4/3/reports/500", { id: "3", reportId: "500" });
    expect(rep.status).toBe(404);
  });

  it("C's project list, team, sync status and connections show nothing of workspace 1", async () => {
    await as(C);
    const p = await call(await load("@/app/api/projects/route"), "GET", "/api/projects");
    expect(JSON.parse(p.text).projects.map((x: { id: number }) => x.id)).toEqual([3]);
    const s = await call(await load("@/app/api/account/sync/route"), "GET", "/api/account/sync");
    expect(s.status).toBe(200);
    expect(JSON.parse(s.text).entries).toEqual([]);
    for (const [mod, path] of [["@/app/api/team/route", "/api/team"], ["@/app/api/account/connections/route", "/api/account/connections"]]) {
      const r = await call(await load(mod), "GET", path);
      expect(r.status, path).toBe(200);
      expect(leaks(r.text, [...PROJECT_DATA, "tinledoihoa", "colleague@", "analytics@artemisdigital.com"]), path).toEqual([]);
    }
  });
});

describe("same workspace, viewer only: B sees project 1 but can't change or run anything in it", () => {
  it.each(MANAGEMENT_ROUTES)("%s %s as viewer B → 403 naming the managers", async (modPath, method, path, params, body) => {
    await as(B);
    const r = await call(await load(modPath), method, path, params, body);
    // 410: retired endpoints refuse everyone before the access check.
    expect([403, 410], `${method} ${path} → ${r.status} ${r.text.slice(0, 160)}`).toContain(r.status);
    if (r.status === 403) expect(r.text, path).toMatch(/management/i);
    expect(leaks(r.text, PERSONAL_OF_A), `${method} ${path} leaked`).toEqual([]);
  });

  it("can't remove a legacy project key or post the weekly report to Asana", async () => {
    await as(B);
    expect((await call(await load("@/app/api/projects/[id]/serpapi-key/route"), "DELETE", "/api/projects/1/serpapi-key", { id: "1" })).status).toBe(404);
    expect((await call(await load("@/app/api/weekly-report/asana/route"), "POST", "/api/weekly-report/asana", {}, { propertyId: "111", statusType: "on_track", title: "x" })).status).toBe(403);
  });

  it("can view: all projects listed with who manages them, members readable", async () => {
    await as(B);
    const p = JSON.parse((await call(await load("@/app/api/projects/route"), "GET", "/api/projects")).text) as { projects: Array<{ id: number; canManage: boolean }> };
    expect(p.projects.map((x) => [x.id, x.canManage]).sort()).toEqual([[1, false], [2, true]]);
    const m = await call(await load("@/app/api/projects/[id]/members/route"), "GET", "/api/projects/1/members", { id: "1" });
    expect(m.status).toBe(200);
    expect(JSON.parse(m.text).managers.map((x: { userId: number }) => x.userId)).toEqual([A]);
    const k = await call(await load("@/app/api/projects/[id]/kpi-targets/route"), "GET", "/api/projects/1/kpi-targets?from=2026-01&to=2026-12", { id: "1" });
    expect(k.status).toBe(200);
  });

  it("A's saved GA4 report stays private to A", async () => {
    await as(B);
    const list = await call(await load("@/app/api/v2/ga4/[id]/reports/route"), "GET", "/api/v2/ga4/1/reports", { id: "1" });
    expect(JSON.parse(list.text).reports).toEqual([]);
    const mod = await load("@/app/api/v2/ga4/[id]/reports/[reportId]/route");
    for (const [method, body] of [["GET"], ["PUT", { name: "hacked" }], ["DELETE"]] as const) {
      const r = await call(mod, method, "/api/v2/ga4/1/reports/500", { id: "1", reportId: "500" }, body);
      // PUT stops earlier here (no GA4 token in tests: an "unavailable" state); either way nothing is returned or changed.
      if (method === "PUT") expect(JSON.parse(r.text).ok, method).not.toBe(true);
      else expect(r.status, method).toBe(404);
      expect(leaks(r.text, PERSONAL_OF_A)).toEqual([]);
    }
    expect((await pg.query("SELECT name FROM ga4_saved_reports WHERE id = 500")).rows).toEqual([{ name: "A private report" }]);
  });

  it("personal data stays personal: credentials, notifications, budgets and usage", async () => {
    await as(B);
    const list = await call(await load("@/app/api/account/credentials/route"), "GET", "/api/account/credentials");
    expect(list.status).toBe(200);
    expect(JSON.parse(list.text).statuses?.find((s: { provider: string }) => s.provider === "serpapi")?.saved ?? false).toBe(false);
    await call(await load("@/app/api/account/credentials/[provider]/route"), "DELETE", "/api/account/credentials/serpapi", { provider: "serpapi" });
    const n = await call(await load("@/app/api/notifications/route"), "GET", "/api/notifications?project=all");
    expect(leaks(n.text, PERSONAL_OF_A)).toEqual([]);
    const mark = await call(await load("@/app/api/notifications/read/route"), "POST", "/api/notifications/read", {}, { ids: [700] });
    expect(JSON.parse(mark.text).changed).toBe(0);
    // B's own budget for a project B can view is B's alone.
    const put = await call(await load("@/app/api/account/budgets/route"), "PUT", "/api/account/budgets", {}, { scope: "project", projectId: 1, metric: "serpapi_requests_month", value: 3 });
    expect(put.status).toBe(200);
    expect((await pg.query("SELECT user_id FROM budget_limits WHERE project_id = 1")).rows).toEqual([{ user_id: B }]);
    await pg.query("DELETE FROM budget_limits WHERE project_id = 1");
    const u = await call(await load("@/app/api/account/usage/route"), "GET", "/api/account/usage?project=1");
    expect(leaks(u.text, PERSONAL_OF_A)).toEqual([]);
  });
});

describe("after every attempt", () => {
  it("workspace 1's project and A's personal data are unchanged", async () => {
    const q = async (sql: string) => (await pg.query(sql)).rows[0];
    expect(await q("SELECT name, project_id, user_id FROM ga4_saved_reports WHERE id = 500")).toEqual({ name: "A private report", project_id: 1, user_id: 1 });
    expect(await q("SELECT COUNT(*)::int AS n FROM ga4_saved_reports")).toEqual({ n: 1 });
    expect(await q("SELECT name, deleted_at, primary_manager_id FROM projects WHERE id = 1")).toEqual({ name: "Góc Săn Deal", deleted_at: null, primary_manager_id: 1 });
    expect((await pg.query("SELECT user_id FROM project_members WHERE project_id = 1")).rows).toEqual([{ user_id: 1 }]);
    expect(await q("SELECT target FROM kpi_targets WHERE project_id = 1 AND period = '2026-10'")).toEqual({ target: 5000 });
    expect(await q("SELECT lead_events, seranking_site_id FROM project_settings WHERE project_id = 1")).toEqual({ lead_events: '["generate_lead"]', seranking_site_id: 42 });
    expect(await q("SELECT COUNT(*)::int AS n FROM psi_pages WHERE project_id = 1")).toEqual({ n: 1 });
    expect(await q("SELECT COUNT(*)::int AS n FROM budget_limits")).toEqual({ n: 0 });
    expect(await q("SELECT read_at FROM notifications WHERE id = 700")).toEqual({ read_at: null });
    expect((await readCredential(A, "serpapi"))?.values.apiKey).toBe("a-serpapi-key-0001");
    expect(await q("SELECT COUNT(*)::int AS n FROM sync_jobs")).toEqual({ n: 0 }); // no work queued by anyone's attempts
  });
});

describe("Docs", () => {
  it("B (not a publisher) can't publish; the owner-named publisher can", async () => {
    vi.stubEnv("DOCS_ADMIN_EMAILS", "tin@artemisdigital.com,tinledoihoa@gmail.com");
    await as(B);
    const r = await call(await load("@/app/api/docs/route"), "POST", "/api/docs", {}, { title: "TEMP isolation test" });
    expect(r.status).toBe(403);
    await as(A); // tinledoihoa@gmail.com is a publisher (a verified linked login)
    const ok = await call(await load("@/app/api/docs/route"), "POST", "/api/docs", {}, { title: "TEMP isolation test" });
    expect(ok.status).toBe(200);
    await pg.query("DELETE FROM doc_articles WHERE title = 'TEMP isolation test'");
  });
});
