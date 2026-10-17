// LLMs Traffic: identifiable AI-referral traffic in GA4.
//
// A session counts as AI traffic when its *session* source (GA4's session-scoped
// `sessionSource`, never first-user acquisition) matches the account's AI search
// sources list — the same list and the same matching rule (`classifyTraffic`) as
// the dashboard's "AI sessions" and the Weekly Report. Platforms group those
// sources (chatgpt.com and chat.openai.com are both ChatGPT); a source on the
// list that isn't a known assistant is its own platform, named by its domain.
//
// This measures visits that arrive with an AI referrer. It is not every visit an
// AI answer influenced: many arrive with no referrer and show as Direct.

import { classifyTraffic } from "@/lib/ga4Traffic";

export interface Platform {
  id: string;
  name: string;
  /** Colour token for charts. */
  color: string;
}

const KNOWN: { id: string; name: string; color: string; domains: string[] }[] = [
  { id: "chatgpt", name: "ChatGPT", color: "#10a37f", domains: ["chatgpt.com", "chat.openai.com", "openai.com"] },
  { id: "gemini", name: "Gemini", color: "#4285f4", domains: ["gemini.google.com", "bard.google.com"] },
  { id: "perplexity", name: "Perplexity", color: "#20808d", domains: ["perplexity.ai"] },
  { id: "copilot", name: "Copilot", color: "#7b61ff", domains: ["copilot.microsoft.com"] },
  { id: "claude", name: "Claude", color: "#d97757", domains: ["claude.ai"] },
  { id: "deepseek", name: "DeepSeek", color: "#4d6bfe", domains: ["chat.deepseek.com", "deepseek.com"] },
  { id: "grok", name: "Grok", color: "#6b7280", domains: ["grok.com"] },
  { id: "meta", name: "Meta AI", color: "#0866ff", domains: ["meta.ai"] },
  { id: "mistral", name: "Mistral", color: "#fa520f", domains: ["chat.mistral.ai"] },
];
const OTHER_COLORS = ["#9ca3af", "#a78bfa", "#f472b6", "#fbbf24", "#34d399"];

/** The platform a session source belongs to, or null when it isn't AI traffic under this list. */
export function platformOf(source: string, aiDomains: string[]): Platform | null {
  if (classifyTraffic(source, "", aiDomains) !== "ai") return null;
  const s = (source || "").toLowerCase();
  // Which list entry matched — the same test classifyTraffic uses.
  const domain = aiDomains.find((d) => d && (s === d || s.endsWith("." + d) || s.includes(d))) ?? s;
  const known = KNOWN.find((k) => k.domains.some((d) => domain === d || domain.endsWith("." + d)));
  if (known) return { id: known.id, name: known.name, color: known.color };
  const i = Math.abs([...domain].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % OTHER_COLORS.length;
  return { id: `other:${domain}`, name: domain, color: OTHER_COLORS[i] };
}

/** The list entries belonging to a platform (for filtering a report to it). */
export function domainsOfPlatform(platformId: string, aiDomains: string[]): string[] {
  return aiDomains.filter((d) => platformOf(d, aiDomains)?.id === platformId);
}

/**
 * A GA4 dimensionFilter selecting sessions whose source contains any of the domains — the same
 * "contains" test as classifyTraffic (which also accepts exact and subdomain matches, both of which
 * contain the domain), case-insensitive.
 */
export function sourceFilter(domains: string[]): unknown {
  const expressions = domains
    .filter(Boolean)
    .map((d) => ({ filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: d, caseSensitive: false } } }));
  return expressions.length === 1 ? expressions[0] : { orGroup: { expressions } };
}

/** Sums and session-weighted averages, for combining several sources of one platform. */
export class Weighted {
  sessions = 0;
  private sums: Record<string, number> = {};
  add(sessions: number, averages: Record<string, number>) {
    this.sessions += sessions;
    for (const [k, v] of Object.entries(averages)) this.sums[k] = (this.sums[k] ?? 0) + v * sessions;
  }
  avg(key: string): number | null {
    return this.sessions > 0 ? (this.sums[key] ?? 0) / this.sessions : null;
  }
}
