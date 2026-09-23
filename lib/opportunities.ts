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

/** The property's total clicks in range — the denominator for cannibalization severity. */
async function totalClicksFor(
  token: string,
  property: string,
  range: Range,
  type: SearchType,
): Promise<number> {
  const rows = await pageRows(token, property, range, type);
  return rows.reduce((a, r) => a + r.clicks, 0);
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

// ---------- 1b. Cannibalization, grouped into topics ----------

export type CannibalSeverity = "critical" | "warning" | "low";

export interface CannibalTopicRow extends RowStat {
  /** The highest-impression keyword in the cluster — stands in for the group. */
  parentQuery: string;
  /** The shared top-ranking URL that defines this topic. */
  topUrl: string;
  keywordCount: number;
  pageCount: number;
  /** This topic's clicks as a % of the property's total clicks in range. */
  clicksSharePct: number;
  severity: CannibalSeverity;
  /** Member keywords, sorted by impressions desc — [0] is the parent. */
  keywords: CannibalRow[];
}

function severityFor(clicksSharePct: number): CannibalSeverity {
  if (clicksSharePct > 10) return "critical";
  if (clicksSharePct > 5) return "warning";
  return "low";
}

/**
 * Near-duplicate queries ("halong bay" / "ha long bay") almost always share
 * the same top-ranking page, and each shows up as its own cannibalization
 * row — noisy when a site has lots of these variants. Cluster rows whose
 * highest-impression page matches into one topic per page, and surface the
 * highest-impression keyword in each cluster as the representative.
 */
function groupCannibalByTopUrl(rows: CannibalRow[], totalClicks: number): CannibalTopicRow[] {
  const byUrl = new Map<string, CannibalRow[]>();
  for (const r of rows) {
    const topUrl = r.pages[0]?.url;
    if (!topUrl) continue; // shouldn't happen — cannibalization rows always have pages
    const arr = byUrl.get(topUrl);
    if (arr) arr.push(r);
    else byUrl.set(topUrl, [r]);
  }

  const out: CannibalTopicRow[] = [];
  for (const [topUrl, members] of byUrl) {
    members.sort((a, b) => b.impressions - a.impressions);
    const urls = new Set<string>();
    for (const m of members) for (const p of m.pages) urls.add(p.url);
    const agg = foldWeighted(members);
    const clicksSharePct = totalClicks ? (agg.clicks / totalClicks) * 100 : 0;
    out.push({
      parentQuery: members[0].query,
      topUrl,
      keywordCount: members.length,
      pageCount: urls.size,
      clicksSharePct,
      severity: severityFor(clicksSharePct),
      keywords: members,
      ...agg,
    });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out;
}

export async function cannibalizationTopics(
  token: string,
  property: string,
  range: Range,
  type: SearchType,
  opts: { minPages?: number; brandTerms?: string[] } = {},
): Promise<CannibalTopicRow[]> {
  const [rows, totalClicks] = await Promise.all([
    cannibalization(token, property, range, type, opts),
    totalClicksFor(token, property, range, type),
  ]);
  return groupCannibalByTopUrl(rows, totalClicks);
}

// ---------- 1c. Parent Keywords — every query grouped by its top page ----------

export interface KeywordTopicRow extends RowStat {
  parentQuery: string;
  url: string;
  keywordCount: number;
  /** Member keywords, sorted by impressions desc — [0] is the parent. */
  keywords: (RowStat & { query: string })[];
}

/**
 * Site-wide version of the cannibalization grouping: every (non-branded)
 * query grouped by its own top-ranking page — one topic per page that has
 * any ranking keywords, not just pages with 2+ competing queries. Useful as
 * a general "what keyword theme is each page really about" view.
 */
export async function keywordTopics(
  token: string,
  property: string,
  range: Range,
  type: SearchType,
  opts: { brandTerms?: string[] } = {},
): Promise<KeywordTopicRow[]> {
  const brandTerms = opts.brandTerms ?? [];
  const rows = await queryPageRows(token, property, range, type);
  const byQuery = groupQueryPages(rows, (q) => !isBranded(q, brandTerms));

  const byUrl = new Map<string, (RowStat & { query: string })[]>();
  for (const [query, pages] of byQuery) {
    const top = pages[0]; // groupQueryPages already sorts desc by impressions
    if (!top || top.impressions <= 0) continue;
    const entry = { query, ...foldWeighted(pages) };
    const arr = byUrl.get(top.url);
    if (arr) arr.push(entry);
    else byUrl.set(top.url, [entry]);
  }

  const out: KeywordTopicRow[] = [];
  for (const [url, keywords] of byUrl) {
    keywords.sort((a, b) => b.impressions - a.impressions);
    out.push({
      url,
      parentQuery: keywords[0].query,
      keywordCount: keywords.length,
      keywords,
      ...foldWeighted(keywords),
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

// ---------- 2b. Low-hanging fruit, grouped by Parent Keyword ----------

export interface LowHangingTopicRow extends RowStat {
  parentQuery: string;
  topUrl: string;
  keywordCount: number;
  expectedCtr: number;
  ctrGap: number;
  /** Member keywords, sorted by impressions desc — [0] is the parent. */
  keywords: LowHangingRow[];
}

function groupLowHangingByTopUrl(rows: LowHangingRow[]): LowHangingTopicRow[] {
  const byUrl = new Map<string, LowHangingRow[]>();
  for (const r of rows) {
    const topUrl = r.topPage ?? r.pages[0]?.url;
    if (!topUrl) continue;
    const arr = byUrl.get(topUrl);
    if (arr) arr.push(r);
    else byUrl.set(topUrl, [r]);
  }

  const out: LowHangingTopicRow[] = [];
  for (const [topUrl, members] of byUrl) {
    members.sort((a, b) => b.impressions - a.impressions);
    const agg = foldWeighted(members);
    const exp = expectedCtr(agg.position);
    const gap = exp - agg.ctr;
    if (gap <= 0) continue; // the group as a whole no longer under-clicks
    out.push({
      parentQuery: members[0].query,
      topUrl,
      keywordCount: members.length,
      expectedCtr: exp,
      ctrGap: gap,
      keywords: members,
      ...agg,
    });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out;
}

export async function lowHangingFruitTopics(
  token: string,
  property: string,
  range: Range,
  type: SearchType,
  opts: { posFrom?: number; posTo?: number; minImpr?: number } = {},
): Promise<LowHangingTopicRow[]> {
  return groupLowHangingByTopUrl(await lowHangingFruit(token, property, range, type, opts));
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

// ---------- 4. Branding keywords ----------

export type BrandKeywordStatus = "warning" | null;

export interface BrandKeywordRow extends RowStat {
  query: string;
  status: BrandKeywordStatus;
  pages: (RowStat & { url: string })[];
}

/** Above this average position, a brand query is flagged as a warning. */
const BRAND_POSITION_WARN = 3;
/** Below this many impressions a brand query is too thin a signal to flag either way. */
const BRAND_MIN_IMPRESSIONS = 30;

/** Own-brand queries (Settings → Query filters → Branded terms) and where they rank. */
export async function brandingKeywords(
  token: string,
  property: string,
  range: Range,
  type: SearchType,
  brandTerms: string[],
): Promise<BrandKeywordRow[]> {
  if (!brandTerms.length) return [];
  const rows = await queryPageRows(token, property, range, type);
  const byQuery = groupQueryPages(rows, (q) => isBranded(q, brandTerms));

  const out: BrandKeywordRow[] = [];
  for (const [query, pages] of byQuery) {
    const withImpr = pages.filter((p) => p.impressions > 0);
    if (!withImpr.length) continue;
    const agg = foldWeighted(withImpr);
    if (agg.impressions < BRAND_MIN_IMPRESSIONS) continue;
    out.push({
      query,
      ...agg,
      status: agg.position > BRAND_POSITION_WARN ? "warning" : null,
      pages: withImpr,
    });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out;
}

export { zero };
