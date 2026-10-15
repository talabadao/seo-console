// Customer reviews for Brand Mentions: what customers say about the brand in its Google Maps reviews, summarised
// so it can sit next to what AI answers say. Adapted from the AI Brand Mention app, which read its own Google
// Maps / Tripadvisor / Google Hotels store; here the source is SEO Console's own Google Maps reviews (Reviews,
// table gbp_reviews), read from storage. Nothing here calls SerpApi or a model — fetching and classifying reviews
// stays in the Reviews screen, with its own credits. Tripadvisor and Google Hotels aren't connected.
import { db } from "@/lib/db";
import type { Project } from "@/lib/projects";
import { OTHER, starSentiment, type ReviewPoint, type Sentiment as ReviewSentiment } from "@/lib/reviewTypes";
import type { SuggestContext } from "./analyze";

export type ReviewSource = "maps";

export interface ListingRef {
  id: string;
  name: string;
  source: ReviewSource;
  sourceLabel: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  stored: number;
  lastSyncedAt: string | null;
}

export interface AspectSummary {
  aspect: string;
  /** Reviews making this point. */
  count: number;
  /** Share of analysed reviews (0-100). */
  share: number;
  quotes: string[];
}

export interface CustomerVoice {
  /** The project's Google Maps listing, when one is set up and synced in Reviews. */
  listing: ListingRef | null;
  since: string | null;
  totals: {
    reviews: number;
    analysed: number;
    avgRating: number | null;
    /** 0-100 on the same scale as the AI perception score: positive 100, mixed/neutral 50, negative 0. */
    score: number | null;
    sentiment: Record<ReviewSentiment, number>;
    positiveShare: number | null;
    negativeShare: number | null;
    responseRate: number | null;
  };
  praise: AspectSummary[];
  criticism: AspectSummary[];
  lastSyncedAt: string | null;
}

const SENTIMENT_SCORE: Record<ReviewSentiment, number> = { positive: 100, mixed: 50, neutral: 50, negative: 0 };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v: number | null, digits = 1) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

interface Row {
  review_id: string;
  star: number;
  create_time: number;
  reply_comment: string | null;
  sentiment: string | null;
  points_json: string | null;
  classified_at: number | null;
}

function points(json: string | null): ReviewPoint[] {
  try {
    const a = JSON.parse(json ?? "[]");
    return Array.isArray(a) ? (a as ReviewPoint[]) : [];
  } catch {
    return [];
  }
}

async function listing(project: Project): Promise<ListingRef | null> {
  if (!project.gbpLocation) return null;
  const state = (await db
    .prepare("SELECT average_rating, total_reviews, synced_at, address FROM gbp_state WHERE project_id = ? AND location = ?")
    .get(project.id, project.gbpLocation)) as { average_rating: number | null; total_reviews: number | null; synced_at: number | null; address: string | null } | undefined;
  const stored = (await db.prepare("SELECT COUNT(*) AS n FROM gbp_reviews WHERE project_id = ? AND location = ?").get(project.id, project.gbpLocation)) as { n: number };
  return {
    id: project.gbpLocation,
    name: project.gbpLocationTitle || project.name,
    source: "maps",
    sourceLabel: "Google Maps",
    address: state?.address ?? undefined,
    rating: state?.average_rating ?? undefined,
    reviewCount: state?.total_reviews ?? undefined,
    stored: Number(stored.n),
    lastSyncedAt: state?.synced_at ? new Date(Number(state.synced_at)).toISOString() : null,
  };
}

function aspectSummaries(reviews: { id: string; points: ReviewPoint[] }[], polarity: ReviewPoint["polarity"], analysed: number): AspectSummary[] {
  const map = new Map<string, { label: string; ids: Set<string>; quotes: string[] }>();
  for (const r of reviews) {
    for (const p of r.points) {
      if (p.polarity !== polarity || p.aspect === OTHER) continue;
      const key = p.aspect.trim().toLowerCase();
      const entry = map.get(key) ?? { label: p.aspect, ids: new Set<string>(), quotes: [] };
      entry.ids.add(r.id);
      const quote = (p.quote ?? "").trim();
      if (quote && entry.quotes.length < 3 && !entry.quotes.some((q) => q.toLowerCase() === quote.toLowerCase())) entry.quotes.push(quote);
      map.set(key, entry);
    }
  }
  return [...map.values()]
    .map((e) => ({ aspect: e.label, count: e.ids.size, share: share(e.ids.size, analysed) ?? 0, quotes: e.quotes }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

/** Summary of the project's stored Google Maps reviews since a date (null = all stored reviews). */
export async function customerVoice(project: Project, since: string | null): Promise<CustomerVoice> {
  const place = await listing(project);
  const sinceMs = since ? Date.parse(since) : 0;
  const rows = place
    ? ((await db
        .prepare(
          `SELECT review_id, star, create_time, reply_comment, sentiment, points_json, classified_at
             FROM gbp_reviews WHERE project_id = ? AND location = ? AND create_time >= ? ORDER BY create_time DESC`,
        )
        .all(project.id, place.id, sinceMs)) as unknown as Row[])
    : [];
  const reviews = rows.map((r) => {
    const analysed = r.classified_at != null;
    return {
      id: r.review_id,
      star: Number(r.star),
      analysed,
      sentiment: (analysed && r.sentiment ? r.sentiment : starSentiment(Number(r.star))) as ReviewSentiment,
      points: analysed ? points(r.points_json) : [],
      replied: Boolean(r.reply_comment),
    };
  });
  const analysed = reviews.filter((r) => r.analysed);
  const counts: Record<ReviewSentiment, number> = { positive: 0, mixed: 0, neutral: 0, negative: 0 };
  for (const r of analysed) counts[r.sentiment]++;
  const rated = reviews.filter((r) => r.star > 0).map((r) => r.star);
  return {
    listing: place,
    since,
    totals: {
      reviews: reviews.length,
      analysed: analysed.length,
      avgRating: round(avg(rated), 2),
      score: round(avg(analysed.map((r) => SENTIMENT_SCORE[r.sentiment]))),
      sentiment: counts,
      positiveShare: share(counts.positive, analysed.length),
      negativeShare: share(counts.negative, analysed.length),
      responseRate: share(reviews.filter((r) => r.replied).length, reviews.length),
    },
    praise: aspectSummaries(analysed, "praise", analysed.length),
    criticism: aspectSummaries(analysed, "criticism", analysed.length),
    lastSyncedAt: place?.lastSyncedAt ?? null,
  };
}

/** Grounding for prompt suggestions: the brand's listing and what customers praise and criticise. */
export async function suggestContext(project: Project): Promise<SuggestContext> {
  const voice = await customerVoice(project, new Date(Date.now() - 365 * 86_400_000).toISOString());
  return {
    listings: voice.listing ? [[voice.listing.name, voice.listing.sourceLabel, voice.listing.address].filter(Boolean).join(" · ")] : [],
    praised: voice.praise.slice(0, 6).map((a) => a.aspect),
    criticised: voice.criticism.slice(0, 4).map((a) => a.aspect),
    travellers: [],
  };
}
