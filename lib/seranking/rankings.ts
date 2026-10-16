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


import { asList, num, seGet, seRankingKey, str } from "./client";
import { rankingsFromView, reportRange, viewReport, type RankingsData, type SeSite } from "./metrics";
import { fetchRawReport } from "./report";

export {
  UNRANKED_AS,
  positionOnOrBefore,
  rankCounts,
  rankOf,
  rankingsFromView,
  type RankCounts,
  type RankingContext,
  type RankingsData,
  type SeSite,
} from "./metrics";

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

/**
 * Rankings for one site over the last `compareDays`: the default view of the SE Ranking report (main engine, all
 * keyword groups), so the dashboard card and Rank tracking → SE Ranking always agree.
 */
export async function rankingsFor(site: SeSite, compareDays: number, now = new Date()): Promise<RankingsData> {
  const { from, to } = reportRange(compareDays, now);
  return rankingsFromView(viewReport(await fetchRawReport(site, from, to, { groups: false }), { compareDays }));
}
