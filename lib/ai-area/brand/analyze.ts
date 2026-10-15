// Reads AI answers about a brand (mentions, sentiment, claims), writes the perception summary, suggests prompts and
// compares AI answers with customer reviews. Adapted from the AI Brand Mention app; every call is a metered OpenAI
// call (lib/providers/llm.ts) and there are no placeholder results when the model can't be called.
import type OpenAI from "openai";
import { meteredCall, openaiClient, type LlmMeter } from "@/lib/providers/llm";
import { countMentionsAny } from "../mentions";
import type { TrackedBrand, TrackedCompetitor } from "../tracking/types";
import { ANALYSIS_MODEL } from "./pricing";
import type { CustomerVoice } from "./customers";
import type { BrandInAnswer, BrandResponse, Claim, CustomerGapItem, GapStatus, GapTone, PerceptionSegment, PerceptionSummary, ResponseAnalysis, Sentiment } from "./types";

export { ANALYSIS_MODEL };

const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"];
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sentimentOf = (v: unknown): Sentiment => (SENTIMENTS.includes(v as Sentiment) ? (v as Sentiment) : "neutral");
const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function brandTerms(brand: TrackedBrand): string[] {
  return [brand.name, ...brand.aliases].map((t) => t.trim()).filter((t) => t.length > 1);
}

/** One metered JSON-mode completion with the analysis model. */
async function chat(
  meter: LlmMeter,
  operation: string,
  expected: { input: number; output: number },
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model">,
): Promise<{ completion: OpenAI.Chat.ChatCompletion; costUsd: number }> {
  const out = await meteredCall(meter, "openai", operation, ANALYSIS_MODEL, expected, async () => {
    const completion = await openaiClient().chat.completions.create({ ...params, model: ANALYSIS_MODEL, stream: false });
    return {
      result: completion,
      model: completion.model,
      usage: {
        input: completion.usage?.prompt_tokens ?? 0,
        output: completion.usage?.completion_tokens ?? 0,
        cachedInput: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
    };
  });
  return { completion: out.result, costUsd: out.costUsd ?? 0 };
}

/**
 * Reads one AI answer and returns: is the brand mentioned (and where, and how favourably), every brand in it with
 * the attributes it's praised or criticised for, and the specific claims made about the tracked brand.
 */
export async function analyzeResponse(
  meter: LlmMeter,
  response: Pick<BrandResponse, "text" | "sources">,
  prompt: string,
  brand: TrackedBrand,
  competitors: TrackedCompetitor[],
  attributes: string[]
): Promise<{ analysis: ResponseAnalysis; costUsd: number }> {
  const sources = response.sources.slice(0, 15).map((s, i) => `[${i}] ${s.domain} - ${s.title}`).join("\n");
  const { completion, costUsd } = await chat(meter, "brand-analysis", { input: 5000, output: 800 }, {
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You analyse how an AI assistant's answer talks about brands. Be literal: only report what the answer actually says.",
          `Tracked brand: "${brand.name}"${brand.aliases.length ? ` (also: ${brand.aliases.join(", ")})` : ""}${brand.website ? `, website ${brand.website}` : ""}.`,
          competitors.length ? `Known competitors: ${competitors.map((c) => c.name).join(", ")}.` : "",
          `Attribute names already in use (reuse one when it fits, otherwise create a short Title Case name of 1-3 words): ${attributes.length ? attributes.join(", ") : "(none yet)"}.`,
          "Return ONLY JSON:",
          '{"brandMentioned": boolean, "brandPosition": number|null, "brandSentiment": number|null,',
          ' "brands": [{"name": string, "position": number, "sentiment": number, "isTarget": boolean, "attributes": [{"attribute": string, "sentiment": "positive"|"neutral"|"negative"}]}],',
          ' "claims": [{"claim": string, "detail": string, "sentiment": "positive"|"neutral"|"negative", "attribute": string, "kind": "fact"|"opinion", "sourceIndex": number|null}]}',
          "Rules: brands = every company/brand/product named as an option (max 10), position = order of first mention (1 = first);",
          "sentiment is 0-100 (50 neutral) for how favourably the answer presents that brand; brandSentiment is the tracked brand's (null if not mentioned);",
          "claims are only about the tracked brand (max 8): claim is a short label (max 8 words, lower case), detail one sentence;",
          "kind 'fact' for checkable statements (numbers, capacity, prices, awards, locations, what it offers), 'opinion' for judgements;",
          "sourceIndex is the index of the listed source the answer relies on for that claim, if any.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      { role: "user", content: `Question asked: ${prompt}\n\nAnswer:\n${response.text.slice(0, 12000)}\n\nSources:\n${sources || "(none)"}` },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  const brands: BrandInAnswer[] = (Array.isArray(raw.brands) ? raw.brands : [])
    .slice(0, 10)
    .map((b, i): BrandInAnswer => {
      const o = (b ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name, 80),
        position: num(o.position) ?? i + 1,
        sentiment: clamp100(num(o.sentiment) ?? 50),
        isTarget: o.isTarget === true,
        attributes: (Array.isArray(o.attributes) ? o.attributes : [])
          .slice(0, 8)
          .map((a) => ({ attribute: str((a as Record<string, unknown>)?.attribute, 40), sentiment: sentimentOf((a as Record<string, unknown>)?.sentiment) }))
          .filter((a) => a.attribute),
      };
    })
    .filter((b, i, all) => b.name && all.findIndex((x) => x.name.toLowerCase() === b.name.toLowerCase()) === i);
  const claims: Claim[] = (Array.isArray(raw.claims) ? raw.claims : [])
    .slice(0, 8)
    .map((c): Claim => {
      const o = (c ?? {}) as Record<string, unknown>;
      const idx = num(o.sourceIndex);
      return {
        claim: str(o.claim, 120),
        detail: str(o.detail, 400),
        sentiment: sentimentOf(o.sentiment),
        attribute: str(o.attribute, 40) || "General",
        kind: o.kind === "fact" ? "fact" : "opinion",
        sourceIndex: idx !== null && idx >= 0 && idx < response.sources.length ? idx : null,
      };
    })
    .filter((c) => c.claim);
  // Trust a literal name match over the model when they disagree on whether the brand appears at all.
  const literal = countMentionsAny(response.text, brandTerms(brand)) > 0;
  const mentioned = raw.brandMentioned === true || literal;
  const target = brands.find((b) => b.isTarget);
  return {
    analysis: {
      brandMentioned: mentioned,
      brandPosition: mentioned ? num(raw.brandPosition) ?? target?.position ?? null : null,
      brandSentiment: mentioned ? clamp100(num(raw.brandSentiment) ?? target?.sentiment ?? 50) : null,
      brands,
      claims: mentioned ? claims : [],
    },
    costUsd,
  };
}

/**
 * A two-paragraph read of how the AI answers portray the brand (strengths, then weaknesses), with the key
 * phrases tagged so the dashboard can underline them in green and red.
 */
export async function summarizePerception(
  meter: LlmMeter,
  brand: TrackedBrand,
  claims: Array<Claim & { platform: string }>,
  platformLabel: string
): Promise<{ summary: PerceptionSummary; costUsd: number }> {
  const generatedAt = new Date().toISOString();
  if (claims.length === 0) {
    return { summary: { paragraphs: [[{ text: `No answers on ${platformLabel} mentioned ${brand.name || "the brand"} yet.`, tone: null }]], generatedAt }, costUsd: 0 };
  }
  const listing = claims
    .slice(0, 80)
    .map((c) => `- (${c.sentiment}, ${c.attribute}) ${c.claim}: ${c.detail}`)
    .join("\n");
  const { completion, costUsd } = await chat(meter, "brand-summary", { input: 3000, output: 500 }, {
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          `Write how ${platformLabel} perceives the brand "${brand.name}", based only on the claims listed.`,
          "Two short paragraphs (2-3 sentences each): first what it is praised for, then the criticisms or doubts. Plain, specific, no hype.",
          "Return ONLY JSON: {\"paragraphs\": [[{\"text\": string, \"tone\": \"strength\"|\"weakness\"|null}]]} where each paragraph is a list of",
          "consecutive segments that together form the paragraph's sentences; mark the key phrases (3-8 words each) as strength or weakness, everything else null.",
        ].join(" "),
      },
      { role: "user", content: listing },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { paragraphs?: unknown };
  const paragraphs: PerceptionSegment[][] = (Array.isArray(raw.paragraphs) ? raw.paragraphs : [])
    .slice(0, 3)
    .map((p) =>
      (Array.isArray(p) ? p : [])
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          const tone: PerceptionSegment["tone"] = o.tone === "strength" || o.tone === "weakness" ? o.tone : null;
          return { text: typeof o.text === "string" ? o.text : "", tone };
        })
        .filter((s) => s.text)
    )
    .filter((p) => p.length);
  return { summary: { paragraphs, generatedAt }, costUsd };
}

export interface SuggestedPrompt {
  text: string;
  topic: string;
}

/** What the brand's review listings say about it, to ground suggestions in its real category, location and audience. */
export interface SuggestContext {
  listings: string[];
  praised: string[];
  criticised: string[];
  travellers: string[];
}

/** Whether suggested prompts name the brand: a mix, always ("branded") or never ("unbranded"). */
export type BrandMode = "mix" | "branded" | "unbranded";

/** The decision-making intents suggestions are grouped by. */
export const SUGGEST_TOPICS = ["Comparisons", "Worth it?", "Reviews", "Best for", "Right fit", "Who it suits"] as const;

/**
 * Questions that don't help anyone choose: price lists, nearby activities, directions, opening hours. "Is it worth
 * the price" is a decision question and stays.
 */
const NOT_DECISION =
  /\b(price range|how much (does|is|are|do)|what (is|are) the (price|cost|rates?)|cheapest (price|rate)|prices? (list|per night)|things to do|activities (near|around|in)|what to do|attractions? (near|around)|nearby|near(by)? (restaurants|attractions)|how (to|do i) get (to|there)|directions|opening hours|check-?in time|phone number|address of)\b/i;

export function isDecisionPrompt(text: string): boolean {
  return !NOT_DECISION.test(text);
}

export async function suggestPrompts(
  meter: LlmMeter,
  brand: TrackedBrand,
  competitors: TrackedCompetitor[],
  keywords: string[],
  existing: string[],
  count: number,
  locale: string,
  context?: SuggestContext,
  brandMode: BrandMode = "mix"
): Promise<{ prompts: SuggestedPrompt[]; costUsd: number }> {
  const terms = brandTerms(brand);
  const namesBrand = (text: string) => terms.length > 0 && countMentionsAny(text, terms) > 0;
  const fitsMode = (text: string) => brandMode === "mix" || (brandMode === "branded" ? namesBrand(text) : !namesBrand(text));
  const brandRule =
    brandMode === "branded"
      ? `Every question must name "${brand.name}" (Comparisons, Worth it?, Reviews and Who it suits, plus Best for / Right fit questions asked about the brand, e.g. "Is ${brand.name} a good choice for ...?").`
      : brandMode === "unbranded"
        ? `No question may mention "${brand.name}"${terms.length > 1 ? ` or ${terms.filter((t) => t !== brand.name).map((t) => `"${t}"`).join(", ")}` : ""}: write category and need questions where the brand should come up on its own merits - mostly Best for and Right fit, plus Comparisons and Worth it? questions about the category or named competitors (e.g. "Is a luxury cruise worth it for a family of four?").`
        : "About half should name the brand (Comparisons, Worth it?, Reviews, Who it suits) and half should be unbranded category questions where the brand should appear (Best for, Right fit).";
  const { completion, costUsd } = await chat(meter, "brand-suggest", { input: 2000, output: 1500 }, {
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          `Suggest ${count + (brandMode === "mix" ? 6 : 10)} questions people type into ChatGPT, Claude or Google AI Mode while DECIDING whether to choose "${brand.name}"${brand.website ? ` (${brand.website})` : ""} or one of its alternatives.`,
          "First work out from the context what kind of business it is (e.g. luxury hotel, resort, cruise, restaurant, tour) and where it is; use that category and location in the questions.",
          "Every question must be consultative or comparative and help someone make a choice. Use these intents, as the topic of each question:",
          '"Comparisons" - the brand against a named competitor or two ("X vs Y: which is better for a honeymoon?");',
          '"Worth it?" - value and quality judgements ("Is X worth the price for a family of four?", "pros and cons of X");',
          '"Reviews" - what guests say ("X reviews: what do guests say about the service?");',
          '"Best for" - shortlists by purpose and place ("best [category] for [purpose] in [location]", e.g. best luxury hotels for a honeymoon in Da Nang);',
          '"Right fit" - which option suits a specific need ("which [category] in [location] is best for travellers with young kids / a wheelchair / remote work?");',
          '"Who it suits" - who the brand is best suited for ("Who is X best suited for?", "is X good for solo travellers?").',
          brandRule,
          "Use real purposes and needs from the context (traveller types, what customers praise or criticise). Use the competitors' names in comparisons.",
          "Do NOT write generic questions, price-range or 'how much does it cost' questions, lists of nearby activities or things to do, directions, opening hours or booking how-tos.",
          `Market/locale: ${locale}. Write in the language customers in that market would use. Each question natural and specific (6-18 words).`,
          `Return ONLY JSON: {"prompts": [{"text": string, "topic": one of ${SUGGEST_TOPICS.map((t) => `"${t}"`).join(", ")}}]}.`,
        ].join(" "),
      },
      {
        role: "user",
        content:
          [
            competitors.length ? `Competitors: ${competitors.map((c) => c.name).join(", ")}` : "",
            keywords.length ? `Keywords they track on Google: ${keywords.slice(0, 40).join(", ")}` : "",
            context?.listings.length ? `The brand's review listings: ${context.listings.join(" | ")}` : "",
            context?.travellers.length ? `Who reviews it most (trip types): ${context.travellers.join(", ")}` : "",
            context?.praised.length ? `What customers praise: ${context.praised.join(", ")}` : "",
            context?.criticised.length ? `What customers criticise: ${context.criticised.join(", ")}` : "",
            existing.length ? `Already tracked (don't repeat): ${existing.slice(0, 80).join(" | ")}` : "",
          ]
            .filter(Boolean)
            .join("\n") || "(no other context)",
      },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { prompts?: unknown };
  const taken = new Set(existing.map((e) => e.trim().toLowerCase()));
  const prompts = (Array.isArray(raw.prompts) ? raw.prompts : [])
    .map((p) => {
      const topic = str((p as Record<string, unknown>)?.topic, 40);
      return { text: str((p as Record<string, unknown>)?.text, 300), topic: (SUGGEST_TOPICS as readonly string[]).includes(topic) ? topic : topic || "Comparisons" };
    })
    .filter((p) => p.text.length > 5 && isDecisionPrompt(p.text) && fitsMode(p.text) && !taken.has(p.text.toLowerCase()))
    .slice(0, count);
  return { prompts, costUsd };
}

// --- AI answers vs customer reviews ------------------------------------------------------------------------

/** What AI answers say about the brand, grouped by attribute, as input for the comparison. */
export interface AiClaimGroup {
  attribute: string;
  positive: number;
  negative: number;
  neutral: number;
  examples: string[];
}

const GAP_STATUSES: GapStatus[] = ["aligned", "missing", "contradicts", "ai-only"];
const GAP_TONES: GapTone[] = ["positive", "negative", "mixed", "none"];

/** Compares what customers say in reviews with what AI answers say, topic by topic. */
export async function compareWithCustomers(
  meter: LlmMeter,
  brand: TrackedBrand,
  ai: AiClaimGroup[],
  voice: CustomerVoice
): Promise<{ summary: string; items: CustomerGapItem[]; costUsd: number }> {
  const customerLines = [
    `Reviews analysed: ${voice.totals.analysed} (average rating ${voice.totals.avgRating ?? "?"}/5)`,
    `Google Maps: ${voice.totals.reviews} reviews, ${voice.totals.positiveShare ?? "?"}% positive, ${voice.totals.negativeShare ?? "?"}% negative`,
    "Praised:",
    ...voice.praise.map((a) => `+ ${a.aspect} (${a.count} reviews, ${a.share}%): ${a.quotes.map((q) => `"${q}"`).join(" ")}`),
    "Criticised:",
    ...voice.criticism.map((a) => `- ${a.aspect} (${a.count} reviews, ${a.share}%): ${a.quotes.map((q) => `"${q}"`).join(" ")}`),
  ].filter(Boolean);
  const aiLines = ai.length
    ? ai.map((g) => `${g.attribute}: ${g.positive} positive, ${g.negative} negative, ${g.neutral} neutral claims. e.g. ${g.examples.map((e) => `"${e}"`).join(" ")}`)
    : ["(AI answers made no claims about the brand)"];
  const { completion, costUsd } = await chat(meter, "brand-customer-gap", { input: 4000, output: 1200 }, {
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          `You compare what AI answer engines (ChatGPT, Claude, Google AI Mode and AI Overviews) say about "${brand.name}" with what its customers say in their Google Maps reviews.`,
          "Return the 6-10 topics that matter most to people deciding whether to choose this brand. For each topic:",
          '"topic" (1-3 words, Title Case); "customers" and "ai": how each side treats it - "positive", "negative", "mixed", or "none" when that side doesn\'t raise it;',
          '"status": "aligned" (both agree), "missing" (customers raise it, AI answers don\'t), "contradicts" (they disagree), or "ai-only" (AI claims it, customers don\'t raise it);',
          '"note": one sentence (max 25 words) with the evidence and what it means for the brand.',
          "Prioritise strengths customers love that AI misses, and AI claims customers contradict. Only use the evidence given.",
          'Also "summary": two sentences on how well AI answers reflect the real customer experience.',
          'Return ONLY JSON: {"summary": string, "items": [{"topic": string, "customers": string, "ai": string, "status": string, "note": string}]}.',
        ].join(" "),
      },
      { role: "user", content: `WHAT CUSTOMERS SAY\n${customerLines.join("\n")}\n\nWHAT AI ANSWERS SAY\n${aiLines.join("\n")}` },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { summary?: unknown; items?: unknown };
  const items: CustomerGapItem[] = (Array.isArray(raw.items) ? raw.items : [])
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({
      topic: str(x.topic, 60),
      customers: GAP_TONES.includes(x.customers as GapTone) ? (x.customers as GapTone) : "none",
      ai: GAP_TONES.includes(x.ai as GapTone) ? (x.ai as GapTone) : "none",
      status: GAP_STATUSES.includes(x.status as GapStatus) ? (x.status as GapStatus) : "aligned",
      note: str(x.note, 240),
    }))
    .filter((x) => x.topic)
    .slice(0, 12);
  return { summary: str(raw.summary, 600), items, costUsd };
}
