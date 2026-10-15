// Local, temporary: validates the SE Ranking adapter against SE Ranking's own summary. Not committed.
import { readFileSync } from "node:fs";
process.env.SERANKING_API_KEY = readFileSync(process.argv[2], "utf8").trim();
const { listSites, matchSite, rankingsFor, rankCounts, positionOnOrBefore } = await import("../lib/seranking/rankings.ts");
const { seGet, asList, num } = await import("../lib/seranking/client.ts");

const sites = await listSites(true);
console.log(`SE Ranking projects: ${sites.length}`);
for (const s of sites) console.log(`  ${s.id}  ${s.title}  ${s.url}  (${s.keywordCount} keywords)`);
const wewine = matchSite(sites, "https://wewine.vn");
console.log("Matched for wewine.vn:", wewine ? `${wewine.id} ${wewine.title}` : "none");
if (wewine) {
  const r = await rankingsFor(wewine, 28);
  console.log("Context:", JSON.stringify(r.context));
  console.log("Ours current:", JSON.stringify(r.current), "previous:", JSON.stringify(r.previous));
  const summary = (await seGet("project-management/sites/summary", { site_id: wewine.id })) as Record<string, unknown>;
  const pick = Object.fromEntries(["today_avg", "yesterday_avg", "top5", "top10", "top30", "total_up", "total_down", "visibility_percent"].map((k) => [k, summary[k]]));
  console.log("SE Ranking summary:", JSON.stringify(pick));
  // Same-day recount per engine, to see which engine/aggregation the summary uses.
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const pos = asList(await seGet("project-management/sites/positions", { site_id: wewine.id, date_from: from, date_to: to }));
  for (const e of pos) {
    const kws = asList(e.keywords).map((k) => asList(k.positions).map((p) => ({ date: String(p.date), pos: num(p.pos) ?? 0 })));
    const latest = kws.flatMap((k) => k.map((p) => p.date)).sort().at(-1) ?? "";
    console.log(`Engine ${num(e.site_engine_id)}: ${kws.length} keywords, latest ${latest}:`, JSON.stringify(rankCounts(kws.map((k) => positionOnOrBefore(k, latest)))));
  }
}
