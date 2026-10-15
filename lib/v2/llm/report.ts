// LLMs Traffic report (server). See platforms.ts for what counts as AI traffic.
//
// Metric definitions shown in the UI:
// - Sessions: GA4 `sessions`, by the session's source (`sessionSource`).
// - Users: GA4 `activeUsers` ("Active users", what GA4's reports call Users). Users are never added up
//   across platforms, days or rows: every user total comes from its own GA4 query (overall, per platform,
//   per trend bucket per platform), so a person who arrived from two assistants is counted once overall.
// - Avg. session duration: GA4 `averageSessionDuration` (wall-clock, includes idle time).
// - Avg. engagement time per session: `userEngagementDuration` ÷ `sessions` (foreground time only).
// - Bounce rate: GA4 `bounceRate` (share of sessions that weren't engaged).
// - Pages per session: GA4 `screenPageViewsPerSession`.
// Averages for a platform with several sources are weighted by sessions. Hours and days are in the GA4
// property's own timezone (GA4 reports them that way); no conversion is applied.

import { runReport, Semaphore } from "@/lib/ga4";
import type { MetricPair, PeriodInfo } from "@/lib/v2/summary/types";
import { domainsOfPlatform, platformOf, sourceFilter, Weighted, type Platform } from "./platforms";

export type LlmMetric = "sessions" | "users";
export type Granularity = "day" | "week" | "month";

export interface Breakdown {
  rows: { key: string; value: number }[];
  /** The filtered total for the metric (its own query for users). Rows can sum to less (thresholding, row limits). */
  total: number;
}

export interface LlmReport {
  metric: LlmMetric;
  metricLabel: string;
  platformFilter: string;
  timeZone: string | null;
  period: PeriodInfo;
  aiDomains: string[];
  /** Every AI platform seen in the period (unfiltered), with the selected metric. */
  platforms: (Platform & { value: MetricPair })[];
  /** All AI traffic for the selected metric (users from one query, never a sum). */
  total: MetricPair;
  /** Session share by platform. Null for users, which can overlap between platforms. */
  share: (Platform & { sessions: number; pct: number })[] | null;
  trend: { granularity: Granularity; buckets: string[]; series: (Platform & { values: number[] })[] };
  engagement: (Platform & {
    sessions: number;
    engagementRate: number | null;
    avgSessionDuration: number | null;
    avgEngagementTimePerSession: number | null;
    pagesPerSession: number | null;
    bounceRate: number | null;
  })[];
  landingPages: { platform: Platform; page: string; sessions: number; avgSessionDuration: number | null; bounceRate: number | null }[];
  countries: Breakdown;
  cities: Breakdown;
  browsers: Breakdown;
  devices: Breakdown;
  /** dayOfWeek 0 = Sunday (GA4), hour 0-23, in the property's timezone. */
  heatmap: { day: number; hour: number; value: number }[];
  sampled: boolean;
  fetchedAt: number;
}

const BUCKET_DIM: Record<Granularity, string> = { day: "date", week: "isoYearIsoWeek", month: "yearMonth" };

function bucketLabel(g: Granularity, raw: string): string {
  if (g === "day") return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (g === "week") return `${raw.slice(0, 4)}-W${raw.slice(4)}`;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
}

export async function llmReport(opts: {
  token: string;
  propertyId: string;
  timeZone: string | null;
  aiDomains: string[];
  period: PeriodInfo;
  metric: LlmMetric;
  granularity: Granularity;
  platformFilter: string;
}): Promise<LlmReport> {
  const { token, propertyId, aiDomains, period, metric, granularity } = opts;
  const sem = new Semaphore(3);
  const run = (o: Parameters<typeof runReport>[2]) => sem.run(() => runReport(token, propertyId, o));
  const metricName = metric === "users" ? "activeUsers" : "sessions";
  const cur = { startDate: period.current.start, endDate: period.current.end };
  const prev = period.previous ? { startDate: period.previous.start, endDate: period.previous.end } : null;
  const ranges = prev ? [cur, prev] : [cur];
  const allFilter = sourceFilter(aiDomains);
  const selectedDomains = opts.platformFilter === "all" ? aiDomains : domainsOfPlatform(opts.platformFilter, aiDomains);
  const filter = sourceFilter(selectedDomains.length ? selectedDomains : aiDomains);
  let sampled = false;
  const track = <T extends { sampled: boolean }>(r: T) => {
    if (r.sampled) sampled = true;
    return r;
  };

  // Sessions by source (current + comparison), unfiltered by platform: cards, share, engagement.
  const bySource = track(
    await run({
      dimensions: ["sessionSource"],
      metrics: ["sessions", "engagedSessions", "averageSessionDuration", "userEngagementDuration", "screenPageViewsPerSession", "bounceRate"],
      dateRanges: ranges,
      dimensionFilter: allFilter,
      limit: 1000,
    }),
  );
  const platforms = new Map<string, Platform & { sessions: [number, number]; w: Weighted; engaged: number; engagementTime: number }>();
  for (const r of bySource.rows) {
    const p = platformOf(r.dims[0] ?? "", aiDomains);
    if (!p) continue; // GA4's "contains" filter can be wider than the list; classifyTraffic decides.
    const e = platforms.get(p.id) ?? { ...p, sessions: [0, 0] as [number, number], w: new Weighted(), engaged: 0, engagementTime: 0 };
    const [sessions, engaged, avgDur, engTime, pps, bounce] = r.metrics;
    e.sessions[r.range] += sessions ?? 0;
    if (r.range === 0) {
      e.w.add(sessions ?? 0, { avgDur: avgDur ?? 0, pps: pps ?? 0, bounce: bounce ?? 0 });
      e.engaged += engaged ?? 0;
      e.engagementTime += engTime ?? 0;
    }
    platforms.set(p.id, e);
  }
  const list = [...platforms.values()].sort((a, b) => b.sessions[0] - a.sessions[0]);

  // Users: one query per platform (and one overall), never sums.
  const usersOf = async (domains: string[]) => {
    const r = track(await run({ dimensions: [], metrics: ["activeUsers"], dateRanges: ranges, dimensionFilter: sourceFilter(domains) }));
    const get = (range: number) => r.rows.find((x) => x.range === range)?.metrics[0] ?? 0;
    return { current: get(0), previous: prev ? get(1) : null };
  };
  const platformValues: Record<string, MetricPair> = {};
  let total: MetricPair;
  if (metric === "users") {
    await Promise.all(list.map(async (p) => (platformValues[p.id] = await usersOf(domainsOfPlatform(p.id, aiDomains)))));
    total = await usersOf(aiDomains);
  } else {
    for (const p of list) platformValues[p.id] = { current: p.sessions[0], previous: prev ? p.sessions[1] : null };
    total = { current: list.reduce((a, p) => a + p.sessions[0], 0), previous: prev ? list.reduce((a, p) => a + p.sessions[1], 0) : null };
  }

  const shown = opts.platformFilter === "all" ? list : list.filter((p) => p.id === opts.platformFilter);

  // Trend per platform. Sessions: one query by bucket and source. Users: one query per platform.
  const bucketDim = BUCKET_DIM[granularity];
  const series = new Map<string, Map<string, number>>();
  if (metric === "sessions") {
    const r = track(await run({ dimensions: [bucketDim, "sessionSource"], metrics: ["sessions"], dateRanges: [cur], dimensionFilter: filter, limit: 100000 }));
    for (const row of r.rows) {
      const p = platformOf(row.dims[1] ?? "", aiDomains);
      if (!p || !shown.some((s) => s.id === p.id)) continue;
      const m = series.get(p.id) ?? new Map();
      m.set(row.dims[0], (m.get(row.dims[0]) ?? 0) + (row.metrics[0] ?? 0));
      series.set(p.id, m);
    }
  } else {
    await Promise.all(
      shown.map(async (p) => {
        const r = track(
          await run({ dimensions: [bucketDim], metrics: ["activeUsers"], dateRanges: [cur], dimensionFilter: sourceFilter(domainsOfPlatform(p.id, aiDomains)), limit: 10000 }),
        );
        series.set(p.id, new Map(r.rows.map((row) => [row.dims[0], row.metrics[0] ?? 0])));
      }),
    );
  }
  const buckets = [...new Set([...series.values()].flatMap((m) => [...m.keys()]))].sort();

  // Breakdowns for the selected platform(s).
  const breakdown = async (dimension: string, limit = 250): Promise<Breakdown> => {
    const r = track(await run({ dimensions: [dimension], metrics: [metricName], dateRanges: [cur], dimensionFilter: filter, limit, orderBys: [{ metric: { metricName }, desc: true }] }));
    return { rows: r.rows.map((x) => ({ key: x.dims[0] || "(not set)", value: x.metrics[0] ?? 0 })), total: 0 };
  };
  const filteredTotal = async (): Promise<number> => {
    const r = track(await run({ dimensions: [], metrics: [metricName], dateRanges: [cur], dimensionFilter: filter }));
    return r.rows[0]?.metrics[0] ?? 0;
  };
  const [countries, cities, browsers, devices, heat, landing, selTotal] = await Promise.all([
    breakdown("country"),
    breakdown("city"),
    breakdown("browser"),
    breakdown("deviceCategory"),
    run({ dimensions: ["dayOfWeek", "hour"], metrics: [metricName], dateRanges: [cur], dimensionFilter: filter, limit: 200 }).then(track),
    run({
      dimensions: ["landingPage", "sessionSource"],
      metrics: ["sessions", "averageSessionDuration", "bounceRate"],
      dateRanges: [cur],
      dimensionFilter: filter,
      limit: 2000,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    }).then(track),
    filteredTotal(),
  ]);
  for (const b of [countries, cities, browsers, devices]) b.total = selTotal;

  const pages = new Map<string, { platform: Platform; page: string; w: Weighted }>();
  for (const r of landing.rows) {
    const p = platformOf(r.dims[1] ?? "", aiDomains);
    if (!p) continue;
    const key = `${p.id}\u0000${r.dims[0]}`;
    const e = pages.get(key) ?? { platform: p, page: r.dims[0] || "(not set)", w: new Weighted() };
    e.w.add(r.metrics[0] ?? 0, { dur: r.metrics[1] ?? 0, bounce: r.metrics[2] ?? 0 });
    pages.set(key, e);
  }

  const sessionsTotal = list.reduce((a, p) => a + p.sessions[0], 0);
  const strip = (p: Platform & object): Platform => ({ id: p.id, name: p.name, color: p.color });
  return {
    metric,
    metricLabel: metric === "users" ? "Users (GA4 active users)" : "Sessions",
    platformFilter: opts.platformFilter,
    timeZone: opts.timeZone,
    period,
    aiDomains,
    platforms: list.map((p) => ({ ...strip(p), value: platformValues[p.id] })),
    total,
    share: metric === "sessions" ? list.map((p) => ({ ...strip(p), sessions: p.sessions[0], pct: sessionsTotal ? (p.sessions[0] / sessionsTotal) * 100 : 0 })) : null,
    trend: {
      granularity,
      buckets: buckets.map((b) => bucketLabel(granularity, b)),
      series: shown.map((p) => ({ ...strip(p), values: buckets.map((b) => series.get(p.id)?.get(b) ?? 0) })),
    },
    engagement: list.map((p) => ({
      ...strip(p),
      sessions: p.sessions[0],
      engagementRate: p.sessions[0] ? p.engaged / p.sessions[0] : null,
      avgSessionDuration: p.w.avg("avgDur"),
      avgEngagementTimePerSession: p.sessions[0] ? p.engagementTime / p.sessions[0] : null,
      pagesPerSession: p.w.avg("pps"),
      bounceRate: p.w.avg("bounce"),
    })),
    landingPages: [...pages.values()]
      .sort((a, b) => b.w.sessions - a.w.sessions)
      .slice(0, 50)
      .map((e) => ({ platform: e.platform, page: e.page, sessions: e.w.sessions, avgSessionDuration: e.w.avg("dur"), bounceRate: e.w.avg("bounce") })),
    countries,
    cities,
    browsers,
    devices,
    heatmap: heat.rows.map((r) => ({ day: Number(r.dims[0]), hour: Number(r.dims[1]), value: r.metrics[0] ?? 0 })),
    sampled,
    fetchedAt: Date.now(),
  };
}
