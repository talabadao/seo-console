// Shapes shared by the reviews backend and the Reviews tab. No server imports.

export type Sentiment = "positive" | "mixed" | "neutral" | "negative";
export type Polarity = "praise" | "criticism";

/** One specific thing a review says about one aspect of the business. */
export interface ReviewPoint {
  aspect: string;
  polarity: Polarity;
  /** Short English quote of what the customer said. */
  quote: string;
}

export interface Review {
  id: string;
  reviewer: string;
  star: number;
  /** The text as the customer wrote it. */
  comment: string;
  /** English version when the original is in another language. */
  commentEn: string | null;
  time: number;
  reply: string | null;
  replyTime: number | null;
  sentiment: Sentiment;
  points: ReviewPoint[];
  /** False while the review still has only its star-based sentiment. */
  analyzed: boolean;
}

export interface ReviewsData {
  location: string;
  locationTitle: string;
  averageRating: number | null;
  totalReviews: number | null;
  syncedAt: number | null;
  syncError: string | null;
  aspects: string[];
  reviews: Review[];
  /** Reviews with text that haven't been through the classifier yet. */
  pending: number;
  /** Whether a classifier key is configured on the server. */
  classifier: boolean;
}

export const OTHER = "Other";

/** Sentiment when all we have is the star rating. */
export function starSentiment(star: number): Sentiment {
  return star >= 4 ? "positive" : star === 3 ? "neutral" : "negative";
}

/**
 * Google returns auto-translated reviews as
 * "(Translated by Google) <english> (Original) <original>". Split that back
 * into the customer's own words and the English version.
 */
export function splitTranslated(comment: string): { original: string; english: string | null } {
  const m = /^\s*\(Translated by Google\)\s*([\s\S]*?)\s*\(Original\)\s*([\s\S]*)$/.exec(comment);
  if (m && m[2].trim()) return { original: m[2].trim(), english: m[1].trim() || null };
  return { original: comment.trim(), english: null };
}
