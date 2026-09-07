import type { BreakdownRow } from "@/lib/gscLive";

export interface SiteFilterConfig {
  brandTerms: string[];
  longtailMinWords: number;
  aiPosOp: "=" | "<=" | ">=";
  aiPosValue: number;
  aiImprMax: number;
}

export const DEFAULT_FILTER_CONFIG: SiteFilterConfig = {
  brandTerms: [],
  longtailMinWords: 4,
  aiPosOp: "=",
  aiPosValue: 1.0,
  aiImprMax: 10,
};

export interface FilterState {
  branded: "all" | "branded" | "nonbranded";
  position: 0 | 3 | 10 | 20; // <= N ; 0 = off
  question: boolean; // People Also Ask
  longtail: boolean;
  ai: boolean;
  contains: string;
  trend: "all" | "growing" | "decaying" | "new";
}

export const EMPTY_FILTER: FilterState = {
  branded: "all",
  position: 0,
  question: false,
  longtail: false,
  ai: false,
  contains: "",
  trend: "all",
};

const QUESTION_WORDS = [
  "what",
  "whats",
  "what's",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "how",
  "can",
  "does",
  "do",
  "is",
  "are",
  "will",
  "should",
];
const QUESTION_RE = new RegExp(`(^|\\s)(${QUESTION_WORDS.join("|")})(\\s|$)`, "i");

export function isQuestion(key: string): boolean {
  return QUESTION_RE.test(key);
}

export function wordCount(key: string): number {
  return key.trim().split(/\s+/).filter(Boolean).length;
}

export function isBranded(key: string, terms: string[]): boolean {
  if (!terms.length) return false;
  const k = key.toLowerCase();
  return terms.some((t) => t && k.includes(t.toLowerCase()));
}

export function matchesAi(row: BreakdownRow, cfg: SiteFilterConfig): boolean {
  const p = row.position;
  const okPos =
    cfg.aiPosOp === "="
      ? Math.abs(p - cfg.aiPosValue) < 0.05
      : cfg.aiPosOp === "<="
        ? p <= cfg.aiPosValue + 1e-9
        : p >= cfg.aiPosValue - 1e-9;
  return okPos && row.impressions < cfg.aiImprMax;
}

export function filterActive(f: FilterState): boolean {
  return (
    f.branded !== "all" ||
    f.position !== 0 ||
    f.question ||
    f.longtail ||
    f.ai ||
    f.trend !== "all" ||
    f.contains.trim().length > 0
  );
}

export function applyFilters(
  rows: BreakdownRow[],
  f: FilterState,
  cfg: SiteFilterConfig,
  dimension: string,
): BreakdownRow[] {
  const isQueryDim = dimension === "query";
  const needle = f.contains.trim().toLowerCase();

  return rows.filter((r) => {
    if (needle && !r.key.toLowerCase().includes(needle)) return false;

    if (f.position !== 0 && !(r.position > 0 && r.position <= f.position)) return false;

    if (f.trend === "growing" && r.clicks - r.prevClicks <= 0) return false;
    if (f.trend === "decaying" && r.clicks - r.prevClicks >= 0) return false;
    if (f.trend === "new" && !r.isNew) return false;

    // query-only text heuristics
    if (isQueryDim) {
      if (f.branded === "branded" && !isBranded(r.key, cfg.brandTerms)) return false;
      if (f.branded === "nonbranded" && isBranded(r.key, cfg.brandTerms)) return false;
      if (f.question && !isQuestion(r.key)) return false;
      if (f.longtail && wordCount(r.key) < cfg.longtailMinWords) return false;
      if (f.ai && !matchesAi(r, cfg)) return false;
    }
    return true;
  });
}
