export interface TrackingSettings {
  /** Google `hl` parameter, e.g. "en" */
  language: string;
  /** Google `gl` parameter, e.g. "us" */
  country: string;
  device: "desktop" | "tablet" | "mobile";
  /** How deep to track organic results. Google serves 10 per page, so each extra 10 costs one more SerpApi search. */
  resultDepth: ResultDepth;
}

export const RESULT_DEPTHS = [10, 20] as const;
export type ResultDepth = (typeof RESULT_DEPTHS)[number];

export interface TrackedKeyword {
  id: string;
  keyword: string;
  active: boolean;
  createdAt: string;
}

export interface TrackedBrand {
  name: string;
  aliases: string[];
  /** Root domain, e.g. "furamavietnam.com" (no protocol/www) */
  website: string;
}

export interface TrackedCompetitor {
  id: string;
  name: string;
  aliases: string[];
  /** Root domain, e.g. "marriott.com" (no protocol/www) */
  website: string;
}

export interface TrackingConfig {
  settings: TrackingSettings;
  keywords: TrackedKeyword[];
  brand: TrackedBrand;
  /** User-selected brands to rank against yours - applied retroactively to already-collected history, no extra API calls. */
  competitors: TrackedCompetitor[];
  /** Domains (blogs, OTAs, forums, ...) to hide from the cited-websites leaderboard, e.g. "reddit.com". */
  excludedDomains: string[];
}

export interface SourceRef {
  title: string;
  link: string;
  domain: string;
  /** Site name as Google labels it (e.g. "Indochina Junk"), when SerpApi provides one. */
  source?: string;
}

export interface OrganicResultSnapshot {
  position: number;
  title: string;
  link: string;
  domain: string;
  snippet: string;
  source?: string;
}

export interface AiTextSnapshot {
  present: boolean;
  text: string | null;
  sources: SourceRef[];
}

export interface BrandHit {
  matched: boolean;
  matchedBy: Array<"name" | "alias" | "website">;
  organicPosition: number | null;
}

export interface KeywordDailySnapshot {
  date: string;
  organicResults: OrganicResultSnapshot[];
  aiOverview: AiTextSnapshot;
  aiMode: AiTextSnapshot;
  brandHit: {
    organic: BrandHit;
    aiOverview: BrandHit;
    aiMode: BrandHit;
  };
  searchesUsed: number;
  error?: string;
  /** How many organic results were requested and how many 10-result pages it took. */
  resultDepth?: number;
  pagesFetched?: number;
  /** Google rewrote the query (e.g. autocorrect) - the results are for this text instead. */
  showingResultsFor?: string;
  /** Page 1 barely matched the keyword even after a fresh retry - treat positions with caution. */
  lowRelevance?: boolean;
  /** A cap or the Preview policy stopped this keyword part-way; what was fetched is kept. */
  stopped?: boolean;
}

export interface KeywordHistory {
  keywordId: string;
  keyword: string;
  days: KeywordDailySnapshot[];
}

export interface SerpUsage {
  fetchedAt: string;
  planId: string | null;
  planSearchesLeft: number | null;
  extraCreditsLeft: number | null;
  totalSearchesLeft: number | null;
  thisMonthUsage: number | null;
  searchesPerMonth: number | null;
  mock: boolean;
  /** Index into the configured key pool of the key currently serving requests, if known. */
  activeKeyIndex: number | null;
  keyPoolSize: number;
}

export interface RunResult {
  date: string;
  ranAt: string;
  keywordResults: Array<{ keywordId: string; keyword: string; searchesUsed: number; error?: string }>;
  totalSearchesUsed: number;
  mock: boolean;
}

/** One tracked brand/site - each project has its own keywords, competitors, search settings and history. */
export interface ProjectSummary {
  id: string;
  name: string;
  website: string;
  settings: TrackingSettings;
  keywordCount: number;
}
