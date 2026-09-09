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

/**
 * A "page" for these reports is its origin + path — query-string and fragment
 * variants (tracking params, ?fbclid=…, AMP, etc.) are the same page. Without
 * this, GSC returns one row per parameterised URL and a single page shows up
 * dozens of times.
 */
export function pageKey(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw.split(/[?#]/)[0];
  }
}

/** Group query→page rows, collapsing parameter variants of the same page. */
function groupQueryPages(
  rows: Awaited<ReturnType<typeof queryPageRows>>,
  filter: (query: string) => boolean = () => true,
): Map<string, (RowStat & { url: string })[]> {
  const byQuery = new Map<string, Map<string, RowStat & { url: string }>>();
  for (const r of rows) {
    const [query, rawUrl] = r.keys ?? [];
    if (!query || !rawUrl || !filter(query)) continue;
    const url = pageKey(rawUrl);
    let pages = byQuery.get(query);
    if (!pages) byQuery.set(query, (pages = new Map()));
    const prev = pages.get(url);
    if (prev) {
      const merged = foldWeighted([prev, r]);
      pages.set(url, { url, ...merged });
    } else {
      pages.set(url, {
        url,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      });
    }
  }
  const out = new Map<string, (RowStat & { url: string })[]>();
  for (const [query, pages] of byQuery) {
    out.set(
      query,
      [...pages.values()].sort((a, b) => b.impressions - a.impressions),
    );
  }
  return out;
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
  const byQuery = groupQueryPages(rows, (q) => !isBranded(q, brandTerms));

  const out: CannibalRow[] = [];
  for (const [query, allPages] of byQuery) {
    const pages = allPages.filter((p) => p.impressions > 0);
    if (pages.length < minPages) continue;
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
  const byQuery = groupQueryPages(rows);

  const out: LowHangingRow[] = [];
  for (const [query, pages] of byQuery) {
    const agg = foldWeighted(pages);
    if (agg.impressions < minImpr) continue;
    if (agg.position < posFrom || agg.position > posTo) continue;
    const exp = expectedCtr(agg.position);
    const gap = exp - agg.ctr;
    if (gap <= 0) continue; // already clicking at/above expectation
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
  lostClicks: number; // biggest absolute drop vs a baseline
  lostPerMonth: number;
  siteSharePct: number; // lost clicks as a share of the site's baseline clicks (%)
  top10Now: number;
  top10Prev: number;
  top10Delta: number;
  status: "critical" | "warning" | "ok";
}

export interface UnderperformingOpts {
  months?: number;
  /** page must have earned at least this many clicks in a baseline period */
  minBaseline?: number;
  /** lost clicks worth at least this % of the site's baseline clicks qualifies */
  sharePct?: number;
  /** ...or an absolute drop of more than this many clicks per month qualifies */
  perMonth?: number;
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
  opts: UnderperformingOpts = {},
): Promise<UnderperformingRow[]> {
  const months = Math.max(1, opts.months ?? 2);
  const minBaseline = opts.minBaseline ?? 20;
  const sharePct = opts.sharePct ?? 0.5; // percent
  const perMonth = opts.perMonth ?? 100;

  const [cur, prev, yoy, curQP, prevQP] = await Promise.all([
    pageRows(token, property, windows.current, type),
    pageRows(token, property, windows.previous, type),
    pageRows(token, property, windows.yoy, type),
    queryPageRows(token, property, windows.current, type, 40000),
    queryPageRows(token, property, windows.previous, type, 40000),
  ]);

  // Aggregate clicks by normalised page (collapse parameter variants).
  const m = (rows: typeof cur) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.keys?.[0]) continue;
      const k = pageKey(r.keys[0]);
      map.set(k, (map.get(k) ?? 0) + r.clicks);
    }
    return map;
  };
  const curMap = m(cur);
  const prevMap = m(prev);
  const yoyMap = m(yoy);
  const sitePrev = [...prevMap.values()].reduce((a, b) => a + b, 0);
  const siteYoy = [...yoyMap.values()].reduce((a, b) => a + b, 0);

  // Count distinct top-10 queries per normalised page.
  const top10 = (rows: Awaited<ReturnType<typeof queryPageRows>>) => {
    const seen = new Map<string, Set<string>>();
    for (const r of rows) {
      const [query, rawUrl] = r.keys ?? [];
      if (!query || !rawUrl || !(r.position > 0 && r.position <= 10)) continue;
      const k = pageKey(rawUrl);
      let s = seen.get(k);
      if (!s) seen.set(k, (s = new Set()));
      s.add(query);
    }
    const map = new Map<string, number>();
    for (const [k, s] of seen) map.set(k, s.size);
    return map;
  };
  const t10now = top10(curQP);
  const t10prev = top10(prevQP);

  // Consider every page that had a baseline, not just ones with current clicks.
  const urls = new Set<string>([...curMap.keys(), ...prevMap.keys(), ...yoyMap.keys()]);

  const out: UnderperformingRow[] = [];
  for (const url of urls) {
    const clicks = curMap.get(url) ?? 0;
    const cPrev = prevMap.get(url) ?? 0;
    const cYoY = yoyMap.get(url) ?? 0;

    // Must have actually performed before.
    if (Math.max(cPrev, cYoY) < minBaseline) continue;

    const lostPrev = Math.max(0, cPrev - clicks);
    const lostYoY = Math.max(0, cYoY - clicks);
    if (lostPrev <= 0 && lostYoY <= 0) continue; // not down on either

    const sharePrev = sitePrev ? (lostPrev / sitePrev) * 100 : 0;
    const shareYoY = siteYoy ? (lostYoY / siteYoy) * 100 : 0;

    // Material either as a share of total site clicks, or in absolute terms.
    const materialShare = Math.max(sharePrev, shareYoY) >= sharePct;
    const materialAbs = Math.max(lostPrev, lostYoY) / months > perMonth;
    if (!materialShare && !materialAbs) continue;

    const lostClicks = Math.max(lostPrev, lostYoY);
    const lostPerMonth = lostClicks / months;
    const siteShare = Math.max(sharePrev, shareYoY);

    // Critical when it's a big absolute bleed or a large slice of the site.
    const status: UnderperformingRow["status"] =
      lostPerMonth >= perMonth * 2 || siteShare >= sharePct * 3 ? "critical" : "warning";

    out.push({
      url,
      clicks,
      clicksPrev: cPrev,
      clicksYoY: cYoY,
      deltaPrev: cPrev ? ((clicks - cPrev) / cPrev) * 100 : 0,
      deltaYoY: cYoY ? ((clicks - cYoY) / cYoY) * 100 : 0,
      lostClicks,
      lostPerMonth,
      siteSharePct: siteShare,
      top10Now: t10now.get(url) ?? 0,
      top10Prev: t10prev.get(url) ?? 0,
      top10Delta: (t10now.get(url) ?? 0) - (t10prev.get(url) ?? 0),
      status,
    });
  }
  out.sort((a, b) => b.lostClicks - a.lostClicks);
  return out;
}

export { zero };
