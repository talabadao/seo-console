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

// Interrogatives + question particles across the languages we support.
// - Latin / Cyrillic single words: matched as whole tokens
// - Latin / Cyrillic multi-word phrases: matched as consecutive tokens
// - CJK (no word boundaries): matched as raw substrings
const QUESTION_TERMS = [
  // English
  "what", "whats", "what's", "when", "where", "which", "who", "whom", "whose",
  "why", "how", "how to", "how do", "how much", "how many",
  // Vietnamese
  "gì", "sao", "tại sao", "vì sao", "thế nào", "như thế nào", "ở đâu", "khi nào",
  "bao giờ", "bao nhiêu", "làm sao", "có nên", "có phải", "là gì", "ra sao", "cách",
  "cách đi", "có tốt",
  // French
  "quoi", "quel", "quelle", "quels", "quelles", "où", "quand", "comment",
  "pourquoi", "combien", "est-ce que", "qu'est-ce", "ou aller", "ou est",
  // German
  "was", "wer", "wo", "wann", "warum", "wieso", "weshalb", "wie", "welche",
  "welcher", "welches", "wieviel", "wie viel", "wie komme", "wie viele",
  // Spanish
  "qué", "cuál", "cuáles", "quién", "quiénes", "dónde", "cuándo", "cómo",
  "por qué", "porqué", "cuánto", "cuánta", "cuántos", "cuántas", "para qué",
  "que ver", "que hacer", "como llegar", "como ir", "cuanto cuesta", "donde esta",
  // Russian
  "что", "кто", "где", "когда", "почему", "зачем", "как", "какой", "какая",
  "какое", "какие", "сколько", "куда", "чей", "чья", "чьё", "как добраться",
  // Chinese (substring — bare 何 / 呢 omitted, too ambiguous)
  "什么", "什麼", "为什么", "為什麼", "为何", "何时", "何處", "怎么", "怎麼", "怎样",
  "怎樣", "如何", "哪里", "哪裡", "哪儿", "哪個", "哪个", "多少", "是否", "吗",
  // Japanese (substring)
  "なぜ", "どうして", "どうやって", "どこ", "いつ", "どれ", "どの", "いくら",
  "いくつ", "ですか", "ますか", "でしょうか", "何時", "何が", "何を",
  // Korean (substring)
  "무엇", "왜", "어떻게", "어디에", "언제", "어느", "얼마", "누구", "인가요", "나요",
  "까요", "은가요", "일까",
];

const isCjk = (s: string) => /[぀-ヿ㐀-鿿가-힯ｦ-ﾟ]/.test(s);
const tokenize = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const Q_TOKENS = new Set<string>();
const Q_PHRASES: string[] = []; // space-joined token sequences
const Q_CJK: string[] = [];
for (const raw of QUESTION_TERMS) {
  const t = raw.toLowerCase();
  if (isCjk(t)) {
    Q_CJK.push(t);
  } else {
    const toks = tokenize(t);
    if (toks.length === 1) Q_TOKENS.add(toks[0]);
    else if (toks.length > 1) Q_PHRASES.push(toks.join(" "));
  }
}

// 任何 = "any", 无论/無論 = "no matter" — 何 there isn't a question.
const CJK_NEGATORS = new Set(["任", "无", "無"]);

export function isQuestion(key: string): boolean {
  const k = key.toLowerCase();
  for (const p of Q_CJK) {
    for (let i = k.indexOf(p); i !== -1; i = k.indexOf(p, i + 1)) {
      if (!CJK_NEGATORS.has(k[i - 1])) return true;
    }
  }
  const tokens = tokenize(k);
  const set = new Set(tokens);
  for (const t of Q_TOKENS) if (set.has(t)) return true;
  if (Q_PHRASES.length) {
    const joined = ` ${tokens.join(" ")} `;
    for (const p of Q_PHRASES) if (joined.includes(` ${p} `)) return true;
  }
  return false;
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
