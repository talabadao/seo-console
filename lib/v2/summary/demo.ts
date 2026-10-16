// Invented summaries for demo projects (websites on the reserved .example
// domain), local mock mode, and the content workflow that doesn't exist yet.
// Every section produced here has state "demo"; nothing is ever marked live.
// Deterministic per project, so numbers don't jump between page loads.

import { addDaysYmd, daysBetween, taskMonth } from "./period";
import { evaluateKpi } from "./kpi";
import { rankCounts } from "@/lib/seranking/metrics";
import {
  CONTENT_STAGES,
  type ContentData,
  type Ga4Data,
  type GscData,
  type HealthData,
  type KpiData,
  type PeriodInfo,
  type RankingsData,
  type ProjectSummary,
  type Section,
  type SummaryPart,
  type TaskData,
  type TaskRef,
} from "./types";

/** True for a website on the reserved .example top-level domain (RFC 2606). */
export function isDemoWebsite(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    return host === "example" || host.endsWith(".example");
  } catch {
    return false;
  }
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function seedOf(id: number, salt: string): number {
  let h = 2166136261 ^ id;
  for (const ch of salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const SOURCE_NOTE = "Demo data: invented for illustration, not a measurement.";

function demo<T>(source: string, data: T, extra: Partial<Section<T>> = {}): Section<T> {
  return { state: "demo", source, message: SOURCE_NOTE, data, ...extra };
}

export function demoGsc(id: number, period: PeriodInfo, opts: { stale?: boolean } = {}): Section<GscData> {
  const r = rng(seedOf(id, "gsc"));
  const base = 120 + Math.floor(r() * 900);
  const trend = 0.75 + r() * 0.55; // current vs previous
  const days = daysBetween(period.current.start, period.current.end);
  const series: GscData["series"] = [];
  let clicks = 0;
  let impressions = 0;
  const lastDay = opts.stale ? days - 8 : days;
  for (let i = 0; i < lastDay; i++) {
    const weekday = (i % 7) / 7;
    const c = Math.max(0, Math.round((base / 7) * trend * (0.8 + 0.4 * Math.sin(weekday * Math.PI) + r() * 0.2)));
    const im = Math.round(c * (28 + r() * 14));
    clicks += c;
    impressions += im;
    series.push({ date: addDaysYmd(period.current.start, i), clicks: c, impressions: im });
  }
  const prevClicks = period.previous ? Math.round(clicks / trend) : null;
  const prevImpr = period.previous ? Math.round(impressions / (trend * 0.97)) : null;
  const position = 8 + r() * 14;
  const pick = (names: string[]) =>
    names.map((key, i) => {
      const cur = Math.max(0, Math.round((clicks / (i + 2.2)) * (0.5 + r())));
      const prevValue = i === 3 ? 0 : Math.max(0, Math.round(cur / (0.55 + r() * 0.9)));
      return { key, clicks: cur, previousClicks: period.previous ? prevValue : null };
    });
  const pages = pick(DEMO_PAGES.map((p) => `https://${DEMO_HOST}${p}`));
  const queries = pick(DEMO_QUERIES);
  const lists = (rows: { key: string; clicks: number; previousClicks: number | null }[]) => {
    const d = (x: { clicks: number; previousClicks: number | null }) => x.clicks - (x.previousClicks ?? 0);
    const known = rows.filter((x) => x.previousClicks != null);
    return {
      top: [...rows].sort((a, b) => b.clicks - a.clicks).slice(0, 5),
      up: known.filter((x) => d(x) > 0).sort((a, b) => d(b) - d(a)).slice(0, 5),
      down: known.filter((x) => d(x) < 0).sort((a, b) => d(a) - d(b)).slice(0, 5),
    };
  };
  return demo(
    "Google Search Console",
    {
      pages: lists(pages),
      queries: lists(queries),
      clicks: { current: clicks, previous: prevClicks },
      impressions: { current: impressions, previous: prevImpr },
      ctr: { current: impressions ? clicks / impressions : null, previous: prevClicks != null && prevImpr ? prevClicks / prevImpr : null },
      position: { current: position, previous: period.previous ? position + (r() - 0.4) * 2 : null },
      series,
    },
    {
      dataThrough: series.length ? series[series.length - 1].date : null,
      stale: Boolean(opts.stale),
    },
  );
}

export function demoGa4(id: number, period: PeriodInfo, opts: { revenue?: boolean } = {}): Section<Ga4Data> {
  const r = rng(seedOf(id, "ga4"));
  const sessions = 400 + Math.floor(r() * 3000);
  const trend = 0.78 + r() * 0.5;
  const engaged = Math.round(sessions * (0.5 + r() * 0.25));
  const key = Math.round(sessions * (0.01 + r() * 0.03));
  const prev = (v: number) => (period.previous ? Math.round(v / trend) : null);
  const withRevenue = opts.revenue ?? id % 2 === 1;
  const revenue = Math.round(key * (90 + r() * 160));
  const ai = Math.round(sessions * (0.02 + r() * 0.06));
  return demo(
    "Google Analytics 4",
    {
      sessions: { current: sessions, previous: prev(sessions) },
      aiSessions: { current: ai, previous: period.previous ? Math.round(ai / (0.7 + r() * 0.8)) : null },
      engagedSessions: { current: engaged, previous: prev(engaged) },
      keyEvents: { current: key, previous: prev(key) },
      revenue: withRevenue ? { current: revenue, previous: prev(revenue) } : null,
      currency: withRevenue ? "USD" : null,
    },
    { dataThrough: period.current.end },
  );
}

export function demoKpi(id: number, now: Date = new Date()): Section<KpiData> {
  const r = rng(seedOf(id, "kpi"));
  const m = taskMonth(now);
  const daysInMonth = Number(m.monthEnd.slice(8, 10));
  const daysElapsed = Math.max(1, Number(m.today.slice(8, 10)) - 1);
  const mk = (kid: string, label: string, target: number) => {
    const pace = 0.7 + r() * 0.5;
    const actual = Math.round((target * daysElapsed * pace) / daysInMonth);
    return evaluateKpi({ id: kid, label, actual, target, projected: Math.round(target * pace), monthComplete: false });
  };
  const monthLabel = new Date(`${m.monthStart}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return demo("Monthly targets (KPI settings) and GA4", {
    yearMonth: m.yearMonth,
    monthLabel,
    daysElapsed,
    daysInMonth,
    monthComplete: false,
    leadEvents: ["generate_lead", "book_now_click"],
    notes: [],
    items: [mk("traffic-organic", "Organic sessions", 2000 + Math.round(r() * 4000)), mk("lead-organic", "Organic leads", 20 + Math.round(r() * 60))],
  });
}

const TASKS = [
  "Publish spring offers landing page",
  "Fix redirect chain on /rooms",
  "Write blog: 10 things to do nearby",
  "Update meta titles for category pages",
  "Monthly report draft",
  "Add FAQ schema to service pages",
  "Compress hero images",
  "Outreach list for local partners",
  "Refresh Google Business Profile photos",
  "Internal links from top blog posts",
  "Rewrite spa packages page",
  "Audit 404s from Search Console",
  "Draft October newsletter article",
  "Add hreflang for the Vietnamese site",
  "Update opening hours on listings",
  "Keyword map for new service pages",
];
const PEOPLE = ["Alex (demo)", "Sam (demo)", "Jordan (demo)", null];

export function demoTasks(id: number, now: Date = new Date()): Section<TaskData> {
  const r = rng(seedOf(id, "tasks"));
  const m = taskMonth(now);
  const day = (offset: number) => addDaysYmd(m.today, offset);
  // Disjoint slices of the list: overdue (0-3), upcoming (4-8) and completed (9-15).
  const pick = (i: number) => TASKS[i % TASKS.length];
  const overdueN = Math.floor(r() * 4);
  const ref = (i: number, dueOn: string | null, status: TaskRef["status"], completedAt: string | null = null): TaskRef => ({
    gid: `demo-${id}-${i}`,
    name: pick(i),
    assignee: PEOPLE[i % PEOPLE.length],
    dueOn,
    completedAt,
    status,
    url: null,
  });
  const overdueTasks = Array.from({ length: overdueN }, (_, i) => ref(i, day(-(i + 2)), "overdue"));
  const upcoming = Array.from({ length: 3 + Math.floor(r() * 3) }, (_, i) => ref(i + 4, day(i * 3 + 1), "open"));
  const doneN = 3 + Math.floor(r() * 8);
  const recentlyCompleted = Array.from({ length: Math.min(doneN, 6) }, (_, i) =>
    ref(i + 9, day(-i - 1), "completed", `${day(-i)}T10:00:00.000Z`),
  );
  return demo("Asana", {
    yearMonth: m.yearMonth,
    monthStart: m.monthStart,
    monthEnd: m.monthEnd,
    today: m.today,
    dueThisMonth: doneN + upcoming.length + overdueN,
    completedThisMonth: doneN,
    overdue: overdueN,
    overdueTasks,
    upcoming,
    recentlyCompleted,
    projectUrl: null,
  });
}

const DEMO_HOST = "lumencoast.example";
const DEMO_PAGES = ["/", "/rooms/ocean-suite/", "/dining/", "/offers/spring-escape/", "/blog/things-to-do-nearby/", "/spa/"];
const DEMO_QUERIES = ["lumen coast resort", "beachfront resort with spa", "ocean suite hotel", "lumen coast dining", "spring escape package", "family resort near the beach"];

export function demoRankings(id: number, period: PeriodInfo, now: Date = new Date()): Section<RankingsData> {
  const r = rng(seedOf(id, "rank"));
  const tracked = 40 + Math.floor(r() * 80);
  const positions = (shift: number) =>
    Array.from({ length: tracked }, () => {
      const x = r();
      // About a fifth of keywords don't rank (outside the top 100): never position 0.
      return x < 0.2 ? null : Math.max(1, Math.min(100, Math.round(1 + x * x * 60 + shift)));
    });
  const latest = addDaysYmd(now.toISOString().slice(0, 10), -1);
  const days = period.previous ? daysBetween(period.current.start, period.current.end) : 7;
  return demo("SE Ranking", {
    context: {
      siteId: 0,
      siteTitle: "Demo SE Ranking project",
      siteUrl: `https://${DEMO_HOST}/`,
      engine: "Google Vietnam",
      region: "Ho Chi Minh City",
      language: "en",
      device: "desktop",
      keywordGroup: "All tracked keywords",
      trackedKeywords: tracked,
      otherEngines: 1,
      latestDate: latest,
      comparisonDate: addDaysYmd(latest, -days),
    },
    current: rankCounts(positions(0)),
    previous: rankCounts(positions(1 + r() * 3)),
  }, { dataThrough: latest });
}

/** Content progress: always demo until a real content workflow exists. */
export function demoContent(id: number): Section<ContentData> {
  const r = rng(seedOf(id, "content"));
  const counts = Object.fromEntries(CONTENT_STAGES.map((s) => [s, Math.floor(r() * (s === "published" ? 9 : 5))])) as ContentData["counts"];
  const titles = ["Guide: best time to visit", "Service page rewrite", "Local events roundup", "Case study draft"];
  const awaitingApproval = Array.from({ length: counts["client-review"] }, (_, i) => ({
    title: `${titles[i % titles.length]} (demo)`,
    stage: "client-review" as const,
    since: i === 0 ? "1 day" : `${1 + i * 2} days`,
  }));
  return { state: "demo", source: "Content workflow (not built yet)", message: "Demo data: the content workflow doesn't exist yet.", data: { counts, awaitingApproval } };
}

export function demoHealth(id: number): Section<HealthData> {
  return demo("Stored sync history", { lastSync: { status: "ok", finishedAt: null, message: null }, pageSpeedErrors: id % 3 === 0 ? 1 : 0, reviewsSyncError: null });
}

/** A full demo summary. `connected` hides sections the project has no source for (mock mode). */
export function demoSummary(
  project: { id: number; gscProperty?: string | null; gaPropertyId?: string | null; asanaProjectGid?: string },
  period: PeriodInfo,
  parts: SummaryPart[],
  opts: { respectConnections?: boolean; now?: Date } = {},
): ProjectSummary {
  const id = project.id;
  const has = (v: unknown) => !opts.respectConnections || Boolean(v);
  const notConnected = (source: string, what: string) => ({ state: "not-connected" as const, source, message: `No ${what} linked to this project.` });
  const out: ProjectSummary = { projectId: id, demo: true, period, generatedAt: (opts.now ?? new Date()).getTime() };
  for (const p of parts) {
    if (p === "gsc") out.gsc = has(project.gscProperty) ? demoGsc(id, period, { stale: id % 5 === 4 }) : notConnected("Google Search Console", "Search Console property");
    if (p === "ga4") out.ga4 = has(project.gaPropertyId) ? demoGa4(id, period) : notConnected("Google Analytics 4", "GA4 property");
    if (p === "kpi") out.kpi = has(project.gaPropertyId) ? demoKpi(id, opts.now) : notConnected("Monthly targets (KPI settings) and GA4", "GA4 property");
    if (p === "tasks") out.tasks = has(project.asanaProjectGid) ? demoTasks(id, opts.now) : notConnected("Asana", "Asana project");
    if (p === "content") out.content = demoContent(id);
    if (p === "health") out.health = demoHealth(id);
    if (p === "rankings") out.rankings = demoRankings(id, period, opts.now);
  }
  return out;
}
