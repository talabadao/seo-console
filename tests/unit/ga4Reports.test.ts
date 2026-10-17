// GA4 report templates and saved custom reports, on the real schema (baseline + every migration, PGlite) with a
// fake GA4 Data API: runReport and getMetadata are replaced; checkCompatibility runs the REAL adapter
// (lib/ga4.ts validateReportCompatibility) against stubbed HTTP responses shaped like Google's. Covers the report-definition rules, the number
// rules (totals from GA4's own query, never summed rows; comparison queried separately; lead events kept apart
// from key events), the shared cache (an identical run makes no new GA4 request), saved-report ownership between
// two accounts that both have GA4 properties, and an explicit GA4 property change.
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

let acting: Record<string, unknown> | null = null;
vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return { ...actual, currentUser: async () => acting };
});
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: () => {} };
});
vi.mock("@/lib/google/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google/oauth")>("@/lib/google/oauth");
  return { ...actual, accessTokenFor: async () => "test-token" };
});

/** The fake Data API: records every report request; `answer` decides the rows. */
interface Req {
  propertyId: string;
  dimensions: string[];
  metrics: string[];
  dateRanges: { startDate: string; endDate: string }[];
  dimensionFilter?: unknown;
  limit?: number;
}
const gaCalls: Req[] = [];
let answer: (r: Req) => { dims: string[]; range: number; metrics: number[] }[] = () => [];
/**
 * The checkCompatibility HTTP endpoint. Default: success, with the candidate lists Google returns for
 * compatibilityFilter INCOMPATIBLE — fields that could NOT be added to the request (none of them selected).
 */
type CompatAnswer = { status: number; body: unknown; headers?: Record<string, string> } | Error;
let compat: (body: Record<string, unknown>) => CompatAnswer = () => ({ status: 200, body: CANDIDATES_RESPONSE });
const compatBodies: Record<string, unknown>[] = [];
const field = (kind: "dimension" | "metric", apiName: string) => ({
  [`${kind}Metadata`]: { apiName, uiName: apiName, description: "", category: kind === "dimension" ? "Demographics" : "Advertising", customDefinition: false },
  compatibility: "INCOMPATIBLE",
});
/** Representative of a successful response: unselected fields that can't be added (the owner's reported list). */
const CANDIDATES_RESPONSE = {
  dimensionCompatibilities: ["brandingInterest", "cohortNthDay", "cohortNthMonth", "cohortNthWeek", "userAgeBracket", "userGender"].map((n) => field("dimension", n)),
  metricCompatibilities: [
    "advertiserAdClicks", "advertiserAdCost", "advertiserAdCostPerClick", "advertiserAdCostPerKeyEvent", "advertiserAdImpressions", "cohortActiveUsers",
    "cohortTotalUsers", "organicGoogleSearchAveragePosition", "organicGoogleSearchClicks", "organicGoogleSearchClickThroughRate",
    "organicGoogleSearchImpressions", "returnOnAdSpend",
  ].map((n) => field("metric", n)),
};
const googleError = (code: number, status: string, message: string) => ({ error: { code, message, status } });
const FLAGS = { thresholded: false, otherRow: false, currency: "VND", timeZone: "Asia/Ho_Chi_Minh", metricTypes: [] as string[] };
vi.mock("@/lib/ga4", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ga4")>("@/lib/ga4");
  return {
    ...actual,
    runReport: async (_t: string, propertyId: string, o: Omit<Req, "propertyId">) => {
      const r = { propertyId, ...o };
      gaCalls.push(r);
      const rows = answer(r);
      return { rows, metricHeaders: o.metrics, sampled: false, rowCount: rows.filter((x) => x.range === 0).length, flags: { ...FLAGS, metricTypes: o.metrics.map(() => "TYPE_INTEGER") } };
    },
    getGaMetadata: async () => ({
      dimensions: ["date", "sessionDefaultChannelGroup", "landingPage", "eventName", "isKeyEvent", "sessionSourceMedium", "country"].map((d) => ({ apiName: d, uiName: d, category: "Test", description: "", custom: false })),
      metrics: ["sessions", "engagedSessions", "totalUsers", "engagementRate", "keyEvents", "eventCount", "newUsers"].map((m) => ({ apiName: m, uiName: m, category: "Test", description: "", custom: false, type: "TYPE_INTEGER" })),
    }),
    getPropertyMeta: async () => ({ currency: "VND", timeZone: "Asia/Ho_Chi_Minh" }),
  };
});
// Only checkCompatibility reaches "the network"; anything else is blocked.
vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
  if (!/:checkCompatibility$/.test(String(url))) throw new Error(`network blocked: ${String(url)}`);
  const body = JSON.parse(String(init?.body ?? "{}"));
  compatBodies.push(body);
  const a = compat(body);
  if (a instanceof Error) throw a;
  return new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json", ...(a.headers ?? {}) } });
});

import { NextRequest } from "next/server";
import { BASELINE_STATEMENTS } from "@/lib/schema";
import { MIGRATIONS } from "@/db/migrations";
import { DEFAULT_SPEC, filterExpression, normalizeSpec } from "@/lib/v2/ga4reports/spec";
import { runCustomReport } from "@/lib/v2/ga4reports/run";
import { runTemplate } from "@/lib/v2/ga4reports/templates";
import { resolvePeriod } from "@/lib/v2/summary/period";

const SCOPES = "https://www.googleapis.com/auth/analytics.readonly openid email";
async function as(userId: number) {
  acting = (await pg.query("SELECT * FROM users WHERE id = $1", [userId])).rows[0] as Record<string, unknown>;
}
type Handler = (r: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(modPath: string, method: string, path: string, params: Record<string, string>, body?: unknown) {
  const mod = (await import(/* @vite-ignore */ modPath)) as Record<string, Handler>;
  const res = await mod[method](
    new NextRequest(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) }),
    { params: Promise.resolve(params) },
  );
  return { status: res.status, json: JSON.parse(await res.text()) };
}
const REPORTS = "@/app/api/v2/ga4/[id]/reports/route";
const REPORT = "@/app/api/v2/ga4/[id]/reports/[reportId]/route";
const RUN = "@/app/api/v2/ga4/[id]/run/route";

beforeAll(async () => {
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  await pg.exec(`
    INSERT INTO users (id, email, google_scopes, created_at, updated_at) VALUES (1, 'tinledoihoa@gmail.com', '${SCOPES}', 0, 0), (2, 'analytics@artemisdigital.com', '${SCOPES}', 0, 0);
    INSERT INTO ga_properties (user_id, property_id, display_name, time_zone, currency_code, created_at)
      VALUES (1, '111', 'A GA4', 'Asia/Ho_Chi_Minh', 'VND', 0), (1, '112', 'A second GA4', 'Asia/Ho_Chi_Minh', 'VND', 0), (2, '222', 'B GA4', 'UTC', 'USD', 0);
    INSERT INTO projects (id, user_id, name, website_url, ga_property_id, created_at, updated_at)
      VALUES (1, 1, 'A project', 'https://a.test/', '111', 0, 0), (2, 2, 'B project', 'https://b.test/', '222', 0, 0);
  `);
});
beforeEach(() => {
  gaCalls.length = 0;
  answer = () => [];
  compat = () => ({ status: 200, body: CANDIDATES_RESPONSE });
  compatBodies.length = 0;
});

describe("report definitions", () => {
  it("accepts the default and normalizes limits", () => {
    const n = normalizeSpec({ ...DEFAULT_SPEC, limit: 99999, preset: "nonsense" });
    expect("spec" in n && n.spec).toMatchObject({ limit: 1000, preset: "last28" });
  });
  it("refuses a donut of users: users can't be split into shares", () => {
    const n = normalizeSpec({ ...DEFAULT_SPEC, metrics: ["totalUsers"], chart: "donut", sort: null });
    expect("errors" in n && n.errors.join(" ")).toMatch(/must add up across rows/);
  });
  it("needs date for a line chart, no dimensions for a scorecard, one dimension for a bar", () => {
    expect("errors" in normalizeSpec({ ...DEFAULT_SPEC, chart: "line" })).toBe(true);
    expect("errors" in normalizeSpec({ ...DEFAULT_SPEC, chart: "scorecard" })).toBe(true);
    expect("errors" in normalizeSpec({ ...DEFAULT_SPEC, dimensions: ["date"], chart: "bar", sort: null })).toBe(true);
    expect("spec" in normalizeSpec({ ...DEFAULT_SPEC, dimensions: ["date", "country"], chart: "line", sort: null })).toBe(true);
  });
  it("refuses invalid names, a sort on an unchosen field and a broken regex", () => {
    expect("errors" in normalizeSpec({ ...DEFAULT_SPEC, metrics: ["sessions; DROP"] })).toBe(true);
    expect("errors" in normalizeSpec({ ...DEFAULT_SPEC, sort: { field: "totalUsers", desc: true } })).toBe(true);
    expect("errors" in normalizeSpec({ ...DEFAULT_SPEC, filters: [{ field: "landingPage", op: "regex", value: "(", negate: false }] })).toBe(true);
  });
  it("builds GA4 filter expressions", () => {
    expect(filterExpression([{ field: "eventName", op: "in", value: "a, b", negate: false }])).toEqual({ filter: { fieldName: "eventName", inListFilter: { values: ["a", "b"] } } });
    expect(filterExpression([{ field: "landingPage", op: "contains", value: "/blog", negate: true }])).toMatchObject({ notExpression: { filter: { fieldName: "landingPage" } } });
    expect(filterExpression([])).toBeUndefined();
  });
});

const period = resolvePeriod("last28", "previous", new Date("2026-10-17T12:00:00Z"));

describe("number rules", () => {
  it("takes totals from GA4's own query (users counted once), never from adding rows", async () => {
    answer = (r) => {
      if (!r.dimensions.length) return [{ dims: [], range: 0, metrics: [15] }, { dims: [], range: 1, metrics: [12] }];
      // Two channels whose users overlap: 10 + 8 = 18 > 15 distinct users.
      return r.dateRanges[0].startDate === period.current.start
        ? [{ dims: ["Organic Search"], range: 0, metrics: [10] }, { dims: ["Direct"], range: 0, metrics: [8] }]
        : [{ dims: ["Organic Search"], range: 0, metrics: [9] }];
    };
    const spec = { ...DEFAULT_SPEC, metrics: ["totalUsers"], sort: null };
    const r = await runCustomReport({ token: "t", propertyId: "111", spec, period });
    expect(r.totals).toEqual({ cur: [15], prev: [12] });
    expect(r.rows).toEqual([
      { key: ["Organic Search"], cur: [10], prev: [9] },
      { key: ["Direct"], cur: [8], prev: [null] }, // not in the comparison results: unknown, not zero
    ]);
    // Totals, current rows and comparison rows: three separate queries, the comparison with its own range.
    expect(gaCalls.map((c) => [c.dimensions.length, c.dateRanges.length])).toEqual([
      [0, 2],
      [1, 1],
      [1, 1],
    ]);
  });

  it("counts lead events as filtered event counts, separate from key events", async () => {
    answer = (r) => {
      const leadsOnly = JSON.stringify(r.dimensionFilter ?? "").includes("generate_lead");
      if (r.dimensions.join() === "eventName,isKeyEvent") return [{ dims: ["generate_lead", "false"], range: 0, metrics: [4] }];
      if (leadsOnly && !r.dimensions.length) return [{ dims: [], range: 0, metrics: [4] }, { dims: [], range: 1, metrics: [2] }];
      if (leadsOnly && r.dimensions[0] === "sessionDefaultChannelGroup") return [{ dims: ["Organic Search"], range: 0, metrics: [4] }];
      if (!r.dimensions.length) return [{ dims: [], range: 0, metrics: [100, 9] }, { dims: [], range: 1, metrics: [80, 7] }];
      if (r.dimensions[0] === "sessionDefaultChannelGroup") return [{ dims: ["Organic Search"], range: 0, metrics: [60, 5] }];
      return [];
    };
    const r = await runTemplate({ token: "t", propertyId: "111", period, query: { template: "leads", view: "channel", focus: [] }, leadEvents: { events: ["generate_lead"], source: "project" } });
    expect(r.scorecards.map((s) => [s.metric, s.cur, s.prev])).toEqual([
      ["leads", 4, 2],
      ["sessions", 100, 80],
      ["keyEvents", 9, 7],
    ]);
    expect(r.table.columns.map((c) => c.metric)).toEqual(["sessions", "keyEvents", "leads"]);
    expect(r.table.rows[0].cur).toEqual([60, 5, 4]);
    expect(r.leads?.seen).toEqual([{ event: "generate_lead", count: 4, prevCount: 0, keyEvent: false }]);
  });

  it("shows the setup state, and makes no lead queries, when the project has no lead events", async () => {
    const r = await runTemplate({ token: "t", propertyId: "111", period, query: { template: "leads", view: "channel", focus: [] }, leadEvents: { events: [], source: "none" } });
    expect(r.leads).toMatchObject({ events: [], source: "none" });
    expect(r.scorecards.map((s) => s.metric)).toEqual(["sessions", "keyEvents"]);
    expect(gaCalls.some((c) => JSON.stringify(c.dimensionFilter ?? "").includes("eventName"))).toBe(false);
  });

  it("marks key events in the Events template and uses GA4's user total", async () => {
    answer = (r) => {
      if (r.dimensions.join() === "eventName,isKeyEvent") return [{ dims: ["purchase", "true"], range: 0, metrics: [3] }];
      if (!r.dimensions.length) return [{ dims: [], range: 0, metrics: [50, 20, 2.5] }];
      if (r.dimensions[0] === "eventName") return [{ dims: ["page_view"], range: 0, metrics: [40, 20, 2] }, { dims: ["purchase"], range: 0, metrics: [3, 3, 1] }];
      return [];
    };
    const r = await runTemplate({ token: "t", propertyId: "111", period, query: { template: "events", view: "event", focus: [] }, leadEvents: { events: [], source: "none" } });
    expect(r.table.rows.map((x) => [x.key, x.keyEvent])).toEqual([
      ["page_view", false],
      ["purchase", true],
    ]);
    expect(r.scorecards.find((s) => s.metric === "totalUsers")?.cur).toBe(20); // not 23
  });
});

describe("saved reports through the routes", { timeout: 30_000 }, () => {
  const spec = { ...DEFAULT_SPEC };
  let aReport = 0;

  it("saves after metadata and compatibility checks, and refuses what GA4 can't combine", async () => {
    await as(1);
    const bad = await call(REPORTS, "POST", "/api/v2/ga4/1/reports", { id: "1" }, { name: "Bad", spec: { ...spec, metrics: ["notAMetric"], sort: null } });
    expect(bad.status).toBe(400);
    expect(bad.json.errors.join(" ")).toMatch(/Not available in this GA4 property: notAMetric/);
    compat = () => ({ status: 400, body: googleError(400, "INVALID_ARGUMENT", "Please remove landingPage to make the request compatible. The request's dimensions & metrics are incompatible. To learn more, see https://ga-dev-tools.web.app/ga4/dimensions-metrics-explorer/") });
    const clash = await call(REPORTS, "POST", "/api/v2/ga4/1/reports", { id: "1" }, { name: "Clash", spec });
    expect(clash.status).toBe(400);
    compat = () => ({ status: 200, body: CANDIDATES_RESPONSE });
    const ok = await call(REPORTS, "POST", "/api/v2/ga4/1/reports", { id: "1" }, { name: "Channels", spec });
    expect(ok.json.ok).toBe(true);
    aReport = ok.json.report.id;
    expect(ok.json.report).toMatchObject({ projectId: 1, propertyId: "111", name: "Channels" });
  });

  it("runs once and serves the identical run from the shared cache", async () => {
    await as(1);
    answer = (r) => (r.dimensions.length ? [{ dims: ["Organic Search"], range: 0, metrics: [5, 3, 1] }] : [{ dims: [], range: 0, metrics: [5, 3, 1] }]);
    const first = await call(RUN, "POST", "/api/v2/ga4/1/run", { id: "1" }, { spec, reportId: aReport });
    expect(first.json.state).toBe("live");
    const requests = gaCalls.length;
    const again = await call(RUN, "POST", "/api/v2/ga4/1/run", { id: "1" }, { spec, reportId: aReport });
    expect(again.json.state).toBe("live");
    expect(gaCalls.length).toBe(requests);
  });

  it("another account can't read, edit, duplicate, run or delete it, even through its own project", async () => {
    await as(2);
    expect((await call(REPORT, "GET", `/api/v2/ga4/2/reports/${aReport}`, { id: "2", reportId: String(aReport) })).status).toBe(404);
    expect((await call(REPORT, "PUT", `/api/v2/ga4/2/reports/${aReport}`, { id: "2", reportId: String(aReport) }, { name: "taken", spec })).status).toBe(404);
    expect((await call(REPORTS, "POST", "/api/v2/ga4/2/reports", { id: "2" }, { duplicateOf: aReport })).status).toBe(404);
    expect((await call(RUN, "POST", "/api/v2/ga4/2/run", { id: "2" }, { spec, reportId: aReport })).status).toBe(404);
    expect((await call(REPORT, "DELETE", `/api/v2/ga4/2/reports/${aReport}`, { id: "2", reportId: String(aReport) })).status).toBe(404);
    expect((await call(REPORTS, "GET", "/api/v2/ga4/2/reports", { id: "2" })).json.reports).toEqual([]);
    // ...and A's own project id is not B's to use.
    expect((await call(REPORT, "GET", `/api/v2/ga4/1/reports/${aReport}`, { id: "1", reportId: String(aReport) })).status).toBe(404);
    const row = (await pg.query("SELECT name, user_id FROM ga4_saved_reports WHERE id = $1", [aReport])).rows[0];
    expect(row).toEqual({ name: "Channels", user_id: 1 });
  });

  it("duplicates and deletes for the owner", async () => {
    await as(1);
    const copy = await call(REPORTS, "POST", "/api/v2/ga4/1/reports", { id: "1" }, { duplicateOf: aReport });
    expect(copy.json.report.name).toBe("Copy of Channels");
    expect((await call(REPORT, "DELETE", `/api/v2/ga4/1/reports/${copy.json.report.id}`, { id: "1", reportId: String(copy.json.report.id) })).json.ok).toBe(true);
  });

  it("doesn't run or silently edit a report after the project's GA4 property changes; rebinding is explicit", async () => {
    await pg.exec("UPDATE projects SET ga_property_id = '112' WHERE id = 1");
    await as(1);
    const before = gaCalls.length;
    const run = await call(RUN, "POST", "/api/v2/ga4/1/run", { id: "1" }, { spec, reportId: aReport });
    expect(run.status).toBe(409);
    expect(run.json).toMatchObject({ state: "property-changed", savedPropertyId: "111", currentPropertyId: "112" });
    expect(gaCalls.length).toBe(before);
    expect((await call(REPORT, "PUT", `/api/v2/ga4/1/reports/${aReport}`, { id: "1", reportId: String(aReport) }, { name: "Channels", spec })).status).toBe(409);
    const view = await call(REPORT, "GET", `/api/v2/ga4/1/reports/${aReport}`, { id: "1", reportId: String(aReport) });
    expect(view.json.propertyChanged).toBe(true);
    const rebound = await call(REPORT, "PUT", `/api/v2/ga4/1/reports/${aReport}`, { id: "1", reportId: String(aReport) }, { name: "Channels", spec, rebind: true });
    expect(rebound.json.report.propertyId).toBe("112");
  });
});

describe("charts and scheduling", () => {
  it("lays out a trend one slot per day, so a missing GA4 day never shifts the comparison", async () => {
    const { alignSeries, daysOf, fillFor } = await import("@/lib/v2/ga4reports/days");
    const dates = daysOf({ start: "2026-10-01", end: "2026-10-04" });
    expect(dates).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    // GA4 returned no row for 10-02: a count is 0 that day, a rate is undefined (a gap).
    const pts = [
      { date: "2026-10-01", value: 5 },
      { date: "2026-10-03", value: 7 },
      { date: "2026-10-04", value: 1 },
    ];
    expect(alignSeries(pts, dates, fillFor("sessions"))).toEqual([5, 0, 7, 1]);
    expect(alignSeries(pts, dates, fillFor("engagementRate"))).toEqual([5, null, 7, 1]);
    expect(fillFor("averageSessionDuration")).toBeNull();
  });

  it("doesn't refresh GA4 reports on the schedule (only when read)", async () => {
    const { enqueueDueRefreshes } = await import("@/lib/sync/cache");
    await import("@/lib/sync/kinds");
    const now = Date.now();
    await pg.query(
      `INSERT INTO report_cache (scope, cache_key, kind, provider, user_id, project_id, query, payload, fetched_at, fresh_until, last_read_at)
       VALUES ('user:1', 'stale-ga4-custom', 'ga4:custom', 'ga4', 1, 1, '{"projectId":1}', '{}', 1, 1, $1),
              ('user:1', 'stale-ga4-template', 'ga4:template', 'ga4', 1, 1, '{"projectId":1}', '{}', 1, 1, $1)`,
      [now],
    );
    expect(await enqueueDueRefreshes({ activeSinceMs: 3600_000, limit: 50 })).toBe(0);
  });
});

describe("compatibility validation: the real adapter against Google's HTTP responses", { timeout: 30_000 }, () => {
  const CHECK = "@/app/api/v2/ga4/[id]/check/route";
  // The owner's reported definition (Preview, Góc Săn Deal): three dimensions, two metrics, table, sorted by sessions.
  const OWNER_SPEC = {
    dimensions: ["sessionDefaultChannelGroup", "eventName", "sessionSourceMedium"],
    metrics: ["sessions", "totalUsers"],
    preset: "last28",
    compare: "previous",
    filters: [],
    sort: { field: "sessions", desc: true },
    limit: 1000,
    chart: "table",
  };
  const P = { id: "2" };
  const savedCount = async () => (await pg.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM ga4_saved_reports WHERE project_id = 2")).rows[0].n;
  const clearLimits = () => pg.exec("DELETE FROM provider_cooldown; DELETE FROM provider_rate;");

  it("treats a successful response listing unselected incompatible fields as valid: the owner's report checks, saves, reopens, edits and duplicates", async () => {
    await as(2);
    const check = await call(CHECK, "POST", "/api/v2/ga4/2/check", P, { spec: OWNER_SPEC });
    expect(check.status).toBe(200);
    expect(check.json.ok).toBe(true);
    // Google was asked about exactly the report's fields (and no filter, since the report has none).
    expect(compatBodies.at(-1)).toMatchObject({
      dimensions: OWNER_SPEC.dimensions.map((name) => ({ name })),
      metrics: OWNER_SPEC.metrics.map((name) => ({ name })),
    });
    expect(compatBodies.at(-1)).not.toHaveProperty("dimensionFilter");

    const saved = await call(REPORTS, "POST", "/api/v2/ga4/2/reports", P, { name: "Test", spec: OWNER_SPEC });
    expect(saved.status).toBe(200);
    expect(saved.json.ok).toBe(true);
    const id = saved.json.report.id as number;
    expect(id).toBeGreaterThan(0);
    expect(saved.json.report).toMatchObject({ projectId: 2, propertyId: "222", name: "Test", spec: OWNER_SPEC });

    // Reopen as after a reload: the list and the single report come from the database.
    const list = await call(REPORTS, "GET", "/api/v2/ga4/2/reports", P);
    expect(list.json.reports.map((r: { id: number }) => r.id)).toContain(id);
    const one = await call(REPORT, "GET", `/api/v2/ga4/2/reports/${id}`, { ...P, reportId: String(id) });
    expect(one.json.report.spec).toEqual(OWNER_SPEC);
    expect(one.json.propertyChanged).toBe(false);

    const edited = await call(REPORT, "PUT", `/api/v2/ga4/2/reports/${id}`, { ...P, reportId: String(id) }, { name: "Test", spec: { ...OWNER_SPEC, limit: 500 } });
    expect(edited.json.ok).toBe(true);
    expect(edited.json.report.spec.limit).toBe(500);
    const copy = await call(REPORTS, "POST", "/api/v2/ga4/2/reports", P, { duplicateOf: id });
    expect(copy.json).toMatchObject({ ok: true, report: { name: "Copy of Test", projectId: 2 } });
  });

  it("sends the report's dimension filter to checkCompatibility, the same expression Run sends to runReport", async () => {
    await as(2);
    const spec = {
      ...OWNER_SPEC,
      limit: 999,
      filters: [
        { field: "eventName", op: "in", value: "generate_lead, purchase", negate: false },
        { field: "sessionSourceMedium", op: "contains", value: "google", negate: true },
      ],
    };
    const n = normalizeSpec(spec);
    if (!("spec" in n)) throw new Error(n.errors.join(" "));
    const expected = filterExpression(n.spec.filters);
    expect((await call(CHECK, "POST", "/api/v2/ga4/2/check", P, { spec })).json.ok).toBe(true);
    expect(compatBodies.at(-1)?.dimensionFilter).toEqual(expected);
    answer = (r) => (r.dimensions.length ? [] : [{ dims: [], range: 0, metrics: [1, 1] }]);
    const run = await call(RUN, "POST", "/api/v2/ga4/2/run", P, { spec });
    expect(run.json.state).toBe("live");
    expect(gaCalls.length).toBeGreaterThan(0);
    for (const c of gaCalls) expect(c.dimensionFilter).toEqual(expected);
  });

  it("rejects a genuinely incompatible request with Google's own reason, and saves nothing", async () => {
    await as(2);
    const before = await savedCount();
    compat = () => ({
      status: 400,
      body: googleError(400, "INVALID_ARGUMENT", "Please remove eventCount to make the request compatible. The request's dimensions & metrics are incompatible. To learn more, see https://ga-dev-tools.web.app/ga4/dimensions-metrics-explorer/"),
    });
    const spec = { ...OWNER_SPEC, metrics: ["sessions", "eventCount"] };
    const check = await call(CHECK, "POST", "/api/v2/ga4/2/check", P, { spec });
    expect(check.status).toBe(400);
    expect(check.json).toMatchObject({ ok: false, kind: "invalid" });
    expect(check.json.errors.join(" ")).toMatch(/Please remove eventCount to make the request compatible/);
    // Only the submitted report's problem: no catalogue fields, no invented pairs.
    expect(check.json.errors.join(" ")).not.toMatch(/brandingInterest|cohort|advertiser|organicGoogleSearch/);
    expect((await call(REPORTS, "POST", "/api/v2/ga4/2/reports", P, { name: "Clash", spec })).status).toBe(400);
    expect(await savedCount()).toBe(before);
  });

  it("rejects fields the property doesn't have before asking Google", async () => {
    await as(2);
    const r = await call(CHECK, "POST", "/api/v2/ga4/2/check", P, { spec: { ...OWNER_SPEC, metrics: ["sessions", "notAField"], sort: null } });
    expect(r.status).toBe(400);
    expect(r.json.errors.join(" ")).toMatch(/Not available in this GA4 property: notAField/);
    const f = await call(CHECK, "POST", "/api/v2/ga4/2/check", P, { spec: { ...OWNER_SPEC, filters: [{ field: "notADimension", op: "exact", value: "x", negate: false }] } });
    expect(f.json.errors.join(" ")).toMatch(/notADimension/);
    expect(compatBodies).toHaveLength(0);
  });

  it.each([
    ["permission", () => ({ status: 403, body: googleError(403, "PERMISSION_DENIED", "User does not have sufficient permissions for this property.") }), 403, "access"],
    ["quota", () => ({ status: 429, body: googleError(429, "RESOURCE_EXHAUSTED", "Exhausted property tokens per hour quota."), headers: { "Retry-After": "3600" } }), 429, "quota"],
    ["temporary provider error", () => ({ status: 503, body: googleError(503, "UNAVAILABLE", "The service is currently unavailable.") }), 503, "unavailable"],
    ["network failure", () => new TypeError("fetch failed"), 503, "unavailable"],
  ] as const)("reports a %s as such, never as a valid or invalid report, and saves nothing", async (_name, answerWith, status, kind) => {
    await as(2);
    const before = await savedCount();
    compat = answerWith as () => CompatAnswer;
    try {
      const check = await call(CHECK, "POST", "/api/v2/ga4/2/check", P, { spec: OWNER_SPEC });
      expect(check.status).toBe(status);
      expect(check.json).toMatchObject({ ok: false, kind });
      const save = await call(REPORTS, "POST", "/api/v2/ga4/2/reports", P, { name: "Not saved", spec: OWNER_SPEC });
      expect(save.status).toBe(status);
      expect(await savedCount()).toBe(before);
    } finally {
      await clearLimits();
    }
  });

  it("fails a definition GA4 rejects at Run once, without background retries", async () => {
    await as(2);
    const { GaApiError } = await import("@/lib/ga4");
    const { runDueJobs } = await import("@/lib/sync/cache");
    answer = () => {
      throw new GaApiError(400, JSON.stringify(googleError(400, "INVALID_ARGUMENT", "Please remove totalUsers to make the request compatible.")));
    };
    const spec = { ...OWNER_SPEC, limit: 998 };
    const run = await call(RUN, "POST", "/api/v2/ga4/2/run", P, { spec });
    expect(run.json.state).toBe("error");
    expect(run.json.message).toMatch(/GA4 rejected this report: Please remove totalUsers/);
    const job = (await pg.query<{ status: string }>("SELECT status FROM sync_jobs WHERE kind = 'ga4:custom' ORDER BY id DESC LIMIT 1")).rows[0];
    expect(job.status).toBe("failed");
    const calls = gaCalls.length;
    await runDueJobs({ limit: 10, budgetMs: 5_000 });
    expect(gaCalls.length).toBe(calls);
  });
});
