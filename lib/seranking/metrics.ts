// SE Ranking definitions and report views, with no network or database access, so client components and demo
// data can use them. Fetching lives in ./client, ./rankings and ./report.
//
// Definitions (documented in docs/seo-console-v2/DASHBOARDS.md):
// - One tracking context: the site's search engine (engine + region + language) with the most tracked keywords,
//   all keyword groups. Other engines are counted but not mixed in.
// - Top 3 / Top 5 / Top 10 are cumulative: a keyword at position 2 counts in all three.
// - SE Ranking reports position 0 for a keyword outside the tracked depth (top 100). That is "not ranking",
//   never position 0.
// - Average position follows SE Ranking's definition: the mean over every tracked keyword checked at that
//   date, with a keyword outside the top 100 counted as 100. Checked against SE Ranking's own summary for
//   WeWine (377 keywords, 2026-10-15): 27.4 here, "27" in SE Ranking. A keyword with no check at that date is
//   left out (not counted as 100). The mean over ranked keywords only is kept as rankedAvgPosition.
// - Comparison = the latest check on or before (latest check − comparison days), same engine, same keywords.

export class SeRankingError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SeRankingError";
  }
}

export interface RankCounts {
  top3: number;
  top5: number;
  top10: number;
  /** Keywords in the top 100 at that check. */
  ranked: number;
  /** Keywords with a check at that date (the average's denominator). */
  checked: number;
  /** SE Ranking's average: keywords outside the top 100 count as 100. Null when nothing was checked. */
  avgPosition: number | null;
  /** Mean of ranked keywords only; null when none rank. */
  rankedAvgPosition: number | null;
}

export interface RankingContext {
  siteId: number;
  siteTitle: string;
  siteUrl: string;
  engine: string;
  region: string | null;
  language: string | null;
  /** Only when the API reports it. */
  device: string | null;
  keywordGroup: string;
  trackedKeywords: number;
  otherEngines: number;
  latestDate: string;
  comparisonDate: string | null;
}

export interface RankingsData {
  context: RankingContext;
  current: RankCounts;
  previous: RankCounts | null;
}

export interface SeSite {
  id: number;
  title: string;
  url: string;
  keywordCount: number;
}


/** A position as a rank (1-100), or null when not ranking (0, missing or outside the top 100). */
export function rankOf(pos: number | null | undefined): number | null {
  return pos != null && pos >= 1 && pos <= 100 ? pos : null;
}

/** SE Ranking counts a keyword outside the top 100 as position 100 in its average. */
export const UNRANKED_AS = 100;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Cumulative counts and averages. `positions` has one entry per tracked keyword: a number when the keyword
 * was checked at that date (0 or more than 100 = not ranking), undefined/null when it had no check.
 */
export function rankCounts(positions: Array<number | null | undefined>): RankCounts {
  const checked = positions.filter((p): p is number => p != null);
  const ranks = checked.map(rankOf).filter((p): p is number => p !== null);
  return {
    top3: ranks.filter((p) => p <= 3).length,
    top5: ranks.filter((p) => p <= 5).length,
    top10: ranks.filter((p) => p <= 10).length,
    ranked: ranks.length,
    checked: checked.length,
    avgPosition: checked.length ? round1(checked.reduce((a, p) => a + (rankOf(p) ?? UNRANKED_AS), 0) / checked.length) : null,
    rankedAvgPosition: ranks.length ? round1(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null,
  };
}

/** Position at the latest check on or before `date`; undefined when there's no check that early. */
export function positionOnOrBefore(checks: Array<{ date: string; pos: number }>, date: string): number | undefined {
  let found: { date: string; pos: number } | undefined;
  for (const c of checks) if (c.date <= date && (!found || c.date > found.date)) found = c;
  return found?.pos;
}


export interface SeEngineInfo {
  id: number;
  name: string;
  region: string | null;
  language: string | null;
  device: string | null;
  keywordCount: number;
}

export interface SeKeywordRow {
  id: string;
  name: string;
  groupId: string | null;
  volume: number | null;
  landing: string | null;
  features: string[];
  /** SERP features that link to the site. */
  ownFeatures: string[];
  /** Checks in the range, oldest first; pos 0 = not in the tracked depth. */
  positions: Array<{ date: string; pos: number }>;
}

/** Everything fetched for one site and date range (all engines). Cached; sliced per engine for display. */
export interface SeRawReport {
  site: { id: number; title: string; url: string };
  from: string;
  to: string;
  engines: SeEngineInfo[];
  groups: Array<{ id: string; name: string }>;
  /** Keywords per site engine id. */
  keywords: Record<string, SeKeywordRow[]>;
}

export interface SeKeywordView extends Omit<SeKeywordRow, "positions"> {
  /** Position at the latest check, null when not ranking, undefined when not checked then. */
  current: number | null | undefined;
  previous: number | null | undefined;
  /** Positions gained since the comparison check (positive = better); null when either side isn't ranking. */
  change: number | null;
  best: number | null;
  /** Last up-to-30 checks for a sparkline: rank or null. */
  trend: Array<number | null>;
}

export interface SeReportView {
  site: SeRawReport["site"];
  engines: SeEngineInfo[];
  engine: SeEngineInfo;
  groups: Array<{ id: string; name: string; keywords: number }>;
  group: string | null;
  from: string;
  to: string;
  latestDate: string;
  comparisonDate: string | null;
  compareDays: number;
  current: RankCounts;
  previous: RankCounts | null;
  /** One point per checked date in the range. */
  history: Array<{ date: string } & RankCounts>;
  keywords: SeKeywordView[];
}

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The report for one engine (default: most keywords) and optional keyword group, compared over `compareDays`. */
export function viewReport(raw: SeRawReport, opts: { engineId?: number | null; group?: string | null; compareDays: number }): SeReportView {
  if (!raw.engines.length) throw new SeRankingError(404, "This SE Ranking project has no search engines configured.");
  const engine = raw.engines.find((e) => e.id === opts.engineId) ?? raw.engines[0];
  const all = raw.keywords[String(engine.id)] ?? [];
  const group = opts.group && all.some((k) => k.groupId === opts.group) ? opts.group : null;
  const rows = group ? all.filter((k) => k.groupId === group) : all;
  const dates = [...new Set(rows.flatMap((k) => k.positions.map((p) => p.date)))].sort();
  const latestDate = dates.at(-1);
  if (!latestDate) throw new SeRankingError(404, "SE Ranking has no checks for this project in the selected period.");
  const target = isoDay(Date.parse(`${latestDate}T00:00:00Z`) - opts.compareDays * DAY_MS);
  const comparisonDate = dates.filter((d) => d <= target).at(-1) ?? null;
  const groupCounts = new Map<string, number>();
  for (const k of all) if (k.groupId) groupCounts.set(k.groupId, (groupCounts.get(k.groupId) ?? 0) + 1);
  return {
    site: raw.site,
    engines: raw.engines,
    engine,
    groups: [...groupCounts.entries()]
      .map(([id, n]) => ({ id, name: raw.groups.find((g) => g.id === id)?.name ?? `Group ${id}`, keywords: n }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    group,
    from: raw.from,
    to: raw.to,
    latestDate,
    comparisonDate,
    compareDays: opts.compareDays,
    current: rankCounts(rows.map((k) => positionOnOrBefore(k.positions, latestDate))),
    previous: comparisonDate ? rankCounts(rows.map((k) => positionOnOrBefore(k.positions, comparisonDate))) : null,
    // Each date counts only the keywords checked that day (SE Ranking's own daily average).
    history: dates.map((date) => ({ date, ...rankCounts(rows.map((k) => k.positions.find((p) => p.date === date)?.pos)) })),
    keywords: rows.map((k) => {
      const cur = positionOnOrBefore(k.positions, latestDate);
      const prev = comparisonDate ? positionOnOrBefore(k.positions, comparisonDate) : undefined;
      const current = cur === undefined ? undefined : rankOf(cur);
      const previous = prev === undefined ? undefined : rankOf(prev);
      const ranks = k.positions.map((p) => rankOf(p.pos)).filter((p): p is number => p !== null);
      return {
        id: k.id,
        name: k.name,
        groupId: k.groupId,
        volume: k.volume,
        landing: k.landing,
        features: k.features,
        ownFeatures: k.ownFeatures,
        current,
        previous,
        change: current != null && previous != null ? previous - current : null,
        best: ranks.length ? Math.min(...ranks) : null,
        trend: k.positions.slice(-30).map((p) => rankOf(p.pos)),
      };
    }),
  };
}

/** Date range for a page view: the last `days` days through `to` (UTC), plus a week so a comparison check exists. */
export function reportRange(days: number, now = new Date()): { from: string; to: string } {
  const to = isoDay(now.getTime());
  return { to, from: isoDay(now.getTime() - (days + 7) * DAY_MS) };
}

export function rankingsFromView(view: SeReportView): RankingsData {
  return {
    context: {
      siteId: view.site.id,
      siteTitle: view.site.title,
      siteUrl: view.site.url,
      engine: view.engine.name,
      region: view.engine.region,
      language: view.engine.language,
      device: view.engine.device,
      keywordGroup: view.group ? (view.groups.find((g) => g.id === view.group)?.name ?? view.group) : "All tracked keywords",
      trackedKeywords: view.keywords.length,
      otherEngines: view.engines.length - 1,
      latestDate: view.latestDate,
      comparisonDate: view.comparisonDate,
    },
    current: view.current,
    previous: view.previous,
  };
}
