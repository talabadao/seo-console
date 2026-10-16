// Brand Mentions cost projection and limits, adapted from the AI Brand Mention app. Spend figures come from the
// SEO Console ledger (estimated from recorded token usage, with the pricing version), and the limits are the
// ledger allowances: the account's daily model-spend limit and the project's SerpApi cap.
import { allowanceState, dailyModelSpend, type DaySpend } from "@/lib/providers/ledger";
import { llmDecision, serpDecision } from "@/lib/providers/policy";
import { PRICING_VERSION } from "@/lib/providers/pricing";
import { ANALYSIS_MODEL, CHATGPT_MODELS, CLAUDE_MODELS, SERP_CREDITS, analysisCost, typicalAnswerCost } from "./pricing";
import { platformUnavailable } from "./providers";
import { listCycles, readCycle } from "./store";
import { PLATFORMS, type BrandSettings, type Platform } from "./types";

export type { DaySpend };

export interface CostReport {
  promptCount: number;
  platforms: Platform[];
  perRun: { chatgpt: number; claude: number; analysis: number; total: number; serpCredits: number };
  basis: { chatgpt: "observed" | "estimate"; claude: "observed" | "estimate" };
  /** Projected cost of one answer for each selectable model, for the model pickers. */
  models: Array<{ id: string; label: string; provider: "openai" | "anthropic"; note: string; perAnswer: number; perRun: number }>;
  today: DaySpend;
  /** The account's daily model-spend limit, or null when paid model calls are off here (Preview). */
  limit: number | null;
  llmPolicy: { allowed: boolean; scope: string };
  serp: { allowed: boolean; scope: string; used: number | null; max: number | null };
  recent: DaySpend[];
  /** How many runs today's remaining model budget covers. */
  runsLeftToday: number | null;
  /** Why each platform can't be asked right now, or null. */
  unavailable: Record<Platform, string | null>;
  pricingVersion: string;
}

/**
 * Projected cost per run from the active prompts and enabled platforms. Uses the average recorded cost per answer
 * from the latest finished cycle when it used the same model, otherwise typical token counts.
 */
export async function costReport(
  ctx: { userId: number; projectId: number; hasSerpKey: boolean },
  settings: BrandSettings,
  promptCount: number,
): Promise<CostReport> {
  const platforms = PLATFORMS.filter((p) => settings.platforms[p]);
  const last = [...(await listCycles(ctx.projectId))].reverse().find((c) => c.status === "done");
  const lastCycle = last ? await readCycle(ctx.projectId, last.id) : null;
  const analysis = analysisCost(ANALYSIS_MODEL);

  const observed = (platform: Platform, model: string): number | null => {
    const rows = (lastCycle?.responses ?? []).filter((r) => r.platform === platform && r.costUsd > 0 && r.model && (r.model === model || r.model.startsWith(model)));
    return rows.length >= 3 ? rows.reduce((s, r) => s + r.costUsd, 0) / rows.length : null;
  };
  const chatgptModel = CHATGPT_MODELS.find((m) => m.id === settings.chatgptModel) ?? CHATGPT_MODELS[0];
  const claudeModel = CLAUDE_MODELS.find((m) => m.id === settings.claudeModel) ?? CLAUDE_MODELS[0];
  const chatgptObserved = observed("chatgpt", chatgptModel.id);
  const claudeObserved = observed("claude", claudeModel.id);

  // Observed costs already include the analysis of that answer.
  const chatgpt = settings.platforms.chatgpt ? promptCount * (chatgptObserved ?? typicalAnswerCost(chatgptModel)) : 0;
  const claude = settings.platforms.claude ? promptCount * (claudeObserved ?? typicalAnswerCost(claudeModel)) : 0;
  const analysisTotal =
    promptCount * analysis * platforms.filter((p) => (p === "chatgpt" ? chatgptObserved === null : p === "claude" ? claudeObserved === null : true)).length;
  const total = chatgpt + claude + analysisTotal;
  const serpCredits = promptCount * platforms.reduce((s, p) => s + SERP_CREDITS[p], 0);

  const llm = llmDecision(ctx.userId);
  const serp = serpDecision(ctx.projectId);
  const recent = await dailyModelSpend(ctx.userId, 14);
  const today = recent.at(-1)!;
  const llmUsed = llm.allowed ? ((await allowanceState(llm.allowanceKey))?.used ?? 0) : 0;
  const serpState = serp.allowed ? await allowanceState(serp.allowanceKey) : null;
  const limit = llm.allowed ? llm.max : null;
  return {
    promptCount,
    platforms,
    perRun: { chatgpt, claude, analysis: analysisTotal, total, serpCredits },
    basis: { chatgpt: chatgptObserved !== null ? "observed" : "estimate", claude: claudeObserved !== null ? "observed" : "estimate" },
    models: [...CHATGPT_MODELS, ...CLAUDE_MODELS].map((m) => {
      const perAnswer = typicalAnswerCost(m) + analysis;
      return { id: m.id, label: m.label, provider: m.provider, note: m.note, perAnswer, perRun: perAnswer * promptCount };
    }),
    today,
    limit,
    llmPolicy: llm.allowed ? { allowed: true, scope: llm.scope } : { allowed: false, scope: llm.reason },
    serp: serp.allowed
      ? { allowed: true, scope: serp.scope, used: serpState?.used ?? 0, max: serpState?.max ?? serp.max }
      : { allowed: false, scope: serp.reason, used: null, max: null },
    recent,
    runsLeftToday: limit !== null && total > 0 ? Math.max(0, (limit - llmUsed) / total) : null,
    unavailable: Object.fromEntries(await Promise.all(PLATFORMS.map(async (p) => [p, await platformUnavailable(p, ctx)]))) as Record<Platform, string | null>,
    pricingVersion: PRICING_VERSION,
  };
}
