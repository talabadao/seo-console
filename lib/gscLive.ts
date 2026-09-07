import {
  searchAnalytics,
  searchAnalyticsAll,
  type SearchAnalyticsRow,
  type SearchType,
} from "@/lib/google/searchconsole";
import { bucketLabel, bucketOf, type Grain, type Range } from "@/lib/dateRanges";

export interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SeriesPoint extends Totals {
  bucket: string;
  label: string;
}

export interface BreakdownRow extends Totals {
  key: string;
  prevClicks: number;
  prevImpressions: number;
  prevCtr: number;
  prevPosition: number;
  isNew: boolean;
}

export interface LiveReport {
  totals: Totals;
  prevTotals: Totals | null;
  series: SeriesPoint[];
  prevSeries: SeriesPoint[] | null;
  breakdown: BreakdownRow[];
  dimension: string;
  truncated: boolean;
}

const EMPTY: Totals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

function fold(rows: { clicks: number; impressions: number; position: number }[]): Totals {
  let clicks = 0,
    impressions = 0,
    posw = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    posw += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? posw / impressions : 0,
  };
}

function bucketSeries(rows: SearchAnalyticsRow[], grain: Grain): SeriesPoint[] {
  const map = new Map<string, SearchAnalyticsRow[]>();
  for (const r of rows) {
    const b = bucketOf(r.keys![0], grain);
    let arr = map.get(b);
    if (!arr) map.set(b, (arr = []));
    arr.push(r);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bucket, rs]) => ({ bucket, label: bucketLabel(bucket, grain), ...fold(rs) }));
}

/** Discover/News search types don't support the `query` or `position` fields. */
export function dimensionSupported(dimension: string, type: SearchType): boolean {
  if (type === "discover" || type === "googleNews") {
    return dimension === "page" || dimension === "country" || dimension === "date";
  }
  return true;
}

export async function fetchLiveReport(opts: {
  token: string;
  property: string;
  current: Range;
  previous: Range | null;
  searchType: SearchType;
  grain: Grain;
  dimension: string; // query | page | country | device | searchAppearance
  maxRows?: number;
}): Promise<LiveReport> {
  const { token, property, current, previous, searchType, grain, dimension } = opts;
  const maxRows = opts.maxRows ?? 50000;
  const type = searchType;

  const canBreakdown = dimensionSupported(dimension, type);
  const cur = { startDate: current.start, endDate: current.end };
  const prv = previous ? { startDate: previous.start, endDate: previous.end } : null;
  const soft = (p: Promise<SearchAnalyticsRow[]>) => p.catch(() => [] as SearchAnalyticsRow[]);
  const none = Promise.resolve([] as SearchAnalyticsRow[]);

  const [curTotalsRows, curDateRows, curBreak, prevTotalsRows, prevDateRows, prevBreak] =
    await Promise.all([
      searchAnalytics(token, property, { ...cur, type, dataState: "all" }),
      soft(
        searchAnalytics(token, property, {
          ...cur,
          type,
          dimensions: ["date"],
          dataState: "all",
          rowLimit: 25000,
        }),
      ),
      canBreakdown
        ? soft(
            searchAnalyticsAll(
              token,
              property,
              { ...cur, type, dimensions: [dimension], dataState: "all" },
              maxRows,
            ),
          )
        : none,
      prv ? soft(searchAnalytics(token, property, { ...prv, type, dataState: "all" })) : none,
      prv
        ? soft(
            searchAnalytics(token, property, {
              ...prv,
              type,
              dimensions: ["date"],
              dataState: "all",
              rowLimit: 25000,
            }),
          )
        : none,
      prv && canBreakdown
        ? soft(
            searchAnalyticsAll(
              token,
              property,
              { ...prv, type, dimensions: [dimension], dataState: "all" },
              maxRows,
            ),
          )
        : none,
    ]);

  const totals: Totals = curTotalsRows[0]
    ? {
        clicks: curTotalsRows[0].clicks,
        impressions: curTotalsRows[0].impressions,
        ctr: curTotalsRows[0].ctr,
        position: curTotalsRows[0].position,
      }
    : { ...EMPTY };

  const prevTotals: Totals | null = previous
    ? prevTotalsRows[0]
      ? {
          clicks: prevTotalsRows[0].clicks,
          impressions: prevTotalsRows[0].impressions,
          ctr: prevTotalsRows[0].ctr,
          position: prevTotalsRows[0].position,
        }
      : { ...EMPTY }
    : null;

  const series = bucketSeries(curDateRows, grain);
  let prevSeries: SeriesPoint[] | null = null;
  if (previous && prevDateRows.length) {
    // Re-index previous buckets onto the current series positions for overlay.
    const raw = bucketSeries(prevDateRows, grain);
    prevSeries = raw.map((pt, i) => ({
      ...pt,
      bucket: series[i]?.bucket ?? pt.bucket,
      label: series[i]?.label ?? pt.label,
    }));
  }

  const prevMap = new Map<string, SearchAnalyticsRow>();
  for (const r of prevBreak) prevMap.set(r.keys![0], r);

  const breakdown: BreakdownRow[] = curBreak.map((r) => {
    const key = r.keys![0];
    const p = prevMap.get(key);
    return {
      key,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      prevClicks: p?.clicks ?? 0,
      prevImpressions: p?.impressions ?? 0,
      prevCtr: p?.ctr ?? 0,
      prevPosition: p?.position ?? 0,
      isNew: Boolean(previous) && !p,
    };
  });

  return {
    totals,
    prevTotals,
    series,
    prevSeries,
    breakdown,
    dimension,
    truncated: canBreakdown && curBreak.length >= maxRows,
  };
}

export { fold };
