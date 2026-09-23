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
  longtailMinWords: 7,
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
  /** Cross-dimension scope while viewing Queries: only queries seen on a page whose URL contains this. */
  filterPage: string;
  /** Cross-dimension scope while viewing Pages: only pages ranking for a query containing this. */
  filterQuery: string;
}

export const EMPTY_FILTER: FilterState = {
  branded: "all",
  position: 0,
  question: false,
  longtail: false,
  ai: false,
  contains: "",
  trend: "all",
  filterPage: "",
  filterQuery: "",
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

function isIntegerPosition(p: number): boolean {
  return Math.abs(p - Math.round(p)) < 1e-9;
}

// A query matches if it satisfies any of these branches (OR, not AND):
//   1. Position ~1.0 and impressions < 10 — ranking #1 but barely getting
//      shown, a classic sign an AI Overview/answer box is absorbing the
//      impression instead of a standard blue link.
//   2. Impressions = 1 and position 2.0-20.0 — a single, oddly-precise
//      (integer) impression at a non-top position, typical of an AI
//      assistant citing the page once rather than organic search traffic.
//   3. Newly-appeared this period (zero presence in the equivalent prior
//      period — see isNew), non-integer position under 10, and under 30
//      impressions — a sudden, still-noisy blip rather than an established
//      ranking. The current-vs-none jump between periods stands in for
//      "irregular activity" here, since the breakdown only carries
//      period-aggregate totals, not a per-day series per query.
export function matchesAi(row: BreakdownRow): boolean {
  const p = row.position;
  const branch1 = Math.abs(p - 1) < 0.05 && row.impressions < 10;
  const branch2 = row.impressions === 1 && p >= 2 - 1e-9 && p <= 20 + 1e-9;
  const branch3 =
    row.isNew && p > 0 && p < 10 && !isIntegerPosition(p) && row.impressions > 0 && row.impressions < 30;
  return branch1 || branch2 || branch3;
}

// ---------- AI Search Prompts: Offtopic / Bot labels ----------
//
// Rule-based only (no API/LLM call) — flags concrete, non-semantic patterns
// found in AI-referral query text. None of these rules are language-
// dependent since they key off syntax/structure, not meaning. A further,
// genuinely off-topic-content pattern (e.g. a query entirely unrelated to
// the site's subject matter, from an AI grounding mismatch) isn't included
// here — telling "off-topic" from "on-topic" requires understanding what
// the site is actually about, which isn't something a string rule can do
// reliably; that would need a real semantic classifier (e.g. an LLM pass)
// as a separate, opt-in step.
//
// Calibrated against two real GSC query exports (~6,900 rows total): the
// "# role / # directive / ..." system-prompt pattern and the "-site:x.com"
// search-operator pattern below both matched real rows exactly as expected.
// That pass also surfaced a third pattern not originally covered — synthetic
// "audience persona" prompts an AI tool generates before asking its actual
// question, e.g. "I am a 55-64 or 65+ year old. My main motivations: ...
// My main pain points: ... <the real question>" — 37 rows in one export,
// always carrying both "my main motivation(s)" and "my main pain point(s)"
// together, which is why both are listed as markers below (their co-
// occurrence is what reaches the 2-marker threshold — no organic query
// realistically contains either phrase at all).

const BOT_MARKER_KEYWORDS = [
  "no greeting",
  "no emoji",
  "hedging",
  "reasoning is internal",
  "# role",
  "# directive",
  "# persona",
  "# instructions",
  "# system",
  "you are an ai",
  "do not mention",
  "internal monologue",
  "my main motivation",
  "my main pain point",
];

/** Pattern A: prompt-injection text masquerading as a system prompt (starts with "#", or hits
 * 2+ of the marker phrases those prompts consistently use). Pattern B: automated search-agent
 * syntax — 2+ "-word"/"-site:..." exclusion tokens, which no human types by hand. */
export function isBotQuery(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (k.startsWith("#")) return true;
  const lower = k.toLowerCase();
  if (BOT_MARKER_KEYWORDS.filter((m) => lower.includes(m)).length >= 2) return true;
  const exclusions = k.match(/(^|\s)-(?:site:)?\S+/g) ?? [];
  return exclusions.length >= 2;
}

const OFFTOPIC_FILLER_WORDS = new Set([
  "ok", "okay", "k", "kk", "ya", "yes", "no", "yeah", "yep", "nope",
  "hoy", "oui", "oùi", "non", "si", "sí",
  "ค่ะ", "ครับ", "จ้า",
]);
const OFFTOPIC_OPTION_RE = /^option\s*[a-z0-9]+$/i;

/** Pure filler — a single-letter/token "answer" or stock acknowledgement with no real query
 * intent (often a multiple-choice reply meant for a different question entirely). Does NOT
 * catch genuinely off-topic-but-substantial content — see the module note above. */
export function isOfftopicFiller(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  const lower = k.toLowerCase();
  if (OFFTOPIC_FILLER_WORDS.has(lower)) return true;
  if (OFFTOPIC_OPTION_RE.test(lower)) return true;
  // The short-length fallback only applies outside CJK/Hangul/Kana script —
  // those pack far more meaning per character than Latin text, so a 2-
  // character query like "价格" (price) or "越南" (Vietnam) is a complete,
  // on-topic word, not filler. (Confirmed against a real ~6,900-row export:
  // without this guard, common short CJK/Korean queries — price, cave,
  // Vietnam, boat, bay — all got misflagged.)
  if (isCjk(k)) return false;
  return k.length <= 2;
}

export type AiPromptFlag = "bot" | "offtopic" | "new" | null;

/** Which badge (if any) to show on an AI-matched row — checked in severity order. */
export function classifyAiPrompt(row: BreakdownRow): AiPromptFlag {
  if (isBotQuery(row.key)) return "bot";
  if (isOfftopicFiller(row.key)) return "offtopic";
  if (row.isNew) return "new";
  return null;
}

export function filterActive(f: FilterState): boolean {
  return (
    f.branded !== "all" ||
    f.position !== 0 ||
    f.question ||
    f.longtail ||
    f.ai ||
    f.trend !== "all" ||
    f.contains.trim().length > 0 ||
    f.filterPage.trim().length > 0 ||
    f.filterQuery.trim().length > 0
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
      if (f.ai && !matchesAi(r)) return false;
    }
    return true;
  });
}
