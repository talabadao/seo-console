// The four answer sources for Brand Mentions, adapted from the AI Brand Mention app. Google AI Mode and AI
// Overview go through the metered SerpApi client (passed in as `search`); ChatGPT and Claude go through
// meteredCall (lib/providers/llm.ts). There are no stand-in answers: an unavailable source says why.
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, LlmCallError, llmUnavailable, meteredCall, openaiClient, type LlmMeter } from "@/lib/providers/llm";
import { serpDecision } from "@/lib/providers/policy";
import { NO_SERP_KEY } from "@/lib/providers/serpapi";
import { extractDomain, flattenTextBlocks, mapReferences, type Search } from "../tracking/serpapi";
import type { TrackingSettings } from "../tracking/types";
import { CHATGPT_MODELS, CLAUDE_MODELS } from "./pricing";
import type { Platform, SourceLink } from "./types";

export interface Answer {
  present: boolean;
  text: string;
  sources: SourceLink[];
  model?: string;
  costUsd: number;
  serpCredits: number;
}

/** Why a platform can't be asked right now (policy, missing key), or null. Caps are checked per request. */
export async function platformUnavailable(platform: Platform, ctx: { userId: number; projectId: number; hasSerpKey: boolean }): Promise<string | null> {
  if (platform === "chatgpt") return llmUnavailable("openai", ctx.userId);
  if (platform === "claude") return llmUnavailable("anthropic", ctx.userId);
  const d = await serpDecision(ctx.userId, ctx.projectId);
  if (!d.allowed) return d.reason;
  return ctx.hasSerpKey ? null : NO_SERP_KEY;
}

function dedupeSources(list: SourceLink[], max = 20): SourceLink[] {
  const seen = new Set<string>();
  const out: SourceLink[] = [];
  for (const s of list) {
    const key = s.url.replace(/#.*$/, "").replace(/\/$/, "");
    if (!s.url || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const toLinks = (refs: ReturnType<typeof mapReferences>): SourceLink[] =>
  refs.map((r) => ({ title: r.title || r.source || r.domain, url: r.link, domain: r.domain }));

// --- Google (SerpApi) -------------------------------------------------------------------------------------

export async function askAiMode(prompt: string, settings: TrackingSettings, search: Search): Promise<Answer> {
  const data = (await search({ engine: "google_ai_mode", q: prompt, gl: settings.country, hl: settings.language })) as {
    text_blocks?: Parameters<typeof flattenTextBlocks>[0];
    references?: Parameters<typeof mapReferences>[0];
  };
  const text = flattenTextBlocks(data.text_blocks);
  return { present: text.length > 0, text, sources: dedupeSources(toLinks(mapReferences(data.references))), costUsd: 0, serpCredits: 1 };
}

/** Google search page 1; the AI Overview is either inline or behind a page_token redeemed with a second search. */
export async function askAiOverview(prompt: string, settings: TrackingSettings, search: Search): Promise<Answer> {
  const page = (await search({ engine: "google", q: prompt, gl: settings.country, hl: settings.language, device: settings.device })) as {
    ai_overview?: { text_blocks?: Parameters<typeof flattenTextBlocks>[0]; references?: Parameters<typeof mapReferences>[0]; page_token?: string };
  };
  let overview = page.ai_overview;
  let credits = 1;
  if (overview?.page_token && !overview.text_blocks?.length) {
    const full = (await search({ engine: "google_ai_overview", page_token: overview.page_token })) as { ai_overview?: typeof overview };
    overview = full.ai_overview;
    credits++;
  }
  const text = flattenTextBlocks(overview?.text_blocks);
  return { present: text.length > 0, text, sources: dedupeSources(toLinks(mapReferences(overview?.references))), costUsd: 0, serpCredits: credits };
}

// --- ChatGPT (OpenAI Responses API + web search) -------------------------------------------------------------

export async function askChatGpt(prompt: string, settings: TrackingSettings, model: string, meter: LlmMeter): Promise<Answer> {
  const typical = (CHATGPT_MODELS.find((m) => m.id === model) ?? CHATGPT_MODELS[0]).typical;
  const { result: response, costUsd, model: served } = await meteredCall(
    meter,
    "openai",
    "brand-answer",
    model,
    { input: typical.input, output: typical.output, webSearches: typical.searches },
    async (key) => {
      const r = await openaiClient(key).responses.create({
        model,
        input: prompt,
        tools: [{ type: "web_search", user_location: { type: "approximate", country: settings.country.toUpperCase() } }],
        reasoning: { effort: "low" },
      });
      const searches = r.output.filter((i) => i.type === "web_search_call").length;
      const u = r.usage;
      return {
        result: r,
        model: r.model ?? model,
        usage: { input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cachedInput: u?.input_tokens_details?.cached_tokens ?? 0, webSearches: searches },
      };
    },
  );
  const sources: SourceLink[] = [];
  for (const item of response.output) {
    if (item.type === "message") {
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations ?? []) {
          if (a.type === "url_citation") sources.push({ title: a.title || extractDomain(a.url), url: a.url, domain: extractDomain(a.url) });
        }
      }
    }
  }
  const text = response.output_text ?? "";
  // Strip the markdown link noise ChatGPT appends after cited sentences: ([site](url)).
  const clean = text.replace(/\s*\(\[[^\]]+\]\([^)]+\)\)/g, "").trim();
  return { present: clean.length > 0, text: clean, sources: dedupeSources(sources), model: served, costUsd: costUsd ?? 0, serpCredits: 0 };
}

// --- Claude (Messages API + web search) ------------------------------------------------------------------------

/** Models with server-side refusal fallback ("default" routing) and the dynamic-filtering web search tool. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
const NEW_SEARCH_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export async function askClaude(prompt: string, settings: TrackingSettings, model: string, meter: LlmMeter): Promise<Answer> {
  const typical = (CLAUDE_MODELS.find((m) => m.id === model) ?? CLAUDE_MODELS[0]).typical;
  const fallbacks = FALLBACK_MODELS.has(model);
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    NEW_SEARCH_MODELS.has(model)
      ? { type: "web_search_20260209", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: settings.country.toUpperCase() } }
      : { type: "web_search_20250305", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: settings.country.toUpperCase() } },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let costUsd = 0;
  let servedBy = model;
  let response: Anthropic.Beta.BetaMessage | null = null;
  // Server-side web search can pause after its internal loop; resume by sending the paused turn back. Each
  // request is metered (and counted) on its own.
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await meteredCall(
      meter,
      "anthropic",
      "brand-answer",
      model,
      { input: typical.input, output: typical.output, webSearches: typical.searches },
      async (key) => {
        const r = await anthropicClient(key).beta.messages.create({
          model,
          max_tokens: 4000,
          tools,
          output_config: { effort: "low" },
          messages,
          ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        });
        const u = r.usage;
        const usage = {
          input: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
          cachedInput: u.cache_read_input_tokens ?? 0,
          output: u.output_tokens,
          webSearches: u.server_tool_use?.web_search_requests ?? 0,
        };
        // A refusal is a failed answer that was still billed.
        if (r.stop_reason === "refusal") throw new LlmCallError("Claude declined to answer this prompt", usage, r.model || model);
        return { result: r, usage, model: r.model || model };
      },
    );
    response = out.result;
    servedBy = out.model;
    costUsd += out.costUsd ?? 0;
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  if (!response) throw new Error("Claude returned nothing");

  const parts: string[] = [];
  const cited: SourceLink[] = [];
  const searched: SourceLink[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      parts.push(block.text);
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location") cited.push({ title: c.title ?? extractDomain(c.url), url: c.url, domain: extractDomain(c.url) });
      }
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r.type === "web_search_result") searched.push({ title: r.title, url: r.url, domain: extractDomain(r.url) });
      }
    }
  }
  const text = parts.join("").trim();
  return {
    present: text.length > 0,
    text,
    sources: dedupeSources(cited.length ? cited : searched),
    model: servedBy,
    costUsd,
    serpCredits: 0,
  };
}

export const knownClaudeModel = (id: string) => CLAUDE_MODELS.some((m) => m.id === id);
