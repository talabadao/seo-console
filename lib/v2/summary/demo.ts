// Invented summaries for demo projects (websites on the reserved .example
// domain), local mock mode, and the content workflow that doesn't exist yet.
// Every section produced here has state "demo"; nothing is ever marked live.
// Deterministic per project, so numbers don't jump between page loads.

import { addDaysYmd, daysBetween, taskMonth } from "./period";
import {
  CONTENT_STAGES,
  type ContentData,
  type Ga4Data,
  type GscData,
  type HealthData,
  type KpiData,
  type PeriodInfo,
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
  return demo(
    "Google Search Console",
    {
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
  return demo(
    "Google Analytics 4",
    {
      sessions: { current: sessions, previous: prev(sessions) },
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
    const projected = Math.round(target * pace);
    const projectedPct = (projected / target) * 100;
    return {
      id: kid,
      label,
      actual,
      target,
      projected,
      projectedPct,
      progressPct: (actual / target) * 100,
      status: projectedPct >= 100 ? ("on-track" as const) : projectedPct >= 85 ? ("at-risk" as const) : ("off-track" as const),
    };
  };
  const monthLabel = new Date(`${m.monthStart}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return demo("Monthly targets (KPI settings) and GA4", {
    yearMonth: m.yearMonth,
    monthLabel,
    daysElapsed,
    daysInMonth,
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
  }
  return out;
}
