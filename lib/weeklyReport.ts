import {
  differenceInCalendarDays,
  endOfMonth,
  format,
  getDaysInMonth,
  parseISO,
  startOfMonth,
  subDays,
} from "date-fns";
import { db } from "@/lib/db";
import { resolveComparison, enumerateBuckets, type Range } from "@/lib/dateRanges";
import {
  classifyTraffic,
  inFilter,
  runReport,
  type DateRange,
  type GaRow,
} from "@/lib/ga4";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const toDateRange = (r: Range): DateRange => ({ startDate: r.start, endDate: r.end });
const iso8 = (yyyymmdd: string) =>
  yyyymmdd.length === 8
    ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
    : yyyymmdd;

// ---------- report windows ----------

export interface ReportWindows {
  mtd: Range;
  mtdPrev: Range;
  mtdYoy: Range;
  last7: Range;
  prev7: Range;
  last30: Range;
  prev30: Range;
  monthLabel: string;
  monthStartLabel: string;
  monthEndLabel: string;
  daysInMonth: number;
  daysElapsed: number;
  yearMonth: string;
}

/** Every date window the Weekly Report / Insights dashboards need, anchored on "now". */
export function reportWindows(anchor: Date = new Date()): ReportWindows {
  const end = subDays(anchor, 1); // GA4 data lags ~1 day, same anchor the rest of the app uses
  const monthStart = startOfMonth(end);
  const mtd: Range = { start: ymd(monthStart), end: ymd(end) };
  const last7: Range = { start: ymd(subDays(end, 6)), end: ymd(end) };
  const last30: Range = { start: ymd(subDays(end, 29)), end: ymd(end) };
  return {
    mtd,
    mtdPrev: resolveComparison(mtd, "previous")!,
    mtdYoy: resolveComparison(mtd, "yoy")!,
    last7,
    prev7: resolveComparison(last7, "previous")!,
    last30,
    prev30: resolveComparison(last30, "previous")!,
    monthLabel: format(end, "MMMM"),
    monthStartLabel: format(monthStart, "MMM d, yyyy"),
    monthEndLabel: format(endOfMonth(end), "MMM d, yyyy"),
    daysInMonth: getDaysInMonth(end),
    daysElapsed: differenceInCalendarDays(end, monthStart) + 1,
    yearMonth: format(end, "yyyy-MM"),
  };
}

// ---------- traffic / leads totals + daily series ----------

export interface DailyPoint {
  bucket: string;
  label: string;
  organic: number;
  ai: number;
  other: number;
}

export interface TrafficTotals {
  organic: number;
  ai: number;
  other: number;
  total: number;
}

export interface TrafficPair {
  curTotals: TrafficTotals;
  prevTotals: TrafficTotals | null;
  series: DailyPoint[];
  prevSeries: DailyPoint[] | null;
}

function emptyTotals(): TrafficTotals {
  return { organic: 0, ai: 0, other: 0, total: 0 };
}

function buildSeries(
  rows: GaRow[],
  range: number,
  span: Range,
  aiDomains: string[],
  dateIdx: number,
  sourceIdx: number,
  channelIdx: number,
  metricIdx: number,
): { series: DailyPoint[]; totals: TrafficTotals } {
  const m = new Map<string, DailyPoint>();
  for (const b of enumerateBuckets(span, "day")) {
    m.set(b, { bucket: b, label: format(parseISO(b), "MMM d"), organic: 0, ai: 0, other: 0 });
  }
  const totals = emptyTotals();
  for (const r of rows) {
    if (r.range !== range) continue;
    const day = iso8(r.dims[dateIdx]);
    const kind = classifyTraffic(r.dims[sourceIdx] ?? "", r.dims[channelIdx] ?? "", aiDomains);
    const v = r.metrics[metricIdx] ?? 0;
    totals[kind] += v;
    totals.total += v;
    const row = m.get(day);
    if (row) row[kind] += v;
  }
  return { series: [...m.values()], totals };
}

/** Session totals (Organic / AI) for a window, optionally paired with a comparison window. */
export async function trafficPair(
  token: string,
  propertyId: string,
  current: Range,
  previous: Range | null,
  aiDomains: string[],
): Promise<TrafficPair> {
  const { rows } = await runReport(token, propertyId, {
    dimensions: ["date", "sessionSource", "sessionDefaultChannelGroup"],
    metrics: ["sessions"],
    dateRanges: previous ? [toDateRange(current), toDateRange(previous)] : [toDateRange(current)],
    limit: 100000,
  });
  const cur = buildSeries(rows, 0, current, aiDomains, 0, 1, 2, 0);
  const prev = previous ? buildSeries(rows, 1, previous, aiDomains, 0, 1, 2, 0) : null;
  return {
    curTotals: cur.totals,
    prevTotals: prev?.totals ?? null,
    series: cur.series,
    prevSeries: prev?.series ?? null,
  };
}

/** Event-count totals (Organic / AI) for whichever event names count as "leads". */
export async function leadsPair(
  token: string,
  propertyId: string,
  current: Range,
  previous: Range | null,
  aiDomains: string[],
  leadEvents: string[],
): Promise<TrafficPair> {
  if (!leadEvents.length) {
    const zero: DailyPoint[] = enumerateBuckets(current, "day").map((b) => ({
      bucket: b,
      label: format(parseISO(b), "MMM d"),
      organic: 0,
      ai: 0,
      other: 0,
    }));
    const prevZero = previous
      ? enumerateBuckets(previous, "day").map((b) => ({
          bucket: b,
          label: format(parseISO(b), "MMM d"),
          organic: 0,
          ai: 0,
          other: 0,
        }))
      : null;
    return { curTotals: emptyTotals(), prevTotals: previous ? emptyTotals() : null, series: zero, prevSeries: prevZero };
  }
  const { rows } = await runReport(token, propertyId, {
    dimensions: ["date", "eventName", "sessionSource", "sessionDefaultChannelGroup"],
    metrics: ["eventCount"],
    dateRanges: previous ? [toDateRange(current), toDateRange(previous)] : [toDateRange(current)],
    dimensionFilter: inFilter("eventName", leadEvents),
    limit: 100000,
  });
  const cur = buildSeries(rows, 0, current, aiDomains, 0, 2, 3, 0);
  const prev = previous ? buildSeries(rows, 1, previous, aiDomains, 0, 2, 3, 0) : null;
  return {
    curTotals: cur.totals,
    prevTotals: prev?.totals ?? null,
    series: cur.series,
    prevSeries: prev?.series ?? null,
  };
}

/** Distinct event names seen in the last 30 days, for the "select events as KPIs" picker. */
export async function availableEvents(
  token: string,
  propertyId: string,
  range: Range,
): Promise<{ name: string; count: number }[]> {
  const { rows } = await runReport(token, propertyId, {
    dimensions: ["eventName"],
    metrics: ["eventCount"],
    dateRanges: [toDateRange(range)],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 200,
  });
  return rows.map((r) => ({ name: r.dims[0], count: r.metrics[0] ?? 0 })).filter((r) => r.name);
}

// ---------- top / bottom performing URLs ----------

export interface UrlChange {
  url: string;
  cur: number;
  prev: number;
  pct: number | null; // null = brand-new (no baseline to compare against)
}

/** Combined Organic + AI sessions per landing page, current vs previous window. */
export async function topBottomUrls(
  token: string,
  propertyId: string,
  current: Range,
  previous: Range,
  aiDomains: string[],
  opts: { minBaseline?: number; take?: number } = {},
): Promise<{ top: UrlChange[]; bottom: UrlChange[] }> {
  const minBaseline = opts.minBaseline ?? 5;
  const take = opts.take ?? 3;
  const { rows } = await runReport(token, propertyId, {
    dimensions: ["landingPage", "sessionSource", "sessionDefaultChannelGroup"],
    metrics: ["sessions"],
    dateRanges: [toDateRange(current), toDateRange(previous)],
    limit: 100000,
  });

  const cur = new Map<string, number>();
  const prev = new Map<string, number>();
  for (const r of rows) {
    const [url, source, channel] = r.dims;
    const kind = classifyTraffic(source, channel, aiDomains);
    if (kind === "other") continue; // "focusing on Organic & AI sessions"
    const v = r.metrics[0] ?? 0;
    const m = r.range === 0 ? cur : prev;
    m.set(url, (m.get(url) ?? 0) + v);
  }

  const urls = new Set([...cur.keys(), ...prev.keys()]);
  const changes: UrlChange[] = [...urls].map((url) => {
    const c = cur.get(url) ?? 0;
    const p = prev.get(url) ?? 0;
    return { url, cur: c, prev: p, pct: p >= minBaseline ? ((c - p) / p) * 100 : null };
  });

  const withBaseline = changes.filter((c) => c.pct !== null);
  const top = [...withBaseline].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, take);
  const bottom = [...withBaseline]
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
    .slice(0, take)
    .filter((c) => (c.pct ?? 0) < 0);

  return { top, bottom };
}

// ---------- KPI forecast ----------

export type Pace = "on-track" | "at-risk" | "off-track";

export interface KpiCard {
  actualMtd: number;
  last30Total: number;
  target: number;
  projected: number;
  projectedPct: number; // projected / target * 100
  expectedByNowPct: number; // linear pace target as of today, as % of target
  paceDeltaPct: number; // how far actual MTD is from the linear pace, as %
  pace: Pace;
}

function paceFor(projectedPct: number): Pace {
  if (!isFinite(projectedPct)) return "off-track";
  if (projectedPct >= 100) return "on-track";
  if (projectedPct >= 85) return "at-risk";
  return "off-track";
}

export function buildKpiCard(actualMtd: number, last30Total: number, target: number, w: ReportWindows): KpiCard {
  const dailyRate = last30Total / 30;
  const projected = dailyRate * w.daysInMonth;
  const projectedPct = target > 0 ? (projected / target) * 100 : projected > 0 ? Infinity : 0;
  const expectedByNowPct = (w.daysElapsed / w.daysInMonth) * 100;
  const expectedByNow = target * (w.daysElapsed / w.daysInMonth);
  const paceDeltaPct = expectedByNow > 0 ? ((actualMtd - expectedByNow) / expectedByNow) * 100 : 0;
  return {
    actualMtd,
    last30Total,
    target,
    projected,
    projectedPct,
    expectedByNowPct,
    paceDeltaPct,
    pace: paceFor(projectedPct),
  };
}

// ---------- config (manual monthly targets + lead-event selection) ----------

export interface KpiConfig {
  yearMonth: string;
  trafficOrganicTarget: number;
  trafficAiTarget: number;
  leadOrganicTarget: number;
  leadAiTarget: number;
  leadEvents: string[];
}

function defaultConfig(yearMonth: string): KpiConfig {
  return {
    yearMonth,
    trafficOrganicTarget: 0,
    trafficAiTarget: 0,
    leadOrganicTarget: 0,
    leadAiTarget: 0,
    leadEvents: [],
  };
}

export async function configFor(userId: number, propertyId: string, yearMonth: string): Promise<KpiConfig> {
  const row = (await db
    .prepare(
      `SELECT traffic_organic_target, traffic_ai_target, lead_organic_target, lead_ai_target, lead_events
       FROM weekly_kpi_config WHERE user_id = ? AND property_id = ? AND year_month = ?`,
    )
    .get(userId, propertyId, yearMonth)) as
    | {
        traffic_organic_target: number;
        traffic_ai_target: number;
        lead_organic_target: number;
        lead_ai_target: number;
        lead_events: string;
      }
    | undefined;
  if (!row) return defaultConfig(yearMonth);
  let leadEvents: string[] = [];
  try {
    const parsed = JSON.parse(row.lead_events);
    if (Array.isArray(parsed)) leadEvents = parsed.map(String);
  } catch {
    // ignore malformed JSON, fall back to no lead events selected
  }
  return {
    yearMonth,
    trafficOrganicTarget: Number(row.traffic_organic_target) || 0,
    trafficAiTarget: Number(row.traffic_ai_target) || 0,
    leadOrganicTarget: Number(row.lead_organic_target) || 0,
    leadAiTarget: Number(row.lead_ai_target) || 0,
    leadEvents,
  };
}

export async function saveConfig(userId: number, propertyId: string, cfg: KpiConfig): Promise<void> {
  await db
    .prepare(
      `INSERT INTO weekly_kpi_config
         (user_id, property_id, year_month, traffic_organic_target, traffic_ai_target,
          lead_organic_target, lead_ai_target, lead_events, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, property_id, year_month) DO UPDATE SET
         traffic_organic_target = EXCLUDED.traffic_organic_target,
         traffic_ai_target = EXCLUDED.traffic_ai_target,
         lead_organic_target = EXCLUDED.lead_organic_target,
         lead_ai_target = EXCLUDED.lead_ai_target,
         lead_events = EXCLUDED.lead_events,
         updated_at = EXCLUDED.updated_at`,
    )
    .run(
      userId,
      propertyId,
      cfg.yearMonth,
      cfg.trafficOrganicTarget,
      cfg.trafficAiTarget,
      cfg.leadOrganicTarget,
      cfg.leadAiTarget,
      JSON.stringify(cfg.leadEvents),
      Date.now(),
    );
}
