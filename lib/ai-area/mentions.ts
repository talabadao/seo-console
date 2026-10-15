// Brand-name matching helpers, copied from the AI Brand Mention app (src/lib/mentions.ts).
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive, whole-word(ish) occurrence count of `term` inside `text`. */
export function countMentions(text: string, term: string): number {
  const trimmed = term.trim();
  if (!trimmed || !text) return 0;
  const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "gi");
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

/** Total occurrences across any of the given terms (e.g. a brand name + its aliases). */
export function countMentionsAny(text: string, terms: string[]): number {
  return terms.reduce((sum, term) => sum + countMentions(text, term), 0);
}

export function splitList(value?: string): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const cleaned = raw.trim();
    if (!cleaned || seen.has(cleaned.toLowerCase())) continue;
    seen.add(cleaned.toLowerCase());
    out.push(cleaned);
  }
  return out;
}

/** Whether a leaderboard name refers to the brand (either contains the other), matching any of its terms. */
export function matchesBrand(name: string, brandTerms: string[]): boolean {
  const lower = name.toLowerCase();
  return brandTerms.some((t) => {
    const term = t.trim().toLowerCase();
    return term !== "" && (lower.includes(term) || term.includes(lower));
  });
}
