import { computeAiHit, computeOrganicHit, isGoogleHost } from "./visibility";
import type {
  AiTextSnapshot,
  BrandHit,
  KeywordDailySnapshot,
  KeywordHistory,
  OrganicResultSnapshot,
  TrackedBrand,
  TrackedCompetitor,
} from "./types";

export type Surface = "organic" | "aiOverview" | "aiMode";
export type SurfaceFilter = "all" | Surface;
export type AiSurface = "aiOverview" | "aiMode";

export const SURFACES: Surface[] = ["organic", "aiOverview", "aiMode"];
export const SURFACE_LABEL: Record<Surface, string> = {
  organic: "Organic results",
  aiOverview: "AI Overview",
  aiMode: "AI Mode",
};

function surfacesIn(filter: SurfaceFilter): Surface[] {
  return filter === "all" ? SURFACES : [filter];
}

export interface Subject {
  id: string;
  name: string;
  website: string;
  isYourBrand: boolean;
  /** Stable 1-8 categorical slot tied to identity (your brand = 1, competitors by settings order), never to rank. */
  colorSlot: number;
  def: TrackedBrand;
}

export function buildSubjects(brand: TrackedBrand, competitors: TrackedCompetitor[]): Subject[] {
  return [
    { id: "you", name: brand.name || "Your brand", website: brand.website, isYourBrand: true, colorSlot: 1, def: brand },
    ...competitors
      .filter((c) => c.name.trim() || c.website.trim())
      .map((c, i): Subject => ({
        id: c.id,
        name: c.name || c.website,
        website: c.website,
        isYourBrand: false,
        colorSlot: (i % 7) + 2,
        def: { name: c.name, aliases: c.aliases, website: c.website },
      })),
  ];
}

export function seriesColor(slot: number): string {
  return `var(--series-${slot})`;
}

export function domainMatchesWebsite(domain: string, website: string): boolean {
  if (!website.trim() || !domain) return false;
  const site = website.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return domain === site || domain.endsWith(`.${site}`);
}

export interface DayHits {
  organic: BrandHit;
  aiOverview: BrandHit;
  aiMode: BrandHit;
  /**
   * Where the subject's own website ranks organically. A name mention inside someone else's result
   * (e.g. a TripAdvisor listicle) counts toward visibility but is not the brand's rank; only when no
   * website is configured does the first name-matching result stand in for position.
   */
  organicPosition: number | null;
}

export type HitLookup = (day: KeywordDailySnapshot, subjectIndex: number) => DayHits;

/**
 * Name/alias/website matching is regex-heavy, and every view asks the same (day, subject) question,
 * so results are memoized per day object. Range filtering keeps the same day objects, so the cache
 * survives filter changes and only resets when the subject list (brand/competitors) changes.
 */
export function createHitLookup(subjects: Subject[]): HitLookup {
  const cache = new WeakMap<KeywordDailySnapshot, DayHits[]>();
  return (day, si) => {
    let row = cache.get(day);
    if (!row) {
      row = [];
      cache.set(day, row);
    }
    let hits = row[si];
    if (!hits) {
      const subject = subjects[si];
      const organic = computeOrganicHit(day.organicResults, subject.def);
      const ownResults = subject.website.trim()
        ? day.organicResults.filter((r) => domainMatchesWebsite(r.domain, subject.website)).map((r) => r.position)
        : [];
      hits = {
        organic,
        aiOverview: computeAiHit(day.aiOverview, subject.def),
        aiMode: computeAiHit(day.aiMode, subject.def),
        organicPosition: subject.website.trim()
          ? ownResults.length > 0
            ? Math.min(...ownResults)
            : null
          : organic.matched
            ? organic.organicPosition
            : null,
      };
      row[si] = hits;
    }
    return hits;
  };
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function filterByRange(histories: KeywordHistory[], rangeDays: number | null): KeywordHistory[] {
  if (rangeDays == null) return histories;
  const cutoff = isoDaysAgo(rangeDays - 1);
  return histories.map((h) => ({ ...h, days: h.days.filter((d) => d.date >= cutoff) }));
}

export function collectDates(histories: KeywordHistory[]): string[] {
  const dates = new Set<string>();
  for (const h of histories) for (const d of h.days) if (!d.error) dates.add(d.date);
  return Array.from(dates).sort();
}

function nameInTitle(title: string, def: TrackedBrand): boolean {
  const t = title.toLowerCase();
  return [def.name, ...def.aliases].some((n) => n.trim().length > 2 && t.includes(n.trim().toLowerCase()));
}

/** Links to the subject's site, plus Google-hosted sources (Business Profile, Maps) titled with its name. */
function citationsIn(day: KeywordDailySnapshot, subject: Subject, surfaces: Surface[]): number {
  const owns = (domain: string, title: string) =>
    domainMatchesWebsite(domain, subject.website) || (isGoogleHost(domain) && nameInTitle(title, subject.def));
  let n = 0;
  if (surfaces.includes("organic")) n += day.organicResults.filter((r) => owns(r.domain, r.title)).length;
  if (surfaces.includes("aiOverview")) n += day.aiOverview.sources.filter((src) => owns(src.domain, src.title)).length;
  if (surfaces.includes("aiMode")) n += day.aiMode.sources.filter((src) => owns(src.domain, src.title)).length;
  return n;
}

export interface SubjectDay {
  date: string;
  keywords: number;
  matched: number;
  visibility: number | null;
  positionSum: number;
  positionSamples: number;
  avgPosition: number | null;
  mentions: number;
  citations: number;
  share: number | null;
}

export interface SubjectSeries {
  subject: Subject;
  days: SubjectDay[];
}

/** Per-subject, per-day visibility, organic position, mentions, citations and share of voice. */
export function computeSubjectSeries(
  histories: KeywordHistory[],
  subjects: Subject[],
  hits: HitLookup,
  filter: SurfaceFilter
): { dates: string[]; series: SubjectSeries[] } {
  const dates = collectDates(histories);
  const surfaces = surfacesIn(filter);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const acc = subjects.map(() =>
    dates.map(() => ({ keywords: 0, matched: 0, positionSum: 0, positionSamples: 0, mentions: 0, citations: 0 }))
  );

  for (const h of histories) {
    for (const day of h.days) {
      if (day.error) continue;
      const di = dateIndex.get(day.date);
      if (di == null) continue;
      subjects.forEach((s, si) => {
        const a = acc[si][di];
        const dh = hits(day, si);
        const matchedSurfaces = surfaces.filter((surface) => dh[surface].matched).length;
        a.keywords++;
        if (matchedSurfaces > 0) a.matched++;
        a.mentions += matchedSurfaces;
        if (dh.organicPosition != null) {
          a.positionSum += dh.organicPosition;
          a.positionSamples++;
        }
        a.citations += citationsIn(day, s, surfaces);
      });
    }
  }

  const totalMentions = dates.map((_, di) => acc.reduce((sum, rows) => sum + rows[di].mentions, 0));

  const series = subjects.map((subject, si) => ({
    subject,
    days: dates.map((date, di): SubjectDay => {
      const a = acc[si][di];
      return {
        date,
        ...a,
        visibility: a.keywords > 0 ? a.matched / a.keywords : null,
        avgPosition: a.positionSamples > 0 ? a.positionSum / a.positionSamples : null,
        share: totalMentions[di] > 0 ? a.mentions / totalMentions[di] : null,
      };
    }),
  }));

  return { dates, series };
}

export interface SubjectSummary {
  subject: Subject;
  keywordDays: number;
  visibility: number;
  avgPosition: number | null;
  mentions: number;
  citations: number;
  share: number;
}

/** Whole-period totals per subject, for the rankings table. */
export function summarizeSeries(series: SubjectSeries[]): SubjectSummary[] {
  const totalMentions = series.reduce((sum, s) => sum + s.days.reduce((n, d) => n + d.mentions, 0), 0);
  return series.map(({ subject, days }) => {
    const keywordDays = days.reduce((n, d) => n + d.keywords, 0);
    const matched = days.reduce((n, d) => n + d.matched, 0);
    const positionSum = days.reduce((n, d) => n + d.positionSum, 0);
    const positionSamples = days.reduce((n, d) => n + d.positionSamples, 0);
    const mentions = days.reduce((n, d) => n + d.mentions, 0);
    return {
      subject,
      keywordDays,
      visibility: keywordDays > 0 ? matched / keywordDays : 0,
      avgPosition: positionSamples > 0 ? positionSum / positionSamples : null,
      mentions,
      citations: days.reduce((n, d) => n + d.citations, 0),
      share: totalMentions > 0 ? mentions / totalMentions : 0,
    };
  });
}

export interface PeriodMetric {
  value: number | null;
  /** Second half of the period minus the first half (equal-length halves). */
  delta: number | null;
}

export interface PeriodMetrics {
  visibility: PeriodMetric;
  avgPosition: PeriodMetric;
  share: PeriodMetric;
  mentions: PeriodMetric;
  citations: PeriodMetric;
  halfDays: number;
}

type Aggregate = Record<Exclude<keyof PeriodMetrics, "halfDays">, number | null>;

function aggregateDays(series: SubjectSeries[], si: number, from: number, to: number): Aggregate {
  let keywords = 0;
  let matched = 0;
  let positionSum = 0;
  let positionSamples = 0;
  let mentions = 0;
  let citations = 0;
  let allMentions = 0;
  series.forEach((s, i) => {
    for (const d of s.days.slice(from, to)) {
      allMentions += d.mentions;
      if (i !== si) continue;
      keywords += d.keywords;
      matched += d.matched;
      positionSum += d.positionSum;
      positionSamples += d.positionSamples;
      mentions += d.mentions;
      citations += d.citations;
    }
  });
  return {
    visibility: keywords > 0 ? matched / keywords : null,
    avgPosition: positionSamples > 0 ? positionSum / positionSamples : null,
    share: allMentions > 0 ? mentions / allMentions : null,
    mentions: keywords > 0 ? mentions : null,
    citations: keywords > 0 ? citations : null,
  };
}

/**
 * Headline numbers for a panel: the value over the whole selected period, and its trend as the
 * second half of the period vs the first half - steadier than comparing two single days.
 */
export function periodMetrics(series: SubjectSeries[], si: number): PeriodMetrics {
  const n = series[si]?.days.length ?? 0;
  const half = Math.floor(n / 2);
  const all = aggregateDays(series, si, 0, n);
  const early = half > 0 ? aggregateDays(series, si, 0, half) : null;
  const late = half > 0 ? aggregateDays(series, si, n - half, n) : null;
  const metric = (k: keyof Aggregate): PeriodMetric => {
    const a = early?.[k];
    const b = late?.[k];
    return { value: all[k], delta: a != null && b != null ? b - a : null };
  };
  return {
    visibility: metric("visibility"),
    avgPosition: metric("avgPosition"),
    share: metric("share"),
    mentions: metric("mentions"),
    citations: metric("citations"),
    halfDays: half,
  };
}

export interface SurfaceSplit {
  dates: string[];
  visibility: Record<Surface, Array<number | null>>;
  /** Share of searches where the surface rendered at all (organic results existed, an AI Overview / AI Mode answer showed). */
  presence: Record<Surface, number>;
  overall: Record<Surface, number>;
}

/** Your brand's visibility split by surface, plus how often each surface appears at all. */
export function computeSurfaceSplit(histories: KeywordHistory[], hits: HitLookup): SurfaceSplit {
  const dates = collectDates(histories);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const perDay = dates.map(() => ({ total: 0, organic: 0, aiOverview: 0, aiMode: 0 }));
  let total = 0;
  const presentCount: Record<Surface, number> = { organic: 0, aiOverview: 0, aiMode: 0 };
  const matchedCount: Record<Surface, number> = { organic: 0, aiOverview: 0, aiMode: 0 };

  for (const h of histories) {
    for (const day of h.days) {
      if (day.error) continue;
      const di = dateIndex.get(day.date);
      if (di == null) continue;
      const dh = hits(day, 0);
      total++;
      perDay[di].total++;
      if (day.organicResults.length > 0) presentCount.organic++;
      if (day.aiOverview.present) presentCount.aiOverview++;
      if (day.aiMode.present) presentCount.aiMode++;
      for (const s of SURFACES) {
        if (dh[s].matched) {
          perDay[di][s]++;
          matchedCount[s]++;
        }
      }
    }
  }

  const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);
  const series = (s: Surface) => perDay.map((p) => (p.total > 0 ? p[s] / p.total : null));
  return {
    dates,
    visibility: { organic: series("organic"), aiOverview: series("aiOverview"), aiMode: series("aiMode") },
    presence: {
      organic: ratio(presentCount.organic, total),
      aiOverview: ratio(presentCount.aiOverview, total),
      aiMode: ratio(presentCount.aiMode, total),
    },
    overall: {
      organic: ratio(matchedCount.organic, total),
      aiOverview: ratio(matchedCount.aiOverview, total),
      aiMode: ratio(matchedCount.aiMode, total),
    },
  };
}

export interface RankCell {
  position: number | null;
  /** Positive = moved up (better) since this keyword's previous tracked day. */
  delta: number | null;
  enteredTop: boolean;
  droppedOut: boolean;
  aiOverviewShown: boolean;
  aiOverviewMatched: boolean;
  aiModeShown: boolean;
  aiModeMatched: boolean;
  /** How deep that day's SERP was tracked, so "not found" can say "not in the top N". */
  depth: number;
  showingResultsFor: string | null;
  lowRelevance: boolean;
}

export interface RankRow {
  keywordId: string;
  keyword: string;
  landingUrl: string | null;
  cells: Record<string, RankCell>;
}

/** Keyword x date organic-position grid for one subject - the rank-tracker table. */
export function computeRankGrid(
  histories: KeywordHistory[],
  subjectIndex: number,
  hits: HitLookup
): { dates: string[]; rows: RankRow[] } {
  const dates = collectDates(histories).reverse();
  const rows = histories.map((h): RankRow => {
    const days = h.days.filter((d) => !d.error).sort((a, b) => a.date.localeCompare(b.date));
    const cells: Record<string, RankCell> = {};
    let prev: RankCell | null = null;
    let landingUrl: string | null = null;

    for (const day of days) {
      const dh = hits(day, subjectIndex);
      const position = dh.organicPosition;
      const cell: RankCell = {
        position,
        delta: prev && prev.position != null && position != null ? prev.position - position : null,
        enteredTop: !!prev && prev.position == null && position != null,
        droppedOut: !!prev && prev.position != null && position == null,
        aiOverviewShown: day.aiOverview.present,
        aiOverviewMatched: dh.aiOverview.matched,
        aiModeShown: day.aiMode.present,
        aiModeMatched: dh.aiMode.matched,
        depth: day.resultDepth ?? day.organicResults.length,
        showingResultsFor: day.showingResultsFor ?? null,
        lowRelevance: !!day.lowRelevance,
      };
      cells[day.date] = cell;
      prev = cell;
      if (position != null) landingUrl = day.organicResults.find((r) => r.position === position)?.link ?? landingUrl;
    }

    return { keywordId: h.keywordId, keyword: h.keyword, landingUrl, cells };
  });
  return { dates, rows };
}

/** Which subjects own an organic result (their website) or are merely mentioned in it - for tagging rows in a SERP list. */
export function subjectsInResult(result: OrganicResultSnapshot, subjects: Subject[]): Array<{ subject: Subject; owns: boolean }> {
  const text = `${result.title} ${result.snippet}`;
  const found: Array<{ subject: Subject; owns: boolean }> = [];
  for (const s of subjects) {
    if (domainMatchesWebsite(result.domain, s.website)) {
      found.push({ subject: s, owns: true });
      continue;
    }
    const mentioned = [s.def.name, ...s.def.aliases].filter((n) => n.trim()).some((n) => {
      const escaped = n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(text);
    });
    if (mentioned) found.push({ subject: s, owns: false });
  }
  return found;
}

const GBP_UTM = /^(gbp|gmb|google[_-]?my[_-]?business|googlemybusiness|google[_-]?business([_-]?profile)?)$/i;

/**
 * Whether a cited link came through one of Google's own surfaces rather than straight from a site:
 * Google-hosted pages (Search "search viewer" / Business Profile / Maps / Travel / Shopping), or
 * third-party booking links Google injects from its feeds (Things to Do links carry
 * utm_source=gttd and unfilled {surface}/{funnel} templates; Business Profile website buttons carry
 * gbp/gmb UTM tags).
 */
export function googleVia(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link.replace(/\{[^}]*\}/g, "x"));
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const q = u.searchParams;
  if (isGoogleHost(host)) {
    if (host.startsWith("maps.") || host.endsWith("goo.gl") || u.pathname.startsWith("/maps")) return "Google Maps";
    if (u.pathname.startsWith("/travel/hotels")) return "Google Hotels";
    if (u.pathname.startsWith("/travel")) return "Google Travel";
    if (u.pathname.startsWith("/shopping") || q.get("tbm") === "shop" || q.get("udm") === "28") return "Google Shopping";
    if (q.has("ludocid") || q.has("lrd") || q.has("kgmid") || q.has("lsig") || (q.get("ibp") ?? "").startsWith("gwp")) {
      return "Google Business Profile";
    }
    if (u.pathname.startsWith("/search") || u.pathname === "/") return "Google Search";
    return "Google";
  }
  const utmSource = q.get("utm_source") ?? "";
  // Operators hand Google's Things to Do feed URL templates; Google sometimes cites them with the
  // placeholders still unfilled, which is a reliable fingerprint of that feed.
  if (utmSource.toLowerCase() === "gttd" || /\{(surface|funnel|lang|currency|product_id|option_id)\}/.test(link)) {
    return "Google Things to Do";
  }
  if (GBP_UTM.test(utmSource) || /^(gbp|gmb)\b/i.test(q.get("utm_campaign") ?? "")) return "Google Business Profile";
  if (/^google[_-]?hotels?$|^google_hpa$/i.test(utmSource)) return "Google Hotels";
  return null;
}

export interface DomainRow {
  domain: string;
  owner: Subject | null;
  organicAppearances: number;
  avgPosition: number | null;
  aiOverviewCitations: number;
  aiModeCitations: number;
  keywords: number;
  total: number;
  sampleLink: string | null;
  /** How many of this domain's appearances reached Google's answers through Google's own surfaces, by surface. */
  googleVia: Record<string, number>;
  /** Best guess at the brand behind the domain, from its page titles - used when tracking it as a competitor. */
  siteName: string;
}

const compact = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Titles usually carry the site's brand as their first or last segment ("Indochina Junk | Bai Tu Long
 * Bay Cruises", "Halong Bay Cruises - Heritage Cruises"). Prefer a segment that spells the domain's own
 * label, then one repeated across the site's titles, then fall back to the domain label itself.
 */
export function guessSiteName(domain: string, titles: string[], labels: string[] = []): string {
  // Google's own label for the site (SerpApi `source`), unless it's just the hostname again.
  const labelCounts = new Map<string, number>();
  for (const l of labels) if (!/^[\w.-]+\.[a-z]{2,}$/i.test(l)) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
  const topLabel = Array.from(labelCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (topLabel) return topLabel[0];

  const hostParts = domain.split(".");
  const label =
    (hostParts.length > 2 && hostParts[hostParts.length - 2].length <= 3 ? hostParts[hostParts.length - 3] : hostParts[hostParts.length - 2]) ?? domain;
  const counts = new Map<string, number>();
  let domainMatch: string | null = null;

  for (const title of titles) {
    // "Ambassador Cruise Ha Long" -> leading words that spell the domain label ("ambassadorcruise").
    const words = title.split(/\s+/);
    let acc = "";
    for (let i = 0; i < Math.min(words.length, 6) && !domainMatch; i++) {
      acc += compact(words[i]);
      if (acc.length >= 4 && acc === compact(label)) domainMatch = words.slice(0, i + 1).join(" ").replace(/[^\p{L}\p{N}]+$/u, "");
      if (!compact(label).startsWith(acc)) break;
    }
    const parts = title.split(/\s+[|\-–—:·]\s+/).map((p) => p.trim()).filter((p) => p.length >= 2 && p.length <= 40);
    const ends = parts.length > 1 ? Array.from(new Set([parts[0], parts[parts.length - 1]])) : parts;
    for (const part of ends) {
      const c = compact(part);
      if (!domainMatch && c.length >= 4 && (c === compact(label) || compact(label).startsWith(c))) domainMatch = part;
      if (parts.length > 1) counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }
  if (domainMatch) return domainMatch;

  const repeated = Array.from(counts.entries()).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
  if (repeated) return repeated[0];

  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Every domain seen in organic results or cited as an AI source, minus user-excluded ones. */
export function computeDomainRows(
  histories: KeywordHistory[],
  subjects: Subject[],
  excludedDomains: string[],
  filter: SurfaceFilter
): DomainRow[] {
  const surfaces = surfacesIn(filter);
  const isExcluded = (domain: string) => excludedDomains.some((ex) => domainMatchesWebsite(domain, ex));
  const byDomain = new Map<
    string,
    {
      organic: number;
      positionSum: number;
      aio: number;
      aiMode: number;
      keywords: Set<string>;
      link: string | null;
      titles: Set<string>;
      labels: string[];
      via: Record<string, number>;
    }
  >();
  const entry = (domain: string, keyword: string, link: string, title: string, label?: string) => {
    if (!domain) return null;
    if (isExcluded(domain)) return null;
    let e = byDomain.get(domain);
    if (!e) {
      e = { organic: 0, positionSum: 0, aio: 0, aiMode: 0, keywords: new Set(), link, titles: new Set(), labels: [], via: {} };
      byDomain.set(domain, e);
    }
    e.keywords.add(keyword);
    if (title) e.titles.add(title);
    if (label) e.labels.push(label);
    const via = googleVia(link);
    if (via) e.via[via] = (e.via[via] ?? 0) + 1;
    return e;
  };

  for (const h of histories) {
    for (const day of h.days) {
      if (day.error) continue;
      if (surfaces.includes("organic")) {
        for (const r of day.organicResults) {
          const e = entry(r.domain, h.keyword, r.link, r.title, r.source);
          if (e) {
            e.organic++;
            e.positionSum += r.position;
          }
        }
      }
      if (surfaces.includes("aiOverview")) {
        for (const s of day.aiOverview.sources) {
          const e = entry(s.domain, h.keyword, s.link, s.title, s.source);
          if (e) e.aio++;
        }
      }
      if (surfaces.includes("aiMode")) {
        for (const s of day.aiMode.sources) {
          const e = entry(s.domain, h.keyword, s.link, s.title, s.source);
          if (e) e.aiMode++;
        }
      }
    }
  }

  const rows = Array.from(byDomain.entries()).map(([domain, e]): DomainRow => ({
    domain,
    owner: subjects.find((s) => domainMatchesWebsite(domain, s.website)) ?? null,
    organicAppearances: e.organic,
    avgPosition: e.organic > 0 ? e.positionSum / e.organic : null,
    aiOverviewCitations: e.aio,
    aiModeCitations: e.aiMode,
    keywords: e.keywords.size,
    total: e.organic + e.aio + e.aiMode,
    sampleLink: e.link,
    googleVia: e.via,
    siteName: guessSiteName(domain, Array.from(e.titles), e.labels),
  }));
  rows.sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain));
  return rows;
}

export type MentionStatus = "cited" | "mentioned" | "none" | "notShown";

export interface AiResponseItem {
  key: string;
  keywordId: string;
  keyword: string;
  date: string;
  surface: AiSurface;
  answer: AiTextSnapshot;
  /** Subjects whose name/alias appears in the answer or whose site is cited, with how they matched. */
  subjectHits: Array<{ subject: Subject; mentioned: boolean; cited: boolean }>;
  yours: MentionStatus;
}

function statusOf(hit: BrandHit, shown: boolean): MentionStatus {
  if (!shown) return "notShown";
  if (!hit.matched) return "none";
  return hit.matchedBy.includes("website") ? "cited" : "mentioned";
}

/** Every AI Overview / AI Mode answer captured on a given date (or each keyword's latest date). */
export function collectAiResponses(
  histories: KeywordHistory[],
  subjects: Subject[],
  hits: HitLookup,
  surfaces: AiSurface[],
  date: string | null
): AiResponseItem[] {
  const items: AiResponseItem[] = [];
  for (const h of histories) {
    const days = h.days.filter((d) => !d.error);
    const day = date ? days.find((d) => d.date === date) : days.sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!day) continue;
    for (const surface of surfaces) {
      const answer = day[surface];
      const subjectHits = subjects.map((subject, si) => {
        const hit = hits(day, si)[surface];
        return {
          subject,
          mentioned: hit.matchedBy.includes("name") || hit.matchedBy.includes("alias"),
          cited: hit.matchedBy.includes("website"),
        };
      });
      items.push({
        key: `${h.keywordId}-${day.date}-${surface}`,
        keywordId: h.keywordId,
        keyword: h.keyword,
        date: day.date,
        surface,
        answer,
        subjectHits,
        yours: statusOf(hits(day, 0)[surface], answer.present),
      });
    }
  }
  return items;
}

export interface RankBucket {
  key: string;
  label: string;
  count: number;
  share: number;
  /** Keywords in this bucket that moved up (or newly entered) / moved down since their previous tracked day. */
  up: number;
  down: number;
}

export interface RankOverview {
  buckets: RankBucket[];
  keywords: number;
  latestDate: string | null;
  depth: number;
}

/** Buckets each keyword's most recent position (Top 1-3 / 4-5 / 6-10 / 11-depth / not ranking) - the rank-tracker summary card. */
export function computeRankOverview(grid: { dates: string[]; rows: RankRow[] }): RankOverview {
  const latest = grid.rows
    .map((row) => {
      const date = grid.dates.find((d) => row.cells[d]);
      return date ? row.cells[date] : null;
    })
    .filter((c): c is RankCell => c !== null);
  const depth = Math.max(10, ...latest.map((c) => c.depth || 0));

  const ranges: Array<{ key: string; label: string; min: number; max: number }> = [
    { key: "1-3", label: "Top 1-3", min: 1, max: 3 },
    { key: "4-5", label: "Top 4-5", min: 4, max: 5 },
    { key: "6-10", label: "Top 6-10", min: 6, max: 10 },
    ...(depth > 10 ? [{ key: "11+", label: `Top 11-${depth}`, min: 11, max: depth }] : []),
  ];
  const buckets: RankBucket[] = [
    ...ranges.map((r) => ({ key: r.key, label: r.label, count: 0, share: 0, up: 0, down: 0 })),
    { key: "out", label: `Not in top ${depth}`, count: 0, share: 0, up: 0, down: 0 },
  ];

  for (const cell of latest) {
    const index = cell.position == null ? buckets.length - 1 : ranges.findIndex((r) => cell.position! >= r.min && cell.position! <= r.max);
    const bucket = buckets[index === -1 ? buckets.length - 1 : index];
    bucket.count++;
    if (cell.enteredTop || (cell.delta ?? 0) > 0) bucket.up++;
    if ((cell.delta ?? 0) < 0 || cell.droppedOut) bucket.down++;
  }
  for (const b of buckets) b.share = latest.length > 0 ? b.count / latest.length : 0;

  return { buckets, keywords: latest.length, latestDate: grid.dates[0] ?? null, depth };
}
