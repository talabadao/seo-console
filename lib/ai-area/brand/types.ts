/** Brand Mentions: how AI answer engines talk about a project's brand, tracked per prompt over time. */

export type Platform = "aiMode" | "aiOverview" | "chatgpt" | "claude";
export const PLATFORMS: Platform[] = ["aiMode", "aiOverview", "chatgpt", "claude"];
export const PLATFORM_LABEL: Record<Platform, string> = {
  aiMode: "Google AI Mode",
  aiOverview: "Google AI Overview",
  chatgpt: "ChatGPT",
  claude: "Claude",
};

export type PromptSource = "manual" | "upload" | "suggested";

/** A question real people might ask an AI about the brand, its products or its category. */
export interface BrandPrompt {
  id: string;
  text: string;
  topic: string;
  /** Mentions the brand by name (branded) or not (unbranded/category). Detected from the brand name and aliases. */
  branded: boolean;
  source: PromptSource;
  active: boolean;
  createdAt: string;
}

export type Sentiment = "positive" | "neutral" | "negative";

export interface SourceLink {
  title: string;
  url: string;
  domain: string;
}

/** A statement an answer makes about the tracked brand. */
export interface Claim {
  claim: string;
  detail: string;
  sentiment: Sentiment;
  attribute: string;
  /** "fact" = checkable statement (prices, capacity, awards...); "opinion" = judgement. */
  kind: "fact" | "opinion";
  /** Index into the response's sources when the answer cites one for this claim. */
  sourceIndex: number | null;
}

export interface BrandInAnswer {
  name: string;
  /** Order of first mention among the brands in the answer (1 = first). */
  position: number;
  /** 0-100 (50 = neutral). */
  sentiment: number;
  isTarget: boolean;
  attributes: Array<{ attribute: string; sentiment: Sentiment }>;
}

export interface ResponseAnalysis {
  brandMentioned: boolean;
  brandPosition: number | null;
  /** 0-100 for the tracked brand; null when it isn't mentioned. */
  brandSentiment: number | null;
  brands: BrandInAnswer[];
  claims: Claim[];
}

/** One AI answer to one prompt on one platform, in one tracking cycle. */
export interface BrandResponse {
  promptId: string;
  platform: Platform;
  at: string;
  /** False when the platform gave no answer (e.g. Google showed no AI Overview for this query). */
  present: boolean;
  text: string;
  sources: SourceLink[];
  model?: string;
  analysis?: ResponseAnalysis;
  /** USD spent on the answer and its analysis (LLM platforms + analysis); SerpApi credits are counted separately. */
  costUsd: number;
  serpCredits: number;
  error?: string;
  /** Why the answer wasn't analysed (e.g. paid model calls are off on Preview). The answer text is still real. */
  analysisError?: string;
}

export interface PerceptionSegment {
  text: string;
  tone: "strength" | "weakness" | null;
}

export interface PerceptionSummary {
  paragraphs: PerceptionSegment[][];
  generatedAt: string;
}

/** paused-budget: the daily AI spending limit; stopped: a SerpApi cap or policy stopped it (both can be continued). */
export type CycleStatus = "running" | "paused-budget" | "stopped" | "done";

export interface CycleSummary {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: CycleStatus;
  /** Prompt x platform answers planned / finished. */
  total: number;
  done: number;
  costUsd: number;
  serpCredits: number;
  trigger: "manual";
  /** The ai_runs row working on this cycle (one at a time per project). */
  runId?: string;
  note?: string;
}

export interface Cycle {
  id: string;
  /** Prompt x platform answers this cycle collects, fixed when it starts. */
  plan: Array<{ promptId: string; platform: Platform }>;
  /** The prompts as they were when the cycle started (they can be edited or deleted later). */
  prompts: Record<string, Pick<BrandPrompt, "text" | "topic" | "branded">>;
  responses: BrandResponse[];
  /** "all" plus one per platform. */
  summaries: Partial<Record<Platform | "all", PerceptionSummary>>;
  /** Attribute names used so far, so answers are grouped consistently. */
  attributes: string[];
}

/** Runs are started by hand (Run now); scheduled runs are off in this phase. */
export interface BrandSettings {
  platforms: Record<Platform, boolean>;
  chatgptModel: string;
  claudeModel: string;
}

/** How a topic compares between what customers say in reviews and what AI answers say. */
export type GapStatus = "aligned" | "missing" | "contradicts" | "ai-only";
export type GapTone = "positive" | "negative" | "mixed" | "none";

export interface CustomerGapItem {
  topic: string;
  customers: GapTone;
  ai: GapTone;
  status: GapStatus;
  note: string;
}

/** AI answers vs customer reviews, generated after each run (and on demand). */
export interface CustomerGap {
  generatedAt: string;
  cycleId: string | null;
  reviews: number;
  summary: string;
  items: CustomerGapItem[];
}

export type FactVerdict = "correct" | "incorrect";
