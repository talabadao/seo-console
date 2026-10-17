// Provider icons served from /public/icons/providers (copied unchanged from the owner's 2026-10-17 handoff; sources,
// retrieval times and SHA-256 hashes are in /public/icons/providers/manifest.json). Local files only: no runtime
// favicon lookups. An icon identifies a provider; it never means the integration is connected or live.

export type ProviderIconId =
  | "asana"
  | "se-ranking"
  | "google-analytics"
  | "google-search-console"
  | "claude"
  | "chatgpt"
  | "copilot"
  | "gemini"
  | "perplexity";

export const PROVIDER_ICONS: Record<ProviderIconId, { label: string; src: string; /** Needs a light badge behind it on dark surfaces. */ badge?: boolean }> = {
  asana: { label: "Asana", src: "/icons/providers/asana.ico" },
  "se-ranking": { label: "SE Ranking", src: "/icons/providers/se-ranking.svg" },
  "google-analytics": { label: "Google Analytics 4", src: "/icons/providers/google-analytics.svg" },
  "google-search-console": { label: "Google Search Console", src: "/icons/providers/google-search-console.png" },
  claude: { label: "Claude", src: "/icons/providers/claude.png" },
  chatgpt: { label: "ChatGPT / OpenAI", src: "/icons/providers/chatgpt.png", badge: true },
  copilot: { label: "Microsoft Copilot", src: "/icons/providers/copilot.svg" },
  gemini: { label: "Google Gemini", src: "/icons/providers/gemini.png" },
  perplexity: { label: "Perplexity", src: "/icons/providers/perplexity.svg", badge: true },
};

/** The icon for a data source label as the dashboards write it ("Google Search Console", "SE Ranking", …). */
export function iconForSource(source: string | null | undefined): ProviderIconId | null {
  const s = (source ?? "").toLowerCase();
  if (s.includes("search console")) return "google-search-console";
  if (s.includes("analytics") || /\bga4\b/.test(s)) return "google-analytics";
  if (s.includes("se ranking")) return "se-ranking";
  if (s.includes("asana")) return "asana";
  return null;
}

/** The icon for an LLMs Traffic platform id (lib/v2/llm/platforms.ts). */
export function iconForPlatform(id: string): ProviderIconId | null {
  return id === "chatgpt" || id === "claude" || id === "copilot" || id === "gemini" || id === "perplexity" ? id : null;
}
