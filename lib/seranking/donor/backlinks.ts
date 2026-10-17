import { asList, hostOf, num, seGet, str } from "../client";
import type { SeCompetitor, SeLinkDomain, SeLinkProfile } from "./types";

/**
 * Backlink profile from SE Ranking's backlink index (Data API, the data behind SE Ranking's Backlink Checker). Unlike
 * the project endpoints these cost API credits - roughly: summary 100, each 90-day history about 100, the rest small,
 * LINK_PROFILE_CREDITS in all - so the profile is refreshed weekly (or on demand), not with every daily sync.
 */

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const NEW_LOST_LIST = 15;
const ANCHORS = 25;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
/** Data API responses wrap lists in a named key ({ summary: [...] }, { anchors: [...] }, ...). */
const listOf = (raw: unknown, key: string) => (Array.isArray(obj(raw)[key]) ? asList(obj(raw)[key]) : asList(raw));

const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "com.vn", "net.vn", "com.sg", "com.my", "co.th",
  "co.id", "co.jp", "com.cn", "com.hk", "com.tw", "com.br", "com.mx", "co.za", "com.tr", "co.kr", "com.ph", "co.in", "com.ar",
]);

/** The whole domain (all subdomains) for a site on its root domain; just that host for a site on a subdomain. */
export function linkTarget(siteUrl: string): { target: string; mode: "domain" | "host" } {
  const host = hostOf(siteUrl);
  const labels = host.split(".");
  const apex = TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return { target: host, mode: labels.length > apex ? "host" : "domain" };
}

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 240);
}

function linkDomains(raw: unknown): SeLinkDomain[] {
  return listOf(raw, "new_lost_refdomains")
    .map((d) => ({
      domain: str(d.refdomain) ?? "",
      date: str(d.new_lost_date) ?? "",
      backlinks: num(d.backlinks) ?? 0,
      dofollow: num(d.dofollow_backlinks),
      dt: num(d.domain_inlink_rank),
    }))
    .filter((d) => d.domain);
}

export async function fetchLinkProfile(siteUrl: string, competitors: SeCompetitor[], now = new Date()): Promise<SeLinkProfile> {
  const { target, mode } = linkTarget(siteUrl);
  const to = isoDay(now.getTime());
  const from30 = isoDay(now.getTime() - 29 * DAY_MS);
  const from90 = isoDay(now.getTime() - 89 * DAY_MS);
  const from180 = isoDay(now.getTime() - 182 * DAY_MS);
  const errors: Record<string, string> = {};
  const soft = (key: string, run: () => Promise<unknown>) =>
    run().catch((err) => {
      errors[key] = message(err);
      return null;
    });

  // The summary carries the headline numbers; without it there's no profile (e.g. the key has no Data API access).
  const summaryRaw = await seGet("backlinks/summary", { target, mode });
  const s = listOf(summaryRaw, "summary")[0] ?? obj(summaryRaw);
  const competitorHosts = [...new Set(competitors.map((c) => hostOf(c.url || c.name)).filter((h) => h && h !== target))].slice(0, 10);

  const [linkCounts, domainCounts, cumulative, anchors, histogram, dtHistory, ptHistory, gained, lost, compare] = await Promise.all([
    soft("new & lost backlinks", () => seGet("backlinks/history/count", { target, mode, date_from: from90, date_to: to })),
    soft("new & lost referring domains", () => seGet("backlinks/refdomains/history/count", { target, mode, date_from: from90, date_to: to })),
    soft("backlinks over time", () => seGet("backlinks/history/cumulative", { target, mode, date_from: from90, date_to: to })),
    soft("anchors", () => seGet("backlinks/anchors", { target, mode, order_by: "backlinks", limit: ANCHORS })),
    soft("Domain Trust distribution", () => seGet("backlinks/authority/domain/distribution", { target, mode, histogramMode: "domain" })),
    soft("Domain Trust history", () => seGet("backlinks/authority/domain/history", { target, date_from: from180, date_to: to, granularity: "by_week" })),
    soft("Page Trust history", () => seGet("backlinks/authority/page/history", { target: siteUrl, date_from: from180, date_to: to, granularity: "by_week" })),
    soft("new referring domains", () =>
      seGet("backlinks/refdomains/history", { target, mode, new_lost_type: "new", date_from: from30, date_to: to, order_by: "new_lost_date", limit: NEW_LOST_LIST })
    ),
    soft("lost referring domains", () =>
      seGet("backlinks/refdomains/history", { target, mode, new_lost_type: "lost", date_from: from30, date_to: to, order_by: "new_lost_date", limit: NEW_LOST_LIST })
    ),
    competitorHosts.length ? soft("competitors", () => seGet("backlinks/metrics", { target: competitorHosts, mode: "domain" })) : Promise.resolve(null),
  ]);

  // Daily rows for the last 90 days; days the API leaves out had no new or lost links.
  const days = new Map<string, SeLinkProfile["daily"][number]>();
  for (let t = Date.parse(from90); t <= Date.parse(to); t += DAY_MS) {
    const date = isoDay(t);
    days.set(date, { date, total: null, newLinks: 0, lostLinks: 0, newDomains: 0, lostDomains: 0 });
  }
  for (const r of listOf(linkCounts, "new_lost_backlinks_count")) {
    const day = days.get(str(r.date) ?? "");
    if (day) {
      day.newLinks = num(r.new) ?? 0;
      day.lostLinks = num(r.lost) ?? 0;
    }
  }
  for (const r of listOf(domainCounts, "new_lost_refdomains_count")) {
    const day = days.get(str(r.date) ?? "");
    if (day) {
      day.newDomains = num(r.new) ?? 0;
      day.lostDomains = num(r.lost) ?? 0;
    }
  }
  for (const r of listOf(cumulative, "backlinks_count")) {
    const day = days.get(str(r.date) ?? "");
    if (day) day.total = num(r.backlinks);
  }
  const daily = [...days.values()];
  const last30 = daily.filter((d) => d.date >= from30);
  const sum = (key: "newLinks" | "lostLinks" | "newDomains" | "lostDomains") => last30.reduce((n, d) => n + d[key], 0);

  const trust = new Map<string, { date: string; dt: number | null; pt: number | null }>();
  for (const r of listOf(dtHistory, "ranks")) {
    const date = str(r.date);
    if (date) trust.set(date, { date, dt: num(r.domain_inlink_rank), pt: trust.get(date)?.pt ?? null });
  }
  for (const r of listOf(ptHistory, "ranks")) {
    const date = str(r.date);
    if (date) trust.set(date, { date, dt: trust.get(date)?.dt ?? null, pt: num(r.inlink_rank) });
  }

  const dtBands = Array.from({ length: 10 }, () => 0);
  for (const r of listOf(histogram, "histogram")) {
    const dt = num(r.domain_inlink_rank);
    if (dt !== null) dtBands[Math.min(9, Math.max(0, Math.floor(dt / 10)))] += num(r.refdomains) ?? 0;
  }

  const pages = new Map<string, { url: string; backlinks: number | null; refDomains: number | null }>();
  for (const p of asList(s.top_pages_by_refdomains)) {
    const url = str(p.url);
    if (url) pages.set(url, { url, backlinks: null, refDomains: num(p.refdomains) });
  }
  for (const p of asList(s.top_pages_by_backlinks)) {
    const url = str(p.url);
    if (url) pages.set(url, { url, backlinks: num(p.backlinks), refDomains: pages.get(url)?.refDomains ?? null });
  }

  const backlinks = num(s.backlinks) ?? 0;
  const refDomains = num(s.refdomains) ?? 0;
  const dofollow = num(s.dofollow_backlinks) ?? 0;
  const domainTrust = num(s.domain_inlink_rank);
  const trustRows = [...trust.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const competitorMetrics = new Map(listOf(compare, "metrics").map((m) => [hostOf(str(m.target) ?? ""), m]));

  return {
    fetchedAt: now.toISOString(),
    target,
    mode,
    domainTrust,
    pageTrust: num(s.inlink_rank) ?? trustRows.filter((t) => t.pt !== null).at(-1)?.pt ?? null,
    backlinks,
    refDomains,
    dofollow,
    nofollow: num(s.nofollow_backlinks) ?? Math.max(0, backlinks - dofollow),
    dofollowRefDomains: num(s.dofollow_refdomains),
    ips: num(s.ips),
    subnets: num(s.subnets),
    textBacklinks: num(s.text_backlinks),
    fromHomePages: num(s.from_home_page_backlinks),
    edu: num(s.edu_backlinks),
    gov: num(s.gov_backlinks),
    anchorCount: num(s.anchors),
    pagesWithBacklinks: num(s.pages_with_backlinks),
    new30: { backlinks: sum("newLinks"), refDomains: sum("newDomains") },
    lost30: { backlinks: sum("lostLinks"), refDomains: sum("lostDomains") },
    daily,
    trust: trustRows,
    anchors: (anchors ? listOf(anchors, "anchors") : asList(s.top_anchors_by_backlinks)).map((a) => ({
      anchor: typeof a.anchor === "string" ? a.anchor : "",
      backlinks: num(a.backlinks) ?? 0,
      refDomains: num(a.refdomains) ?? 0,
      dofollow: num(a.dofollow_backlinks),
      firstSeen: str(a.first_seen),
    })),
    dtBands,
    countries: asList(s.top_countries)
      .map((c) => ({ code: (str(c.country) ?? "").toLowerCase(), count: num(c.count) ?? 0 }))
      .filter((c) => c.code),
    tlds: asList(s.top_tlds)
      .map((t) => ({ tld: (str(t.tld) ?? "").replace(/^\./, ""), count: num(t.count) ?? 0 }))
      .filter((t) => t.tld),
    topPages: [...pages.values()].sort((a, b) => (b.refDomains ?? 0) - (a.refDomains ?? 0)).slice(0, 10),
    newDomains: linkDomains(gained),
    lostDomains: linkDomains(lost),
    compare: [
      { domain: target, isOwn: true, backlinks, refDomains, dofollow, domainTrust },
      ...competitorHosts.map((host) => {
        const m = competitorMetrics.get(host);
        const c = competitors.find((x) => hostOf(x.url || x.name) === host);
        return {
          domain: host,
          isOwn: false,
          backlinks: m ? num(m.backlinks) : null,
          refDomains: m ? num(m.refdomains) : null,
          dofollow: m ? num(m.dofollow_backlinks) : null,
          domainTrust: c?.domainTrust ?? null,
        };
      }),
    ],
    errors,
  };
}
