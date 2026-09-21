import {
  KEY_EVENT_FILTER,
  andFilter,
  classifyTraffic,
  eqFilter,
  runReport,
  trendBreakdown,
  type DateRange,
  type TrendRow,
} from "@/lib/ga4";

/**
 * Sentinel value for the "AI (custom domain list)" channel filter option —
 * not a real GA4 sessionDefaultChannelGroup value. GA4's own "AI Assistant"
 * channel grouping is unreliable, so this app classifies AI traffic itself
 * via the AI-source domain list in Settings (same logic as the main
 * Analytics chart's Organic/AI/Other split) instead of trusting GA4's bucket.
 */
export const AI_CHANNEL = "__ai__";

/** Distinct session channel groups present in range, most-trafficked first — powers the Channel filter dropdown. */
export async function availableChannels(
  token: string,
  propertyId: string,
  current: DateRange,
): Promise<string[]> {
  const { rows } = await runReport(token, propertyId, {
    dimensions: ["sessionDefaultChannelGroup"],
    metrics: ["sessions"],
    dateRanges: [current],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 50,
  });
  return rows.map((r) => r.dims[0]).filter(Boolean);
}

/**
 * Runs a report grouped by `groupDim` plus session source/channel (needed to
 * classify each row), keeping only rows classifyTraffic() calls "ai" and
 * collapsing away the extra source/channel dims. Backs the "AI (custom)"
 * channel filter option for both Landing Pages and Key Events.
 */
async function aiClassifiedTrend(
  token: string,
  propertyId: string,
  current: DateRange,
  previous: DateRange | null,
  aiDomains: string[],
  groupDim: string,
  metrics: string[],
  extraFilter?: unknown,
): Promise<{ rows: TrendRow[]; sampled: boolean }> {
  const dateRanges = previous ? [current, previous] : [current];
  const { rows, sampled } = await runReport(token, propertyId, {
    dimensions: [groupDim, "sessionSource", "sessionDefaultChannelGroup"],
    metrics,
    dateRanges,
    dimensionFilter: extraFilter,
    limit: 100000,
  });

  const n = metrics.length;
  const map = new Map<string, TrendRow>();
  for (const r of rows) {
    if (classifyTraffic(r.dims[1], r.dims[2], aiDomains) !== "ai") continue;
    const key = r.dims[0];
    let row = map.get(key);
    if (!row) {
      row = { key, cur: Array(n).fill(0), prev: Array(n).fill(0), isNew: Boolean(previous) };
      map.set(key, row);
    }
    const target = r.range === 0 ? row.cur : row.prev;
    for (let i = 0; i < n; i++) target[i] += r.metrics[i] ?? 0;
    if (r.range === 1) row.isNew = false;
  }
  const out = [...map.values()].sort((a, b) => (b.cur[0] ?? 0) - (a.cur[0] ?? 0));
  return { rows: out, sampled };
}

/** Landing page (+query string) sessions/users/revenue/key events, optionally filtered to one channel. */
export async function landingPageTrend(
  token: string,
  propertyId: string,
  current: DateRange,
  previous: DateRange | null,
  channel: string,
  aiDomains: string[],
): Promise<{ rows: TrendRow[]; sampled: boolean }> {
  const metrics = ["sessions", "totalUsers", "totalRevenue", "keyEvents"];
  if (channel === AI_CHANNEL) {
    return aiClassifiedTrend(token, propertyId, current, previous, aiDomains, "landingPagePlusQueryString", metrics);
  }
  return trendBreakdown(token, propertyId, {
    dimensions: ["landingPagePlusQueryString"],
    metrics,
    current,
    previous,
    dimensionFilter: channel ? eqFilter("sessionDefaultChannelGroup", channel) : undefined,
    limit: 5000,
  });
}

/** Key events, optionally filtered to one channel — replaces the old plain Source/Medium filter. */
export async function keyEventsByChannel(
  token: string,
  propertyId: string,
  current: DateRange,
  previous: DateRange | null,
  channel: string,
  aiDomains: string[],
): Promise<{ rows: TrendRow[]; sampled: boolean }> {
  const metrics = ["keyEvents", "totalRevenue", "eventValue"];
  if (channel === AI_CHANNEL) {
    return aiClassifiedTrend(token, propertyId, current, previous, aiDomains, "eventName", metrics, KEY_EVENT_FILTER);
  }
  return trendBreakdown(token, propertyId, {
    dimensions: ["eventName"],
    metrics,
    current,
    previous,
    dimensionFilter: channel
      ? andFilter(KEY_EVENT_FILTER, eqFilter("sessionDefaultChannelGroup", channel))
      : KEY_EVENT_FILTER,
    limit: 2000,
  });
}

const iso8 = (yyyymmdd: string) =>
  yyyymmdd.length === 8
    ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
    : yyyymmdd;

export interface PagePerfRow {
  page: string;
  total: number;
  /** "yyyy-MM-dd" -> sessions that day. Sparse — a missing day means 0. */
  byDate: Record<string, number>;
}

/**
 * Per-landing-page daily sessions over a single range — the Page Performance
 * heatmap's data source. `total` is summed across every landing page GA4
 * returned (before the top-`take` cap), so it reflects true site-wide
 * landing-page traffic even though only the busiest pages are returned.
 */
export async function pagePerformanceMatrix(
  token: string,
  propertyId: string,
  range: DateRange,
  channel: string,
  aiDomains: string[],
  take: number = 50,
): Promise<{ rows: PagePerfRow[]; total: number; sampled: boolean }> {
  const needsClassification = channel === AI_CHANNEL;
  const { rows, sampled } = await runReport(token, propertyId, {
    dimensions: needsClassification
      ? ["date", "landingPagePlusQueryString", "sessionSource", "sessionDefaultChannelGroup"]
      : ["date", "landingPagePlusQueryString"],
    metrics: ["sessions"],
    dateRanges: [range],
    dimensionFilter: !needsClassification && channel ? eqFilter("sessionDefaultChannelGroup", channel) : undefined,
    limit: 100000,
  });

  const map = new Map<string, PagePerfRow>();
  let total = 0;
  for (const r of rows) {
    if (needsClassification && classifyTraffic(r.dims[2], r.dims[3], aiDomains) !== "ai") continue;
    const date = iso8(r.dims[0]);
    const page = r.dims[1];
    const v = r.metrics[0] ?? 0;
    let row = map.get(page);
    if (!row) {
      row = { page, total: 0, byDate: {} };
      map.set(page, row);
    }
    row.byDate[date] = (row.byDate[date] ?? 0) + v;
    row.total += v;
    total += v;
  }
  const out = [...map.values()].sort((a, b) => b.total - a.total).slice(0, take);
  return { rows: out, total, sampled };
}
