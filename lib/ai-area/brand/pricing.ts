// Brand Mentions' model choices and per-answer estimates, on top of the shared price table
// (lib/providers/pricing.ts, which carries the pricing version). Adapted from the AI Brand Mention app.
import { MODEL_PRICES, WEB_SEARCH_USD_PER_CALL, capCost, type ModelPrice } from "@/lib/providers/pricing";
import type { Platform } from "./types";

export interface LlmModel extends ModelPrice {
  note: string;
  /** Typical tokens for one web-search answer (search content included), for estimates before real usage exists. */
  typical: { input: number; output: number; searches: number };
}

export const WEB_SEARCH_PER_CALL = WEB_SEARCH_USD_PER_CALL;

function model(id: string, note: string, typical: LlmModel["typical"]): LlmModel {
  const price = MODEL_PRICES.find((m) => m.id === id);
  if (!price) throw new Error(`No price for ${id}`);
  return { ...price, note, typical };
}

export const CHATGPT_MODELS: LlmModel[] = [
  model("gpt-5.4-mini", "Cheap and fast; close to ChatGPT's everyday answers.", { input: 8000, output: 900, searches: 1 }),
  model("gpt-5.5", "OpenAI's flagship; the most ChatGPT-like answers, ~4x the cost.", { input: 8000, output: 1000, searches: 1 }),
];

export const CLAUDE_MODELS: LlmModel[] = [
  model("claude-opus-5-5", "Anthropic's current flagship.", { input: 15000, output: 1200, searches: 2 }),
  model("claude-sonnet-5-5", "About half the cost of Opus, strong answers (default).", { input: 15000, output: 1200, searches: 2 }),
  model("claude-haiku-5-5", "Cheapest; most of the cost is the web searches.", { input: 15000, output: 1000, searches: 2 }),
];

export const DEFAULT_CHATGPT_MODEL = "gpt-5.4-mini";
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

/** Answers are analysed (mentions, sentiment, claims) with this model. */
export const ANALYSIS_MODEL = "gpt-4o-mini";
/** About 5k tokens in and 800 out per analysed answer. */
export const ANALYSIS_TYPICAL = { input: 5000, output: 800 };

/** Estimated USD for token usage; unknown models are priced conservatively (as the most expensive listed model). */
export function tokenCost(modelId: string, usage: { input: number; output: number; cachedInput?: number }): number {
  return capCost(modelId, usage);
}

export function typicalAnswerCost(m: LlmModel): number {
  return tokenCost(m.id, { input: m.typical.input, output: m.typical.output }) + m.typical.searches * WEB_SEARCH_PER_CALL;
}

export function analysisCost(modelId: string = ANALYSIS_MODEL): number {
  return tokenCost(modelId, ANALYSIS_TYPICAL);
}

/** SerpApi requests per prompt: AI Mode is one search; AI Overview is a Google search plus, usually, one to load it. */
export const SERP_CREDITS: Record<Platform, number> = { aiMode: 1, aiOverview: 2, chatgpt: 0, claude: 0 };
