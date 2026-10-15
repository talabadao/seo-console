// Local, temporary. Not committed.
import { readFileSync } from "node:fs";
process.env.SERANKING_API_KEY = readFileSync(process.argv[2], "utf8").trim();
const { seGet, asList, num } = await import("../lib/seranking/client.ts");
const site = 11734349;
const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
const pos = asList(await seGet("project-management/sites/positions", { site_id: site, date_from: from, date_to: to }));
const latest = (k: { date: string; pos: number }[]) => k.filter((p) => p.date === to).at(-1) ?? k.at(-1);
for (const e of pos) {
  const kws = asList(e.keywords).map((k) => asList(k.positions).map((p) => ({ date: String(p.date), pos: num(p.pos) ?? 0 })));
  const cur = kws.map((k) => latest(k)?.pos ?? null);
  const withN = (n: number) => cur.filter((p) => p != null).reduce((a, p) => a + (p! > 0 && p! <= 100 ? p! : n), 0) / cur.filter((p) => p != null).length;
  console.log("avg if unranked=100:", withN(100).toFixed(2), " =101:", withN(101).toFixed(2), " missing checks:", cur.filter((p) => p == null).length);
  console.log("engine block keys:", Object.keys(e).join(","));
}
const engines = asList(await seGet("project-management/sites/search-engines", { site_id: site }));
console.log("engine fields:", JSON.stringify(engines[0]));
const hist = asList(await seGet("project-management/sites/positions/history", { site_id: site, type: "avg_pos", date_from: from, date_to: to }));
console.log("history fields:", JSON.stringify(hist.map((h) => ({ ...h, data: undefined }))));
