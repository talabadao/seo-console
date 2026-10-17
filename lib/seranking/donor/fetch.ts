// SE Ranking Project API reads ported from the AI Brand Mention app (src/lib/seranking/sync.ts @07e7616): summary,
// engines, ranking history, keywords, competitors, competition (top-10 domains), tracked competitors' positions,
// the latest existing site audit and Backlink Monitor stats. Requests go through the host client (lib/seranking/
// client.ts → the shared 5 req/s window and Retry-After cool-downs). Not ported: the AI Results Tracker, SE
// Visible, generated mock data and the one-shot snapshot sync — each part is its own cached kind (lib/sync/kinds.ts).
// Nothing here starts an audit crawl or uses Data API credits.

import { asList, hostOf, num, seGet, str } from "../client";
import { MAX_SERP_KEYWORDS, buildCompetition, buildRival, type VisibilityDay } from "./competition";
import type { HistoryMetric, SeAudit, SeAuditIssue, SeBacklinks, SeCompetition, SeCompetitor, SeEngine, SeKeyword, SeRival, SeSerpResult, SeSeries, SeSnapshot, SeSummary } from "./types";

type SnapshotErrors = SeSnapshot["errors"];

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const MAX_LLM_ENGINES = 10;
const MAX_RIVALS = 10;
/** SE Ranking keeps the daily list of top-10 domains for 14 days. */
const VISIBILITY_DAYS = 14;

// --- Rank tracking -------------------------------------------------------------------------------------------

export async function fetchSummary(siteId: number): Promise<SeSummary> {
  const r = obj(await seGet("project-management/sites/summary", { site_id: siteId }));
  return {
    todayAvg: num(r.today_avg),
    yesterdayAvg: num(r.yesterday_avg),
    up: num(r.total_up) ?? 0,
    down: num(r.total_down) ?? 0,
    top5: num(r.top5) ?? 0,
    top10: num(r.top10) ?? 0,
    top30: num(r.top30) ?? 0,
    visibility: num(r.visibility),
    visibilityPercent: num(r.visibility_percent),
    domainTrust: num(r.domain_trust) ?? num(r.da),
    indexGoogle: num(r.index_google),
  };
}

export async function fetchEngines(siteId: number): Promise<SeEngine[]> {
  return asList(await seGet("project-management/sites/search-engines", { site_id: siteId }))
    .map((r) => ({
      id: num(r.site_engine_id) ?? 0,
      searchEngineId: num(r.search_engine_id) ?? 0,
      name: "",
      region: str(r.region_name),
      lang: str(r.lang_code),
      keywordCount: num(r.keyword_count) ?? 0,
    }))
    .filter((e) => e.id > 0);
}

export async function fetchHistory(siteId: number, metric: HistoryMetric, from: string, to: string): Promise<SeSeries[]> {
  const rows = asList(await seGet("project-management/sites/positions/history", { site_id: siteId, type: metric, date_from: from, date_to: to }));
  return rows.map((r) => ({
    engineId: str(r.type) === "avg" ? null : num(r.search_engine_id),
    name: str(r.name) ?? "Search engine",
    points: asList(r.data).map((p) => ({ date: str(p.date) ?? "", value: num(p.value) })).filter((p) => p.date),
  }));
}

/** Position at the latest check on or before a date (null when not ranking or no check that early). */
function positionAt(positions: Array<{ date: string; pos: number }>, date: string): number | null | undefined {
  let found: { date: string; pos: number } | undefined;
  for (const p of positions) if (p.date <= date) found = p;
  if (!found) return undefined;
  return found.pos > 0 ? found.pos : null;
}

function change(prev: number | null | undefined, current: number | null): number | null {
  if (prev === undefined || prev === null || current === null) return null;
  return prev - current;
}

export async function fetchKeywords(siteId: number, from: string, to: string): Promise<SeKeyword[]> {
  const [stats, list] = await Promise.all([
    seGet("project-management/sites/positions", { site_id: siteId, date_from: from, date_to: to, with_landing_pages: 1, with_serp_features: 1 }),
    seGet("project-management/keywords", { site_id: siteId }).catch(() => []),
  ]);
  const meta = new Map(asList(list).map((k) => [String(k.id), k]));
  const out: SeKeyword[] = [];
  for (const engine of asList(stats)) {
    const engineId = num(engine.site_engine_id) ?? 0;
    for (const k of asList(engine.keywords)) {
      const id = String(k.id ?? "");
      if (!id) continue;
      const info = meta.get(id) ?? {};
      const positions = asList(k.positions)
        .map((p) => ({ date: str(p.date) ?? "", pos: num(p.pos) ?? 0 }))
        .filter((p) => p.date)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const latest = positions.at(-1);
      const current = latest && latest.pos > 0 ? latest.pos : null;
      const latestDate = latest?.date ?? to;
      const prev = positions.length > 1 ? (positions[positions.length - 2].pos > 0 ? positions[positions.length - 2].pos : null) : undefined;
      const ranked = positions.filter((p) => p.pos > 0).map((p) => p.pos);
      const features = obj(k.features);
      const landing = asList(k.landing_pages)
        .map((l) => ({ url: str(l.url), date: str(l.date) ?? "" }))
        .filter((l): l is { url: string; date: string } => Boolean(l.url))
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .at(-1)?.url;
      out.push({
        id,
        engineId,
        name: str(k.name) ?? str(info.name) ?? `Keyword ${id}`,
        groupId: str(k.group_id) ?? str(info.group_id),
        volume: num(k.volume),
        cpc: num(k.cpc) ?? num(k.suggested_bid),
        competition: num(k.competition),
        landing: landing ?? str(info.link),
        features: Object.keys(features),
        ownFeatures: Object.keys(features).filter((f) => features[f] === true),
        positions,
        current,
        change1: change(prev, current),
        change7: change(positionAt(positions, isoDay(Date.parse(latestDate) - 7 * DAY_MS)), current),
        change30: change(positions.length ? (positions[0].pos > 0 ? positions[0].pos : null) : undefined, current),
        best: ranked.length ? Math.min(...ranked) : null,
      });
    }
  }
  return out;
}

export async function fetchCompetitors(siteId: number): Promise<SeCompetitor[]> {
  return asList(await seGet("project-management/competitors", { site_id: siteId }))
    .map((c) => ({ id: num(c.id) ?? 0, name: str(c.name) ?? str(c.url) ?? "", url: str(c.url) ?? "", domainTrust: num(c.domain_trust) }))
    .filter((c) => c.name);
}

/** Every domain in the top 10 of the project's keywords on the main engine: 14 days of visibility, plus each keyword's top 10. */
export async function fetchCompetition(
  siteId: number,
  engine: SeEngine,
  date: string,
  keywords: SeKeyword[],
  siteHost: string,
  competitors: SeCompetitor[],
  opts: { limit?: number; batch?: number; previous?: SeCompetition | null } = {},
): Promise<SeCompetition> {
  const limit = opts.limit ?? MAX_SERP_KEYWORDS;
  const batch = opts.batch ?? limit;
  // Continue an earlier batch of the same check date; a new check date starts over.
  const prev = opts.previous && opts.previous.date === date && opts.previous.engineId === engine.id ? opts.previous : null;
  const visibilityDay = async (day: string): Promise<VisibilityDay> => ({
    date: day,
    rows: asList(await seGet("project-management/competitors/metrics", { site_id: siteId, site_engine_id: engine.id, date: day })).map((d) => ({
      domain: str(d.domain) ?? "",
      visibility: num(d.visibility) ?? 0,
      backlinks: num(d.backlinks),
      refDomains: num(d.domains),
    })),
  });
  const earlier = Array.from({ length: VISIBILITY_DAYS - 1 }, (_, i) => isoDay(Date.parse(date) - (VISIBILITY_DAYS - 1 - i) * DAY_MS));
  const mine = keywords.filter((k) => k.engineId === engine.id).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || a.name.localeCompare(b.name));
  const attempted = new Set(prev?.coverage?.attemptedIds ?? Object.keys(prev?.serps ?? {}));
  // Highest search volume first, never re-reading a keyword already attempted for this check date.
  const top = mine.slice(0, limit).filter((k) => !attempted.has(k.id)).slice(0, batch);
  let failed = 0;
  let lastError: unknown = null;
  const serps: Record<string, SeSerpResult[]> = { ...(prev?.serps ?? {}) };
  const readSerp = async (k: SeKeyword) => {
    try {
      const rows = asList(await seGet("project-management/competitors/serp10", { site_id: siteId, site_engine_id: engine.id, keyword_id: k.id, date }));
      serps[k.id] = rows
        .map((r) => ({ pos: num(r.position) ?? 0, url: str(r.url) ?? "", domain: hostOf(str(r.url) ?? "") }))
        .filter((r) => r.pos > 0 && r.domain)
        .sort((a, b) => a.pos - b.pos);
    } catch (err) {
      failed++;
      lastError = err;
    }
  };
  const [days] = await Promise.all([
    // The latest day must load; an older day SE Ranking no longer has just leaves a gap in the trend.
    Promise.all([visibilityDay(date), ...earlier.map((d) => visibilityDay(d).catch(() => ({ date: d, rows: [] })))]),
    Promise.all(top.map(readSerp)),
  ]);
  if (top.length > 0 && failed === top.length && !Object.keys(serps).length) throw lastError;
  for (const k of top) attempted.add(k.id);
  const target = Math.min(limit, mine.length);
  const competition = buildCompetition({ engine, days, serps, keywords: mine.filter((k) => serps[k.id]), siteHost, competitors });
  return {
    ...competition,
    coverage: {
      read: Object.keys(serps).length,
      attempted: attempted.size,
      target,
      total: mine.length,
      limit,
      complete: mine.slice(0, limit).every((k) => attempted.has(k.id)),
      attemptedIds: [...attempted],
    },
  };
}

/** Tracked competitors' positions for the project's keywords, on every engine, over 30 days. */
export async function fetchRivals(competitors: SeCompetitor[], from: string, to: string, errors: SnapshotErrors): Promise<SeRival[]> {
  const rivals = await Promise.all(
    competitors.slice(0, MAX_RIVALS).map(async (c) => {
      try {
        const engines = asList(await seGet("project-management/competitors/positions", { competitor_id: c.id, date_from: from, date_to: to }));
        return buildRival(
          c,
          engines.map((e) => ({
            engineId: num(e.site_engine_id) ?? 0,
            keywords: asList(e.keywords)
              .map((k) => ({
                id: str(k.id) ?? "",
                positions: asList(k.positions)
                  .map((p) => ({ date: str(p.date) ?? "", pos: num(p.pos) ?? 0 }))
                  .filter((p) => p.date),
              }))
              .filter((k) => k.id),
          }))
        );
      } catch (err) {
        errors.rivals = `${c.name}: ${message(err)}`;
        return null;
      }
    })
  );
  return rivals.filter((r): r is SeRival => r !== null);
}

// --- Site audit, backlinks --------------------------------------------------------------------------------------

export async function fetchAudit(siteId: number, siteHost: string): Promise<SeAudit | null> {
  // { items, total } per the docs; asList also accepts a bare array.
  const items = asList(await seGet("project-management/audits", { search: siteHost, limit: 50 }));
  const mine = items
    .filter((a) => num(a.site_id) === siteId || hostOf(str(a.url) ?? "") === siteHost)
    .sort((a, b) => ((str(a.last_update) ?? "") < (str(b.last_update) ?? "") ? 1 : -1));
  const latest = mine.find((a) => num(a.site_id) === siteId) ?? mine[0];
  if (!latest) return null;
  const id = num(latest.id) ?? 0;
  const stats = obj(latest.stats);
  const prev = obj(latest.prev_stats);
  const base: SeAudit = {
    id,
    url: str(latest.url) ?? "",
    title: str(latest.title) ?? siteHost,
    status: str(latest.status) ?? "unknown",
    lastUpdate: str(latest.last_update),
    auditTime: null,
    score: num(stats.score),
    prevScore: num(prev.score),
    pages: num(stats.crawled) ?? 0,
    errors: num(stats.errors) ?? 0,
    warnings: num(stats.warnings) ?? 0,
    notices: num(stats.notices) ?? 0,
    passed: 0,
    domain: { dt: null, backlinks: null, refDomains: null, indexGoogle: null },
    issues: [],
    sections: [],
    vitals: null,
  };
  if (base.status !== "finished") return base;
  const report = obj(await seGet("project-management/audits/report", { audit_id: id }));
  const props = obj(report.domain_props);
  const issues: SeAuditIssue[] = [];
  const sections: SeAudit["sections"] = [];
  for (const section of asList(report.sections)) {
    const name = str(section.name) ?? "Other";
    const counts = { name, errors: 0, warnings: 0, notices: 0 };
    for (const check of Object.values(obj(section.props))) {
      const c = obj(check);
      const status = str(c.status);
      const pages = num(c.value) ?? 0;
      if (pages <= 0 || (status !== "error" && status !== "warning" && status !== "notice")) continue;
      issues.push({ section: name, code: str(c.code) ?? "", name: str(c.name) ?? "", status, pages });
      if (status === "error") counts.errors++;
      else if (status === "warning") counts.warnings++;
      else counts.notices++;
    }
    sections.push(counts);
  }
  const rank = { error: 0, warning: 1, notice: 2 } as const;
  issues.sort((a, b) => rank[a.status] - rank[b.status] || b.pages - a.pages);
  const ux = obj(report.chromeux);
  return {
    ...base,
    auditTime: str(report.audit_time),
    score: num(report.score_percent) ?? base.score,
    pages: num(report.total_pages) ?? base.pages,
    errors: num(report.total_errors) ?? base.errors,
    warnings: num(report.total_warnings) ?? base.warnings,
    notices: num(report.total_notices) ?? base.notices,
    passed: num(report.total_passed) ?? 0,
    domain: { dt: num(props.dt), backlinks: num(props.backlinks), refDomains: num(props.domains), indexGoogle: num(props.index_google) },
    issues,
    sections: sections.filter((s) => s.errors + s.warnings + s.notices > 0),
    vitals: Object.keys(ux).length ? { mobile: num(obj(ux.mobile).result), desktop: num(obj(ux.desktop).result) } : null,
  };
}

export async function fetchBacklinks(siteId: number): Promise<SeBacklinks> {
  const r = obj(await seGet("project-management/backlinks/stats", { site_id: siteId }));
  return {
    total: num(r.total) ?? 0,
    domains: num(r.domains) ?? 0,
    dofollow: num(r.dofollow) ?? 0,
    nofollow: num(r.nofollow) ?? 0,
    anchors: num(r.anchors) ?? 0,
    ip: num(r.ip) ?? 0,
  };
}


export function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 240);
}
