// The SE Ranking report behind Rank tracking → SE Ranking, and the source of the dashboard's Rankings card
// (rankingsFor in ./rankings derives from it), so both always show the same numbers.
//
// Read-only; four API requests per refresh (search engines, positions with landing pages and SERP features,
// the history series for engine names, keyword groups), saved in the shared cache (kind "seranking:report").
//
// Definitions (also in docs/seo-console-v2/DASHBOARDS.md):
// - A tracking context is one site engine (engine + region + language [+ device]). The default is the engine
//   with the most tracked keywords; engines are never mixed.
// - Top 3 / 5 / 10 are cumulative. Position 0 or above 100 = outside the tracked depth = not ranking.
// - Average position is SE Ranking's: the mean over keywords checked at that date, outside the top 100 counted
//   as 100. A keyword with no check at that date is left out. The mean over ranked keywords only is shown too.
// - Comparison = the latest check on or before (latest check − comparison days), same engine, same keywords.


import { asList, num, seGet, str } from "./client";
import type { SeEngineInfo, SeKeywordRow, SeRawReport, SeSite } from "./metrics";

export { reportRange, viewReport, type SeEngineInfo, type SeKeywordRow, type SeKeywordView, type SeRawReport, type SeReportView } from "./metrics";

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Fetches the raw report for a site over [from, to]. Throws SeRankingError (status 401/403 = access). */
export async function fetchRawReport(site: SeSite, from: string, to: string, opts: { groups?: boolean } = {}): Promise<SeRawReport> {
  const [enginesRaw, positionsRaw, historyRaw, groupsRaw] = await Promise.all([
    seGet("project-management/sites/search-engines", { site_id: site.id }),
    seGet("project-management/sites/positions", { site_id: site.id, date_from: from, date_to: to, with_landing_pages: 1, with_serp_features: 1 }),
    // Only used for engine names: the engines endpoint returns catalogue ids.
    seGet("project-management/sites/positions/history", { site_id: site.id, type: "avg_pos", date_from: isoDay(Date.parse(`${to}T00:00:00Z`) - 3 * DAY_MS), date_to: to }).catch(() => []),
    opts.groups === false ? Promise.resolve([]) : seGet("project-management/keywords/groups", { site_id: site.id }).catch(() => []),
  ]);
  const names = asList(historyRaw);
  const engines: SeEngineInfo[] = asList(enginesRaw)
    .map((r) => {
      const id = num(r.site_engine_id) ?? 0;
      const named = names.find((s) => str(s.type) === "search_engine" && (num(s.search_engine_id) === id || num(s.site_engine_id) === id));
      return {
        id,
        name: str(named?.name) ?? `Search engine ${num(r.search_engine_id) ?? id}`,
        region: str(r.region_name),
        language: str(r.lang_code),
        device: str(r.device) ?? (r.is_mobile === true || r.is_mobile === 1 ? "mobile" : null),
        keywordCount: num(r.keyword_count) ?? 0,
      };
    })
    .filter((e) => e.id > 0)
    .sort((a, b) => b.keywordCount - a.keywordCount);
  const keywords: Record<string, SeKeywordRow[]> = {};
  for (const block of asList(positionsRaw)) {
    const engineId = num(block.site_engine_id) ?? 0;
    keywords[String(engineId)] = asList(block.keywords).map((k, i) => {
      const features = (k.features && typeof k.features === "object" && !Array.isArray(k.features) ? k.features : {}) as Record<string, unknown>;
      const landing = asList(k.landing_pages)
        .map((l) => ({ url: str(l.url), date: str(l.date) ?? "" }))
        .filter((l): l is { url: string; date: string } => Boolean(l.url))
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .at(-1)?.url;
      return {
        id: str(k.id) ?? `k${i}`,
        name: str(k.name) ?? `Keyword ${str(k.id) ?? i + 1}`,
        groupId: str(k.group_id),
        volume: num(k.volume),
        landing: landing ?? null,
        features: Object.keys(features),
        ownFeatures: Object.keys(features).filter((f) => features[f] === true),
        positions: asList(k.positions)
          .map((p) => ({ date: str(p.date) ?? "", pos: num(p.pos) ?? 0 }))
          .filter((p) => p.date)
          .sort((a, b) => (a.date < b.date ? -1 : 1)),
      };
    });
  }
  return {
    site: { id: site.id, title: site.title, url: site.url },
    from,
    to,
    engines,
    groups: asList(groupsRaw)
      .map((g) => ({ id: str(g.id) ?? "", name: str(g.name) ?? "" }))
      .filter((g) => g.id),
    keywords,
  };
}
