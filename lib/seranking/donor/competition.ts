import { belongsTo, hostOf, rankDays, rankOf } from "./rank";
import type { SeCompetition, SeCompetitor, SeEngine, SeKeyword, SeRival, SeRivalDomain, SeSerpResult } from "./types";

/** Keywords whose top 10 is read on each sync (one request each), by search volume. */
export const MAX_SERP_KEYWORDS = 100;
/** Domains kept in the competition table, besides the site and its tracked competitors. */
const MAX_DOMAINS = 50;
/** Leading domains kept in the visibility trend besides the site and its tracked competitors. */
const TREND_LEADERS = 6;

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** One day of SE Ranking's "all competitors" list: every domain in the top 10 with its visibility %. */
export interface VisibilityDay {
  date: string;
  rows: Array<{ domain: string; visibility: number; backlinks: number | null; refDomains: number | null }>;
}

/** Merges the daily visibility lists and the per-keyword top 10s into one competition picture. */
export function buildCompetition(input: {
  engine: SeEngine;
  days: VisibilityDay[];
  serps: Record<string, SeSerpResult[]>;
  keywords: SeKeyword[];
  siteHost: string;
  competitors: SeCompetitor[];
}): SeCompetition {
  const { engine, serps, keywords, siteHost, competitors } = input;
  const tracked = competitors.map((c) => ({ id: c.id, host: hostOf(c.url || c.name) })).filter((c) => c.host);
  const competitorOf = (domain: string) => tracked.find((c) => belongsTo(domain, c.host))?.id ?? null;

  // www.x.com and x.com are listed separately; they're one site here.
  const visibilityByDay = input.days
    .filter((d) => d.rows.length > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => {
      const values = new Map<string, number>();
      const links = new Map<string, { backlinks: number | null; refDomains: number | null }>();
      for (const r of d.rows) {
        const domain = hostOf(r.domain);
        if (!domain) continue;
        values.set(domain, Math.round(((values.get(domain) ?? 0) + r.visibility) * 100) / 100);
        if (!links.has(domain) || (r.backlinks ?? 0) > (links.get(domain)?.backlinks ?? 0)) links.set(domain, { backlinks: r.backlinks, refDomains: r.refDomains });
      }
      return { date: d.date, values, links };
    });
  const latest = visibilityByDay.at(-1);
  const weekBefore = latest ? isoDay(Date.parse(latest.date) - 7 * DAY_MS) : "";
  const prev = visibilityByDay.filter((d) => d !== latest && d.date <= weekBefore).at(-1) ?? (visibilityByDay.length > 1 ? visibilityByDay[0] : undefined);

  // Each keyword counts once per domain, at the domain's best position.
  const volumes = new Map(keywords.map((k) => [k.id, k.volume ?? 0]));
  const agg = new Map<string, { top3: number; top10: number; sum: number; volume: number }>();
  for (const [keywordId, results] of Object.entries(serps)) {
    const best = new Map<string, number>();
    for (const r of [...results].sort((a, b) => a.pos - b.pos)) if (r.pos <= 10 && !best.has(r.domain)) best.set(r.domain, r.pos);
    for (const [domain, pos] of best) {
      const a = agg.get(domain) ?? { top3: 0, top10: 0, sum: 0, volume: 0 };
      a.top10++;
      if (pos <= 3) a.top3++;
      a.sum += pos;
      a.volume += volumes.get(keywordId) ?? 0;
      agg.set(domain, a);
    }
  }

  const names = new Set<string>([...(latest?.values.keys() ?? []), ...agg.keys()]);
  const row = (domain: string): SeRivalDomain => {
    const a = agg.get(domain);
    const link = latest?.links.get(domain);
    return {
      domain,
      isOwn: belongsTo(domain, siteHost),
      competitorId: competitorOf(domain),
      visibility: latest?.values.get(domain) ?? 0,
      visibilityPrev: prev ? (prev.values.get(domain) ?? 0) : null,
      top3: a?.top3 ?? 0,
      top10: a?.top10 ?? 0,
      avgPos: a && a.top10 ? Math.round((a.sum / a.top10) * 10) / 10 : null,
      volume: a?.volume ?? 0,
      backlinks: link?.backlinks ?? null,
      refDomains: link?.refDomains ?? null,
    };
  };
  const all = [...names].map(row).sort((a, b) => b.visibility - a.visibility || b.top10 - a.top10 || a.domain.localeCompare(b.domain));
  // The site and every tracked competitor always appear, even when they're nowhere in the top 10.
  if (!all.some((d) => d.isOwn)) all.push(row(siteHost));
  for (const c of tracked) if (!all.some((d) => d.competitorId === c.id)) all.push(row(c.host));
  const domains = all.filter((d, i) => i < MAX_DOMAINS || d.isOwn || d.competitorId !== null);

  const leaders = domains.filter((d) => !d.isOwn && d.competitorId === null).slice(0, TREND_LEADERS);
  const trendDomains = [...domains.filter((d) => d.isOwn || d.competitorId !== null), ...leaders].map((d) => d.domain);
  return {
    engineId: engine.id,
    engineName: engine.name,
    date: latest?.date ?? "",
    prevDate: prev?.date ?? null,
    keywordCount: Object.keys(serps).length,
    domains,
    visibilityTrend: visibilityByDay.map((d) => ({ date: d.date, values: Object.fromEntries(trendDomains.map((domain) => [domain, d.values.get(domain) ?? 0])) })),
    serps,
  };
}

/** A tracked competitor's positions (per search engine, per keyword, daily) condensed for the dashboard. */
export function buildRival(
  competitor: SeCompetitor,
  engines: Array<{ engineId: number; keywords: Array<{ id: string; positions: Array<{ date: string; pos: number }> }> }>
): SeRival {
  const latest: Record<string, number> = {};
  const prev7: Record<string, number> = {};
  const trend: SeRival["trend"] = {};
  for (const e of engines) {
    const series: Array<Array<{ date: string; pos: number }>> = [];
    for (const k of e.keywords) {
      const positions = [...k.positions].sort((a, b) => (a.date < b.date ? -1 : 1));
      const last = positions.at(-1);
      if (!last) continue;
      series.push(positions);
      const key = `${e.engineId}:${k.id}`;
      latest[key] = rankOf(last.pos) ?? 0;
      const weekBefore = isoDay(Date.parse(last.date) - 7 * DAY_MS);
      const before = positions.filter((p) => p.date <= weekBefore).at(-1);
      if (before) prev7[key] = rankOf(before.pos) ?? 0;
    }
    trend[String(e.engineId)] = rankDays(series);
  }
  return { id: competitor.id, name: competitor.name, domain: hostOf(competitor.url || competitor.name), domainTrust: competitor.domainTrust, latest, prev7, trend };
}
