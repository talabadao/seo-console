// One keyword's daily snapshot, adapted from the AI Brand Mention app (src/lib/tracking/run.ts).
// Changes: requests go through the metered `search` (caps and ledger, no key rotation), and a refusal from a
// cap or the Preview policy (SerpRefused) stops the keyword instead of being swallowed, so a run never keeps
// trying once it's out of allowance.
import { SerpRefused } from "@/lib/providers/serpapi";
import { fetchAiMode, fetchAiOverview, fetchOrganicPage, type OrganicPage, type Search } from "./serpapi";
import { computeAiHit, computeOrganicHit } from "./visibility";
import type {
  AiTextSnapshot,
  KeywordDailySnapshot,
  OrganicResultSnapshot,
  TrackedBrand,
  TrackedKeyword,
  TrackingSettings,
} from "./types";

const EMPTY_AI: AiTextSnapshot = { present: false, text: null, sources: [] };
const EMPTY_HIT = { matched: false, matchedBy: [] as Array<"name" | "alias" | "website">, organicPosition: null };
const PAGE_SIZE = 10;
/** Deep results keep title/link/domain; snippets are only stored where people actually read them. */
const SNIPPET_DEPTH = 20;
const STOPWORDS = new Set(["the", "and", "for", "with", "best", "top", "near", "from", "what", "how", "in", "of"]);

export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function linkKey(link: string): string {
  try {
    const u = new URL(link);
    u.hash = "";
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return link;
  }
}

/**
 * Google occasionally serves a SERP that has nothing to do with the query (we saw "bai tu long bay
 * cruises" come back as results for "tu"). If under a third of page 1 mentions any keyword term, the
 * page is treated as suspect and fetched once more, bypassing SerpApi's cache.
 */
function isLowRelevance(results: OrganicResultSnapshot[], keyword: string): boolean {
  const terms = keyword
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  if (terms.length === 0 || results.length < 3) return false;
  const relevant = results.filter((r) => {
    const text = `${r.title} ${r.snippet} ${r.link}`.toLowerCase();
    return terms.some((t) => text.includes(t));
  }).length;
  return relevant / results.length < 0.34;
}

/** Merges pages in order, drops results Google repeats across pages, and renumbers 1..N. */
function mergePages(pages: OrganicResultSnapshot[][], depth: number): OrganicResultSnapshot[] {
  const seen = new Set<string>();
  const merged: OrganicResultSnapshot[] = [];
  for (const page of pages) {
    for (const r of page) {
      const key = linkKey(r.link);
      if (seen.has(key)) continue;
      seen.add(key);
      const position = merged.length + 1;
      merged.push({ ...r, position, snippet: position <= SNIPPET_DEPTH ? r.snippet : "" });
      if (merged.length >= depth) return merged;
    }
  }
  return merged;
}

/**
 * Runs one keyword through organic results (paged to the configured depth), AI Overview and AI Mode, and scores
 * brand visibility. If a cap or the Preview policy refuses a request part-way (SerpRefused), what was already
 * fetched is kept and the snapshot is marked `stopped`, so the caller ends the run; when even page 1 is refused,
 * SerpRefused is thrown and nothing is stored. searchesUsed counts requests actually sent (refused ones aren't).
 */
export async function trackKeyword(
  keyword: TrackedKeyword,
  settings: TrackingSettings,
  brand: TrackedBrand,
  search: Search
): Promise<KeywordDailySnapshot> {
  const depth = settings.resultDepth ?? 10;
  const pageCount = Math.max(1, Math.ceil(depth / PAGE_SIZE));
  let searchesUsed = 0;
  let stopped: string | null = null;
  /** Sends one request; returns null when it was refused (and remembers why), rethrows other errors. */
  async function sent<T>(fn: () => Promise<T>): Promise<T | null> {
    if (stopped) return null;
    try {
      const value = await fn();
      searchesUsed++;
      return value;
    } catch (err) {
      if (err instanceof SerpRefused) {
        stopped = err.message;
        return null;
      }
      searchesUsed++;
      throw err;
    }
  }
  const fetchPage = (start: number, noCache = false) => sent(() => fetchOrganicPage(keyword.keyword, settings, search, start, noCache));

  try {
    let first = await fetchPage(0);
    if (!first) throw new SerpRefused(stopped ?? "SerpApi request refused.");
    let lowRelevance = false;
    if (isLowRelevance(first.results, keyword.keyword)) {
      const retry = await fetchPage(0, true);
      if (retry) {
        first = retry;
        lowRelevance = isLowRelevance(first.results, keyword.keyword);
      }
    }
    const page1: OrganicPage = first;

    // The AI Overview page_token expires about a minute after page 1, so redeem it before paging on.
    let aiOverview = EMPTY_AI;
    if (page1.aiOverviewPageToken) {
      const token = page1.aiOverviewPageToken;
      try {
        aiOverview = (await sent(() => fetchAiOverview(token, search))) ?? EMPTY_AI;
      } catch {
        // token expired or the overview failed to load - keep the rest of the run
      }
    }

    const pages: OrganicResultSnapshot[][] = [page1.results];
    let more = page1.hasNextPage;
    // Pages one at a time (not in parallel) so a cap stops exactly at its limit.
    for (let p = 1; p < pageCount && more && !stopped; p++) {
      try {
        const page = await fetchPage(p * PAGE_SIZE);
        if (!page) break;
        pages.push(page.results);
        more = page.hasNextPage;
      } catch {
        // A deep page failing shouldn't discard the pages already fetched.
        more = false;
      }
    }
    const organicResults = mergePages(pages, depth);

    let aiMode = EMPTY_AI;
    try {
      aiMode = (await sent(() => fetchAiMode(keyword.keyword, settings, search))) ?? EMPTY_AI;
    } catch {
      // AI Mode is unavailable for some locales/queries; organic data is still worth keeping.
    }

    return {
      date: todayDateString(),
      organicResults,
      aiOverview,
      aiMode,
      brandHit: {
        organic: computeOrganicHit(organicResults, brand),
        aiOverview: computeAiHit(aiOverview, brand),
        aiMode: computeAiHit(aiMode, brand),
      },
      searchesUsed,
      resultDepth: depth,
      pagesFetched: pages.length,
      ...(page1.showingResultsFor ? { showingResultsFor: page1.showingResultsFor } : {}),
      ...(lowRelevance ? { lowRelevance } : {}),
      ...(stopped ? { stopped: true, error: `Stopped early: ${stopped}` } : {}),
    };
  } catch (err) {
    if (err instanceof SerpRefused) throw err;
    return {
      date: todayDateString(),
      organicResults: [],
      aiOverview: EMPTY_AI,
      aiMode: EMPTY_AI,
      brandHit: { organic: EMPTY_HIT, aiOverview: EMPTY_HIT, aiMode: EMPTY_HIT },
      searchesUsed,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
