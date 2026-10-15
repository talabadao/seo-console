// Keyword ranking summary for a project from its SE Ranking project ("site").
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

import { SeRankingError, asList, num, seGet, seRankingKey, str } from "./client";

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

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

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

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

let sitesCache: { at: number; sites: SeSite[] } | null = null;

/** The account's SE Ranking projects (cached for an hour per server instance). */
export async function listSites(force = false): Promise<SeSite[]> {
  if (!force && sitesCache && Date.now() - sitesCache.at < 3_600_000) return sitesCache.sites;
  const sites = asList(await seGet("project-management/sites"))
    .map((r) => ({
      id: num(r.id) ?? 0,
      title: str(r.title) ?? str(r.name) ?? "",
      url: str(r.name) ?? str(r.url) ?? "",
      keywordCount: num(r.keyword_count) ?? 0,
    }))
    .filter((s) => s.id > 0)
    .sort((a, b) => a.title.localeCompare(b.title));
  sitesCache = { at: Date.now(), sites };
  return sites;
}

/** The SE Ranking project tracking a website: same host first, then a parent/sub-domain; most keywords wins. */
export function matchSite(sites: SeSite[], website: string): SeSite | null {
  const host = website.trim() ? hostOf(website) : "";
  if (!host) return null;
  const byKeywords = (a: SeSite, b: SeSite) => b.keywordCount - a.keywordCount;
  const exact = sites.filter((s) => hostOf(s.url) === host).sort(byKeywords);
  if (exact.length) return exact[0];
  return sites.filter((s) => hostOf(s.url).endsWith(`.${host}`) || host.endsWith(`.${hostOf(s.url)}`)).sort(byKeywords)[0] ?? null;
}

export function seRankingConfigured(): boolean {
  return Boolean(seRankingKey());
}

/** Rankings for one site over the last `compareDays` (plus a margin to find the comparison check). */
export async function rankingsFor(site: SeSite, compareDays: number, now = new Date()): Promise<RankingsData> {
  const to = isoDay(now.getTime());
  const from = isoDay(now.getTime() - (compareDays + 7) * DAY_MS);
  const [enginesRaw, positionsRaw, historyRaw] = await Promise.all([
    seGet("project-management/sites/search-engines", { site_id: site.id }),
    seGet("project-management/sites/positions", { site_id: site.id, date_from: from, date_to: to }),
    // Only used for engine names: the engines endpoint returns catalogue IDs.
    seGet("project-management/sites/positions/history", { site_id: site.id, type: "avg_pos", date_from: isoDay(now.getTime() - 3 * DAY_MS), date_to: to }).catch(() => []),
  ]);
  const engines = asList(enginesRaw)
    .map((r) => ({
      id: num(r.site_engine_id) ?? 0,
      searchEngineId: num(r.search_engine_id) ?? 0,
      region: str(r.region_name),
      language: str(r.lang_code),
      device: str(r.device) ?? (r.is_mobile === true || r.is_mobile === 1 ? "mobile" : null),
      keywordCount: num(r.keyword_count) ?? 0,
    }))
    .filter((e) => e.id > 0)
    .sort((a, b) => b.keywordCount - a.keywordCount);
  const main = engines[0];
  if (!main) throw new SeRankingError(404, "This SE Ranking project has no search engines configured.");
  const names = asList(historyRaw);
  const engineName =
    // The history series carries the site-engine id in its "search_engine_id" field.
    str(names.find((s) => str(s.type) === "search_engine" && (num(s.search_engine_id) === main.id || num(s.site_engine_id) === main.id))?.name) ??
    `Search engine ${main.searchEngineId}`;

  const block = asList(positionsRaw).find((e) => num(e.site_engine_id) === main.id);
  const keywords = asList(block?.keywords).map((k) =>
    asList(k.positions)
      .map((p) => ({ date: str(p.date) ?? "", pos: num(p.pos) ?? 0 }))
      .filter((p) => p.date),
  );
  const latestDate = keywords.flatMap((k) => k.map((p) => p.date)).sort().at(-1);
  if (!latestDate) throw new SeRankingError(404, "SE Ranking has no checks for this project in the selected period.");
  const comparisonTarget = isoDay(Date.parse(`${latestDate}T00:00:00Z`) - compareDays * DAY_MS);
  const comparisonDate = keywords.flatMap((k) => k.map((p) => p.date)).filter((d) => d <= comparisonTarget).sort().at(-1) ?? null;

  return {
    context: {
      siteId: site.id,
      siteTitle: site.title,
      siteUrl: site.url,
      engine: engineName,
      region: main.region,
      language: main.language,
      device: main.device,
      keywordGroup: "All tracked keywords",
      trackedKeywords: keywords.length,
      otherEngines: engines.length - 1,
      latestDate,
      comparisonDate,
    },
    current: rankCounts(keywords.map((k) => positionOnOrBefore(k, latestDate))),
    previous: comparisonDate ? rankCounts(keywords.map((k) => positionOnOrBefore(k, comparisonDate))) : null,
  };
}
