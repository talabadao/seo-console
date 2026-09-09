import { searchAnalyticsAll, type SearchType } from "@/lib/google/searchconsole";
import { isBranded } from "@/lib/queryFilters";
import type { Range } from "@/lib/dateRanges";

export interface RowStat {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

const zero: RowStat = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

function foldWeighted(rows: RowStat[]): RowStat {
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

/** Typical organic CTR by rank — used to spot under-clicked queries. */
const CTR_CURVE = [0.28, 0.15, 0.11, 0.08, 0.067, 0.055, 0.045, 0.037, 0.031, 0.028];
export function expectedCtr(position: number): number {
  if (position < 1) return CTR_CURVE[0];
  if (position >= 10.5) return 0.02;
  const i = Math.round(position) - 1;
  return CTR_CURVE[Math.max(0, Math.min(9, i))];
}

async function queryPageRows(
  token: string,
  property: string,
  range: Range,
  type: SearchType,
  maxRows = 50000,
) {
  return searchAnalyticsAll(
    token,
    property,
    {
      startDate: range.start,
      endDate: range.end,
      dimensions: ["query", "page"],
      type,
      dataState: "all",
    },
    maxRows,
  );
}

// ---------- 1. Keyword cannibalization ----------

export interface CannibalRow extends RowStat {
  query: string;
  pageCount: number;
  pages: (RowStat & { url: string })[];
}

export async function cannibalization(
  token: string,
  property: string,
  range: Range,
  type: SearchType,
  opts: { minPages?: number; brandTerms?: string[] } = {},
): Promise<CannibalRow[]> {
  const minPages = opts.minPages ?? 2;
  const brandTerms = opts.brandTerms ?? [];
  const rows = await queryPageRows(token, property, range, type);
  const byQuery = new Map<string, (RowStat & { url: string })[]>();
  for (const r of rows) {
    const [query, url] = r.keys ?? [];
    if (!query || !url || r.impressions <= 0) continue;
    if (isBranded(query, brandTerms)) continue; // skip brand terms
    const arr = byQuery.get(query) ?? [];
    arr.push({ url, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
    byQuery.set(query, arr);
  }
  const out: CannibalRow[] = [];
  for (const [query, pages] of byQuery) {
    if (pages.length < minPages) continue;
    pages.sort((a, b) => b.impressions - a.impressions);
    out.push({
      query,
      pageCount: pages.length,
      pages,
      ...foldWeighted(pages),
    });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out;
}

// ---------- 2. Low-hanging fruit ----------

export interface LowHangingRow extends RowStat {
  query: string;
  expectedCtr: number;
  ctrGap: number; // expected - actual (positive = under-clicked)
  topPage: string | null;
  pages: (RowStat & { url: string })[];
}

export async function lowHangingFruit(
  token: string,
  property: string,
  range: Range,
  type: SearchType,
  opts: { posFrom?: number; posTo?: number; minImpr?: number } = {},
): Promise<LowHangingRow[]> {
  const posFrom = opts.posFrom ?? 4;
  const posTo = opts.posTo ?? 10;
  const minImpr = opts.minImpr ?? 100;

  const rows = await queryPageRows(token, property, range, type);
  const byQuery = new Map<string, (RowStat & { url: string })[]>();
  for (const r of rows) {
    const [query, url] = r.keys ?? [];
    if (!query || !url) continue;
    const arr = byQuery.get(query) ?? [];
    arr.push({ url, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
    byQuery.set(query, arr);
  }

  const out: LowHangingRow[] = [];
  for (const [query, pages] of byQuery) {
    const agg = foldWeighted(pages);
    if (agg.impressions < minImpr) continue;
    if (agg.position < posFrom || agg.position > posTo) continue;
    const exp = expectedCtr(agg.position);
    const gap = exp - agg.ctr;
    if (gap <= 0) continue; // already clicking at/above expectation
    pages.sort((a, b) => b.impressions - a.impressions);
    out.push({
      query,
      ...agg,
      expectedCtr: exp,
      ctrGap: gap,
      topPage: pages[0]?.url ?? null,
      pages,
    });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out;
}

// ---------- 3. Underperforming pages ----------

export interface UnderperformingRow {
  url: string;
  clicks: number;
  clicksPrev: number;
  clicksYoY: number;
  deltaPrev: number; // %
  deltaYoY: number; // %
  top10Now: number;
  top10Prev: number;
  top10Delta: number;
  status: "critical" | "warning" | "ok";
}

async function pageRows(token: string, property: string, range: Range, type: SearchType) {
  return searchAnalyticsAll(
    token,
    property,
    { startDate: range.start, endDate: range.end, dimensions: ["page"], type, dataState: "all" },
    50000,
  );
}

export async function underperformingPages(
  token: string,
  property: string,
  windows: { current: Range; previous: Range; yoy: Range },
  type: SearchType,
  bands: { critical?: number; warning?: number } = {},
): Promise<UnderperformingRow[]> {
  const critical = bands.critical ?? 30;
  const warning = bands.warning ?? 15;

  const [cur, prev, yoy, curQP, prevQP] = await Promise.all([
    pageRows(token, property, windows.current, type),
    pageRows(token, property, windows.previous, type),
    pageRows(token, property, windows.yoy, type),
    queryPageRows(token, property, windows.current, type, 40000),
    queryPageRows(token, property, windows.previous, type, 40000),
  ]);

  const m = (rows: typeof cur) => {
    const map = new Map<string, number>();
    for (const r of rows) if (r.keys?.[0]) map.set(r.keys[0], r.clicks);
    return map;
  };
  const curMap = m(cur);
  const prevMap = m(prev);
  const yoyMap = m(yoy);

  const top10 = (rows: Awaited<ReturnType<typeof queryPageRows>>) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const url = r.keys?.[1];
      if (url && r.position > 0 && r.position <= 10) map.set(url, (map.get(url) ?? 0) + 1);
    }
    return map;
  };
  const t10now = top10(curQP);
  const t10prev = top10(prevQP);

  const out: UnderperformingRow[] = [];
  for (const [url, clicks] of curMap) {
    const cPrev = prevMap.get(url) ?? 0;
    const cYoY = yoyMap.get(url) ?? 0;
    if (clicks >= cPrev && clicks >= cYoY) continue; // not down on both
    const dPrev = cPrev ? ((clicks - cPrev) / cPrev) * 100 : 0;
    const dYoY = cYoY ? ((clicks - cYoY) / cYoY) * 100 : 0;
    if (dPrev >= 0 || dYoY >= 0) continue;
    const worst = Math.min(dPrev, dYoY);
    const status = -worst >= critical ? "critical" : -worst >= warning ? "warning" : "ok";
    if (status === "ok") continue;
    out.push({
      url,
      clicks,
      clicksPrev: cPrev,
      clicksYoY: cYoY,
      deltaPrev: dPrev,
      deltaYoY: dYoY,
      top10Now: t10now.get(url) ?? 0,
      top10Prev: t10prev.get(url) ?? 0,
      top10Delta: (t10now.get(url) ?? 0) - (t10prev.get(url) ?? 0),
      status,
    });
  }
  out.sort((a, b) => a.deltaYoY - b.deltaYoY);
  return out;
}

export { zero };
