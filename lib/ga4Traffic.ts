// GA4 traffic classification shared by server code and client components. No network or database access
// (lib/ga4.ts sends requests through the shared provider limits, which need the database).

export const DEFAULT_AI_DOMAINS = [
  "chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "perplexity.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "claude.ai",
  "you.com",
  "poe.com",
  "meta.ai",
  "phind.com",
  "chat.deepseek.com",
  "chat.mistral.ai",
  "grok.com",
];

export type TrafficKind = "organic" | "ai" | "other";

export function classifyTraffic(
  source: string,
  channel: string,
  aiDomains: string[],
): TrafficKind {
  const s = (source || "").toLowerCase();
  if (aiDomains.some((d) => d && (s === d || s.endsWith("." + d) || s.includes(d)))) return "ai";
  // Exact match on GA4's "Organic Search" channel group only — a substring
  // match on "organic" also swept in "Organic Social", "Organic Video", and
  // "Organic Shopping", which is why totals here ran ~15-20% ahead of a
  // reference report filtered to just Organic Search.
  if ((channel || "").trim().toLowerCase() === "organic search") return "organic";
  return "other";
}
