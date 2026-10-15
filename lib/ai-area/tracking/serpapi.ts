// Parsing of SerpApi's Google, AI Overview and AI Mode responses, adapted from the AI Brand Mention app
// (src/lib/tracking/serpapi.ts). Requests go through the metered SEO Console client (lib/providers/serpapi.ts),
// passed in as `search`, so every call is capped and recorded; there's no key handling here.
import type { AiTextSnapshot, OrganicResultSnapshot, SourceRef, TrackingSettings } from "./types";

/** One metered SerpApi search (see lib/providers/serpapi.ts serpSearch). "No results" resolves to {}. */
export type Search = (params: Record<string, string>) => Promise<Record<string, unknown>>;

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

interface RawTextBlockItem {
  snippet?: unknown;
  title?: unknown;
}

interface RawTextBlock {
  type?: unknown;
  snippet?: unknown;
  list?: RawTextBlockItem[];
}

interface RawReference {
  title?: unknown;
  link?: unknown;
  source?: unknown;
}

export function flattenTextBlocks(blocks: RawTextBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  const lines: string[] = [];
  for (const block of blocks) {
    if (typeof block.snippet === "string") lines.push(block.snippet);
    if (Array.isArray(block.list)) {
      for (const item of block.list) {
        const text = typeof item.snippet === "string" ? item.snippet : typeof item.title === "string" ? item.title : "";
        if (text) lines.push(`- ${text}`);
      }
    }
  }
  return lines.join("\n");
}

export function mapReferences(refs: RawReference[] | undefined): SourceRef[] {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((r) => ({
      title: typeof r.title === "string" ? r.title : "",
      link: typeof r.link === "string" ? r.link : "",
      domain: typeof r.link === "string" ? extractDomain(r.link) : "",
      ...(typeof r.source === "string" && r.source.trim() ? { source: r.source.trim() } : {}),
    }))
    .filter((r) => r.link);
}

function localeParams(settings: TrackingSettings): Record<string, string> {
  return { gl: settings.country, hl: settings.language, device: settings.device };
}

export interface OrganicPage {
  /** Positions as SerpApi reports them - they restart at 1 on every page, so callers renumber. */
  results: OrganicResultSnapshot[];
  aiOverviewPageToken: string | null;
  hasNextPage: boolean;
  showingResultsFor: string | null;
}

interface RawOrganicResult {
  position?: unknown;
  title?: unknown;
  link?: unknown;
  snippet?: unknown;
  source?: unknown;
}

interface RawOrganicResponse {
  organic_results?: RawOrganicResult[];
  ai_overview?: { page_token?: unknown };
  search_information?: { showing_results_for?: unknown; spelling_fix?: unknown };
  serpapi_pagination?: { next?: unknown };
  error?: string;
}

/**
 * Fetches one 10-result page of Google organic results (`start` = 0, 10, 20 ...) plus, on page 1, the
 * AI Overview stub token. Google no longer honours `num=100`, so deeper tracking means paging.
 */
export async function fetchOrganicPage(
  query: string,
  settings: TrackingSettings,
  search: Search,
  start: number,
  noCache = false
): Promise<OrganicPage> {
  const params: Record<string, string> = { engine: "google", q: query, ...localeParams(settings) };
  if (start > 0) params.start = String(start);
  if (noCache) params.no_cache = "true";
  // Paging past the last result comes back as an empty object (a normal empty page, not a failure).
  const data = (await search(params)) as RawOrganicResponse;

  const results: OrganicResultSnapshot[] = (data.organic_results ?? [])
    .map((r): OrganicResultSnapshot | null => {
      const link = typeof r.link === "string" ? r.link : "";
      if (!link) return null;
      return {
        position: typeof r.position === "number" ? r.position : 0,
        title: typeof r.title === "string" ? r.title : "",
        link,
        domain: extractDomain(link),
        snippet: typeof r.snippet === "string" ? r.snippet : "",
        ...(typeof r.source === "string" && r.source.trim() ? { source: r.source.trim() } : {}),
      };
    })
    .filter((r): r is OrganicResultSnapshot => r !== null);

  const info = data.search_information;
  const rewritten = typeof info?.showing_results_for === "string" ? info.showing_results_for : typeof info?.spelling_fix === "string" ? info.spelling_fix : null;

  return {
    results,
    aiOverviewPageToken: typeof data.ai_overview?.page_token === "string" ? data.ai_overview.page_token : null,
    hasNextPage: typeof data.serpapi_pagination?.next === "string" && results.length > 0,
    showingResultsFor: rewritten,
  };
}

interface RawAiOverviewResponse {
  ai_overview?: { text_blocks?: RawTextBlock[]; references?: RawReference[] };
  error?: string;
}

/** Redeems an AI Overview page_token (expires ~1 minute after the organic search) for the full AI Overview content. */
export async function fetchAiOverview(pageToken: string, search: Search): Promise<AiTextSnapshot> {
  const data = (await search({ engine: "google_ai_overview", page_token: pageToken })) as RawAiOverviewResponse;

  const blocks = data.ai_overview?.text_blocks;
  const text = flattenTextBlocks(blocks);
  return {
    present: text.length > 0,
    text: text || null,
    sources: mapReferences(data.ai_overview?.references),
  };
}

interface RawAiModeResponse {
  text_blocks?: RawTextBlock[];
  references?: RawReference[];
  error?: string;
}

/** Fetches Google's AI Mode answer for a query directly (single call, no stub/redeem step). */
export async function fetchAiMode(query: string, settings: TrackingSettings, search: Search): Promise<AiTextSnapshot> {
  const data = (await search({ engine: "google_ai_mode", q: query, gl: settings.country, hl: settings.language })) as RawAiModeResponse;

  const text = flattenTextBlocks(data.text_blocks);
  return {
    present: text.length > 0,
    text: text || null,
    sources: mapReferences(data.references),
  };
}
