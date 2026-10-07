// SerpApi client for Google Maps reviews. Every search costs one SerpApi
// credit, so callers decide when to spend; nothing here runs on a schedule.

const BASE = "https://serpapi.com";

/** Reviews SerpApi returns on the first page, and on each page after it. */
export const FIRST_PAGE = 8;
export const NEXT_PAGE = 20;

/** Credits needed to read `count` reviews starting from the newest. */
export function creditsFor(count: number): number {
  if (count <= 0) return 0;
  return 1 + Math.ceil(Math.max(0, count - FIRST_PAGE) / NEXT_PAGE);
}

export class SerpApiError extends Error {}

async function call<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const qs = new URLSearchParams({ ...params, api_key: key });
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${qs}`, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new SerpApiError("SerpApi didn't answer in time.");
  }
  const body = await res.text();
  let json: { error?: string } & T;
  try {
    json = JSON.parse(body);
  } catch {
    throw new SerpApiError(`SerpApi ${res.status}: unexpected response.`);
  }
  if (res.status === 401 || /invalid api key/i.test(json.error ?? "")) {
    throw new SerpApiError("SerpApi rejected the API key. Check the key in the project settings.");
  }
  if (res.status === 429 || /run out of searches|exceed/i.test(json.error ?? "")) {
    throw new SerpApiError("This SerpApi key has no searches left.");
  }
  if (!res.ok && !json.error) throw new SerpApiError(`SerpApi ${res.status}.`);
  return json;
}

/** Searches left on the key. Free: the account endpoint doesn't use a credit. */
export async function searchesLeft(key: string): Promise<number | null> {
  const j = await call<{ total_searches_left?: number; plan_searches_left?: number }>("/account.json", {}, key);
  return j.total_searches_left ?? j.plan_searches_left ?? null;
}

// ---------- finding the place a Maps link points at ----------

// A place's data id ("0x…:0x…") or place id ("ChIJ…"), as they appear in Maps URLs.
const DATA_ID = /0x[0-9a-f]+:0x[0-9a-f]+/i;
const PLACE_ID = /(?:place_id[:=]|!19s|query_place_id=)(ChIJ[\w-]+)/;

export function placeRefFromUrl(url: string): string | null {
  let text = url;
  try {
    text = decodeURIComponent(url);
  } catch {
    /* use as-is */
  }
  return DATA_ID.exec(text)?.[0] ?? PLACE_ID.exec(text)?.[1] ?? null;
}

function isGoogleHost(host: string): boolean {
  return (
    host === "maps.app.goo.gl" ||
    host === "goo.gl" ||
    host === "g.co" ||
    /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)
  );
}

/** A Google Maps link (full or short), or null when it isn't one. */
export function normalizeMapsUrl(input: string): string | null {
  const raw = input.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return isGoogleHost(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Reads the place id out of a Maps link, following a short link's redirects
 * (Google hosts only) until a URL carrying the id turns up. Free — no SerpApi
 * call. `finalUrl` is the longest-form URL seen, for the paid fallback below.
 */
export async function resolveMapsUrl(mapsUrl: string): Promise<{ ref: string | null; finalUrl: string }> {
  let url = mapsUrl;
  for (let hop = 0; hop < 6; hop++) {
    const ref = placeRefFromUrl(url);
    if (ref) return { ref, finalUrl: url };
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      break;
    }
    if (!isGoogleHost(host)) break;
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const next = res.headers.get("location");
      if (!next) break;
      url = new URL(next, url).toString();
    } catch {
      break;
    }
  }
  return { ref: placeRefFromUrl(url), finalUrl: url };
}

/**
 * Fallback for links that carry no id (one credit): looks the place up by the
 * name and map position in the URL.
 */
export async function findPlace(key: string, finalUrl: string): Promise<string | null> {
  let text = finalUrl;
  try {
    text = decodeURIComponent(finalUrl);
  } catch {
    /* use as-is */
  }
  const name = /\/maps\/place\/([^/@]+)/.exec(text)?.[1]?.replace(/\+/g, " ").trim();
  if (!name) return null;
  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(text);
  const params: Record<string, string> = { engine: "google_maps", type: "search", q: name, hl: "en" };
  if (at) params.ll = `@${at[1]},${at[2]},15z`;
  const j = await call<{
    place_results?: { data_id?: string };
    local_results?: { data_id?: string }[];
  }>("/search.json", params, key);
  return j.place_results?.data_id ?? j.local_results?.[0]?.data_id ?? null;
}

// ---------- reviews ----------

export interface MapsReview {
  reviewId: string;
  reviewerName: string;
  star: number;
  /** English text (Google's translation when the review is in another language). */
  english: string;
  /** The reviewer's own words when they differ from `english`. */
  original: string | null;
  time: number;
  replyComment: string | null;
  replyTime: number | null;
  link: string | null;
}

export interface MapsPlace {
  title: string | null;
  address: string | null;
  type: string | null;
  rating: number | null;
  reviews: number | null;
}

export interface ReviewsPage {
  place: MapsPlace | null;
  topics: { keyword: string; mentions: number }[];
  reviews: MapsReview[];
  nextToken: string | null;
}

interface RawReview {
  review_id?: string;
  link?: string;
  rating?: number;
  iso_date?: string;
  snippet?: string;
  extracted_snippet?: { original?: string; translated?: string };
  user?: { name?: string };
  response?: { snippet?: string; iso_date?: string; extracted_snippet?: { original?: string; translated?: string } };
}

/** One page of a place's reviews, newest first (one credit). */
export async function reviewsPage(key: string, ref: string, token?: string | null): Promise<ReviewsPage> {
  const params: Record<string, string> = {
    engine: "google_maps_reviews",
    hl: "en",
    sort_by: "newestFirst",
    ...(ref.startsWith("0x") ? { data_id: ref } : { place_id: ref }),
  };
  if (token) {
    params.next_page_token = token;
    params.num = String(NEXT_PAGE);
  }
  const j = await call<{
    error?: string;
    place_info?: { title?: string; address?: string; type?: string; rating?: number; reviews?: number };
    topics?: { keyword?: string; mentions?: number }[];
    reviews?: RawReview[];
    serpapi_pagination?: { next_page_token?: string };
  }>("/search.json", params, key);

  // "No results" comes back as an error string; for reviews it just means none.
  if (j.error && !/hasn't returned any results/i.test(j.error)) throw new SerpApiError(`SerpApi: ${j.error}`);

  const now = Date.now();
  const reviews = (j.reviews ?? [])
    .filter((r) => r.review_id)
    .map((r) => {
      const english = (r.extracted_snippet?.translated ?? r.snippet ?? r.extracted_snippet?.original ?? "").trim();
      const own = (r.extracted_snippet?.original ?? "").trim();
      const reply = r.response?.extracted_snippet?.translated ?? r.response?.snippet ?? r.response?.extracted_snippet?.original;
      return {
        reviewId: r.review_id!,
        reviewerName: r.user?.name ?? "",
        star: Math.round(r.rating ?? 0),
        english,
        original: own && own !== english ? own : null,
        time: r.iso_date ? Date.parse(r.iso_date) || now : now,
        replyComment: reply?.trim() || null,
        replyTime: r.response?.iso_date ? Date.parse(r.response.iso_date) || null : null,
        link: r.link ?? null,
      };
    });

  return {
    place: j.place_info
      ? {
          title: j.place_info.title ?? null,
          address: j.place_info.address ?? null,
          type: j.place_info.type ?? null,
          rating: j.place_info.rating ?? null,
          reviews: j.place_info.reviews ?? null,
        }
      : null,
    topics: (j.topics ?? [])
      .filter((t) => t.keyword)
      .map((t) => ({ keyword: t.keyword!, mentions: t.mentions ?? 0 })),
    reviews,
    nextToken: j.serpapi_pagination?.next_page_token ?? null,
  };
}
