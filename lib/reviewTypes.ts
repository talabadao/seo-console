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
  /** The review on Google Maps. */
  link: string | null;
  sentiment: Sentiment;
  points: ReviewPoint[];
  /** False while the review still has only its star-based sentiment. */
  analyzed: boolean;
}

export interface ReviewsData {
  placeTitle: string;
  address: string | null;
  placeType: string | null;
  averageRating: number | null;
  totalReviews: number | null;
  syncedAt: number | null;
  syncError: string | null;
  aspects: string[];
  /** Keywords Google highlights across all of the place's reviews. */
  topics: { keyword: string; mentions: number }[];
  reviews: Review[];
  /** Reviews with text that haven't been through the classifier yet. */
  pending: number;
  /** Whether a classifier key is configured on the server. */
  classifier: boolean;
  /** Searches left on the project's SerpApi key (null when it couldn't be read). */
  creditsLeft: number | null;
  keyError: string | null;
  /** SerpApi credits this place has used so far. */
  creditsSpent: number;
  /** 1 when the Maps link has no place id and the first fetch must look the place up. */
  lookupCredit: number;
  /** Whether older reviews remain that a "fetch older" run can continue into. */
  olderAvailable: boolean;
}

export const OTHER = "Other";

/** Sentiment when all we have is the star rating. */
export function starSentiment(star: number): Sentiment {
  return star >= 4 ? "positive" : star === 3 ? "neutral" : "negative";
}
