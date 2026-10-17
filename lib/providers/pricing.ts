// Model prices for ESTIMATED costs. Adapted from the AI Brand Mention app (src/lib/brand/pricing.ts), whose
// table states its source: OpenAI's and Anthropic's pricing pages, October 2026. Every estimate is stored
// with PRICING_VERSION so it can be traced and re-checked; update the table (and the version) when the
// providers' prices change.
//
// These are estimates from recorded token usage, not billed amounts. A model missing from the table gets no
// estimate ("price unknown") rather than a guess. For spending caps only, an unknown model is assumed to cost
// as much as the most expensive listed model, so a cap can't be exceeded through an unlisted model.

export const PRICING_VERSION = "2026-10 (OpenAI and Anthropic pricing pages, via AI Brand Mention)";

export interface ModelPrice {
  id: string;
  label: string;
  provider: "openai" | "anthropic";
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M cached input tokens, when the provider discounts them. */
  cachedInput?: number;
  /** USD per 1M output tokens. */
  output: number;
}

export const MODEL_PRICES: ModelPrice[] = [
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "openai", input: 0.75, cachedInput: 0.075, output: 4.5 },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "openai", input: 5, cachedInput: 0.5, output: 30 },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano", provider: "openai", input: 0.2, output: 1.25 },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai", input: 0.4, output: 1.6 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "openai", input: 0.15, output: 0.6 },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", input: 4, cachedInput: 0.2, output: 20 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", input: 2, cachedInput: 0.2, output: 10 },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", input: 0.1, output: 0.5 },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic", input: 5, output: 25 },
];

/** Web search tool calls, billed on top of tokens by both providers. */
export const WEB_SEARCH_USD_PER_CALL = 0.01;

export function priceOf(model: string): ModelPrice | null {
  return MODEL_PRICES.find((m) => model === m.id || model.startsWith(`${m.id}-`)) ?? null;
}

/** Estimated USD for recorded usage, or null when the model's price isn't in the table. */
export function estimateCost(model: string, usage: { input: number; output: number; cachedInput?: number; webSearches?: number }): number | null {
  const p = priceOf(model);
  if (!p) return null;
  const cached = usage.cachedInput ?? 0;
  const tokens = ((usage.input - cached) * p.input + cached * (p.cachedInput ?? p.input) + usage.output * p.output) / 1_000_000;
  return tokens + (usage.webSearches ?? 0) * WEB_SEARCH_USD_PER_CALL;
}

/** Conservative cost for checking a cap before a call: unknown models count as the most expensive one. */
export function capCost(model: string, usage: { input: number; output: number; webSearches?: number }): number {
  const known = estimateCost(model, usage);
  if (known != null) return known;
  const max = MODEL_PRICES.reduce((m, p) => (p.input + p.output > m.input + m.output ? p : m));
  return (usage.input * max.input + usage.output * max.output) / 1_000_000 + (usage.webSearches ?? 0) * WEB_SEARCH_USD_PER_CALL;
}
