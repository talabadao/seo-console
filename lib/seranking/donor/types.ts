/** SE Ranking: a project's rank tracking, site audit, AI Results Tracker and SE Visible data, synced into one snapshot. */

/** An SE Ranking project ("site"). */
export interface SeSite {
  id: number;
  title: string;
  url: string;
  keywordCount: number;
  isActive: boolean;
  guestLink?: string;
}

/** Which SE Ranking project an app project shows. siteId null = matched by the brand's website. */
export interface SeLink {
  siteId: number | null;
}

export interface SeSummary {
  todayAvg: number | null;
  yesterdayAvg: number | null;
  up: number;
  down: number;
  top5: number;
  top10: number;
  top30: number;
  visibility: number | null;
  visibilityPercent: number | null;
  domainTrust: number | null;
  indexGoogle: number | null;
}

/** A search engine configured in the project (Google + country/region + language). */
export interface SeEngine {
  id: number;
  searchEngineId: number;
  name: string;
  region: string | null;
  lang: string | null;
  keywordCount: number;
}

export interface SeSeries {
  engineId: number | null;
  name: string;
  points: Array<{ date: string; value: number | null }>;
}

export type HistoryMetric = "avg_pos" | "visibility_percent" | "top10";

export interface SeKeyword {
  id: string;
  engineId: number;
  name: string;
  groupId: string | null;
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  landing: string | null;
  /** SERP features on the results page; ownFeatures are the ones that link to the site. */
  features: string[];
  ownFeatures: string[];
  /** Daily positions, oldest first. 0 = not in the tracked depth. */
  positions: Array<{ date: string; pos: number }>;
  /** Latest position, null when not ranking. */
  current: number | null;
  /** Positions gained (positive) or lost (negative) since the previous check / 7 / 30 days ago; null when either side isn't ranking. */
  change1: number | null;
  change7: number | null;
  change30: number | null;
  best: number | null;
}

export interface SeAuditIssue {
  section: string;
  code: string;
  name: string;
  status: "error" | "warning" | "notice";
  pages: number;
}

export interface SeAudit {
  id: number;
  url: string;
  title: string;
  status: string;
  lastUpdate: string | null;
  auditTime: string | null;
  score: number | null;
  prevScore: number | null;
  pages: number;
  errors: number;
  warnings: number;
  notices: number;
  passed: number;
  domain: { dt: number | null; backlinks: number | null; refDomains: number | null; indexGoogle: number | null };
  issues: SeAuditIssue[];
  sections: Array<{ name: string; errors: number; warnings: number; notices: number }>;
  /** Core Web Vitals verdicts from Chrome UX data: 0 good, 1 needs improvement, 2 poor. */
  vitals: { mobile: number | null; desktop: number | null } | null;
}

export interface SeBacklinks {
  total: number;
  domains: number;
  dofollow: number;
  nofollow: number;
  anchors: number;
  ip: number;
}

export interface SeCompetitor {
  id: number;
  name: string;
  url: string;
  domainTrust: number | null;
}

/** One day of a site's rankings across the tracked keywords on one search engine. */
export interface SeRankDay {
  date: string;
  top3: number;
  top10: number;
  /** Keywords in the top 100. */
  ranked: number;
  /** Mean position over all tracked keywords, counting a keyword that isn't in the top 100 as 100 (as SE Ranking does). */
  avgPos: number | null;
}

/** A domain competing in the top 10 of the project's keywords on the main search engine. */
export interface SeRivalDomain {
  domain: string;
  isOwn: boolean;
  /** Its SE Ranking competitor ID when it's tracked as a competitor in the project. */
  competitorId: number | null;
  /** SE Ranking visibility % at the latest check, and at the comparison check about a week earlier. */
  visibility: number;
  visibilityPrev: number | null;
  /** Counted from the top 10 of each keyword at the latest check. */
  top3: number;
  top10: number;
  /** Mean position of its top-10 results. */
  avgPos: number | null;
  /** Search volume of the keywords it's in the top 10 for. */
  volume: number;
  backlinks: number | null;
  refDomains: number | null;
}

export interface SeSerpResult {
  pos: number;
  domain: string;
  url: string;
}

/** Who competes for the project's keywords: every domain in the top 10, from SE Ranking's daily checks. */
export interface SeCompetition {
  engineId: number;
  engineName: string;
  date: string;
  prevDate: string | null;
  /** Keywords whose top 10 was read (by search volume, up to MAX_SERP_KEYWORDS). */
  keywordCount: number;
  domains: SeRivalDomain[];
  /** Daily visibility % (SE Ranking keeps 14 days), for the site, its tracked competitors and the leading domains. */
  visibilityTrend: Array<{ date: string; values: Record<string, number> }>;
  /** The top 10 per keyword ID at the latest check. */
  serps: Record<string, SeSerpResult[]>;
}

/** A competitor tracked in the SE Ranking project, with its positions for the project's keywords. */
export interface SeRival {
  id: number;
  name: string;
  domain: string;
  domainTrust: number | null;
  /** Latest position per `${engineId}:${keywordId}`, and the position 7 days before it; 0 = not in the top 100. */
  latest: Record<string, number>;
  prev7: Record<string, number>;
  /** Daily totals per search engine ID, last 30 days. */
  trend: Record<string, SeRankDay[]>;
}

/** The backlink profile costs API credits (about this many per refresh), so it refreshes weekly unless asked. */
export const LINK_PROFILE_CREDITS = 750;
export const LINK_PROFILE_MAX_AGE_MS = 7 * 86_400_000;

/** Referring domain gained or lost recently. */
export interface SeLinkDomain {
  domain: string;
  date: string;
  backlinks: number;
  dofollow: number | null;
  dt: number | null;
}

/**
 * The site's backlink profile from SE Ranking's backlink index (Data API - the same data as SE Ranking's Backlink
 * Checker). Each refresh costs API credits, so it's refreshed weekly rather than with every daily sync.
 */
export interface SeLinkProfile {
  fetchedAt: string;
  target: string;
  mode: "domain" | "host";
  /** Domain Trust and Page Trust (SE Ranking's Domain InLink Rank / InLink Rank), 0-100. */
  domainTrust: number | null;
  pageTrust: number | null;
  backlinks: number;
  refDomains: number;
  dofollow: number;
  nofollow: number;
  dofollowRefDomains: number | null;
  ips: number | null;
  subnets: number | null;
  textBacklinks: number | null;
  fromHomePages: number | null;
  edu: number | null;
  gov: number | null;
  anchorCount: number | null;
  pagesWithBacklinks: number | null;
  new30: { backlinks: number; refDomains: number };
  lost30: { backlinks: number; refDomains: number };
  /** Last 90 days, oldest first: live backlinks, and backlinks / referring domains found and lost that day. */
  daily: Array<{ date: string; total: number | null; newLinks: number; lostLinks: number; newDomains: number; lostDomains: number }>;
  /** Weekly Domain Trust and home-page Page Trust, last 6 months. */
  trust: Array<{ date: string; dt: number | null; pt: number | null }>;
  anchors: Array<{ anchor: string; backlinks: number; refDomains: number; dofollow: number | null; firstSeen: string | null }>;
  /** Referring domains per Domain Trust band: 0-9, 10-19, ... 90-100. */
  dtBands: number[];
  countries: Array<{ code: string; count: number }>;
  tlds: Array<{ tld: string; count: number }>;
  topPages: Array<{ url: string; backlinks: number | null; refDomains: number | null }>;
  newDomains: SeLinkDomain[];
  lostDomains: SeLinkDomain[];
  /** The site and its tracked competitors side by side. */
  compare: Array<{ domain: string; isOwn: boolean; backlinks: number | null; refDomains: number | null; dofollow: number | null; domainTrust: number | null }>;
  /** Parts of the backlink data SE Ranking didn't return. */
  errors: Record<string, string>;
}

export const LLM_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_ai_overview: "Google AI Overview",
  google_ai_mode: "Google AI Mode",
  perplexity: "Perplexity",
  gemini: "Gemini",
};

/** An AI engine tracked in SE Ranking's AI Results Tracker (engine + country + language). */
export interface SeAiEngine {
  id: number;
  baseName: string;
  label: string;
  country: string | null;
  lang: string | null;
  region: string | null;
  promptsCount: number;
  lastUpdate: string | null;
  /** % of prompts where the brand is mentioned / the site is linked, and the change over the last 30 days (points). */
  mentionPct: number | null;
  mentionDiff: number | null;
  linkPct: number | null;
  linkDiff: number | null;
  /** Google AI Overview only: % of prompts that show an AI Overview, and organic-AIO URL overlap. */
  aioPct: number | null;
  overlapPct: number | null;
  /** Other engines: % of answers that cite sources. */
  sourcesPct: number | null;
  /** Daily mention / link presence over the last 30 days (% of prompts). */
  trend: Array<{ date: string; mention: number | null; link: number | null }>;
}

export interface SeAiResult {
  date: string;
  /** null: no AI answer block that day; 0: not mentioned / not linked; 1+: position. */
  mentionPos: number | null;
  mentionsCount: number | null;
  urlPos: number | null;
  urlsCount: number | null;
  /** The previous check's mention position, to show movement. */
  prevMentionPos: number | null;
}

export interface SeAiPrompt {
  text: string;
  volume: number | null;
  intent: string[] | null;
  /** Latest result per AI engine (keyed by engine id). */
  engines: Record<string, SeAiResult>;
}

export interface SeAiSources {
  summary: { opportunities: number; competitorOnly: number; newOpportunities: number; withoutBacklinks: number };
  brands: Array<{ name: string; inAnswers: number; inSources: number }>;
  domains: Array<{
    domain: string;
    aiAnswers: number;
    prompts: number;
    coverage: number | null;
    mentionRate: number | null;
    dt: number | null;
    isProject: boolean;
    isCompetitor: boolean;
    brandMentioned: boolean;
  }>;
  recommendations: Array<{ code: string; domain: string | null; count: number | null }>;
}

export interface SeAi {
  brand: string | null;
  engines: SeAiEngine[];
  prompts: SeAiPrompt[];
  sources: SeAiSources | null;
}

/** SE Visible (SE Ranking's separate AI-visibility product), when the account tracks the same domain there. */
export interface SeVisible {
  projectId: string;
  domain: string;
  checkedAt: string | null;
  models: string[];
  brands: Array<{ name: string; isPrimary: boolean; visibility: number | null; shareOfVoice: number | null; sentiment: number | null; avgPosition: number | null; mentions: number | null }>;
  prompts: Array<{ text: string; visibility: number | null; shareOfVoice: number | null; avgPosition: number | null; sentiment: number | null; mentions: number | null; topBrands: string[] }>;
}

export type SeSection =
  | "summary"
  | "engines"
  | "history"
  | "keywords"
  | "competitors"
  | "competition"
  | "rivals"
  | "audit"
  | "backlinks"
  | "linkProfile"
  | "ai"
  | "aiSources"
  | "visible";

export interface SeSnapshot {
  version: 1;
  siteId: number;
  siteTitle: string;
  siteUrl: string;
  guestLink: string | null;
  syncedAt: string;
  /** Generated data (no SE Ranking key on the server). */
  mock: boolean;
  /** Parts of the sync that failed, with the API's message; the rest of the snapshot is still valid. */
  errors: Partial<Record<SeSection, string>>;
  summary: SeSummary | null;
  engines: SeEngine[];
  history: Partial<Record<HistoryMetric, SeSeries[]>>;
  keywords: SeKeyword[];
  competitors: SeCompetitor[];
  competition: SeCompetition | null;
  rivals: SeRival[];
  audit: SeAudit | null;
  /** Links tracked in SE Ranking's Backlink Monitor (often empty). */
  backlinks: SeBacklinks | null;
  linkProfile: SeLinkProfile | null;
  ai: SeAi | null;
  visible: SeVisible | null;
}
