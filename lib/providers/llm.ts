// Metered OpenAI and Anthropic calls for the AI Area (Brand Mentions answers, their analysis, suggestions).
//
// Every call: llmDecision (Preview refuses all paid model calls) → the expected cost is taken from the
// account's daily allowance (atomic, so concurrent calls can't overshoot) → a ledger row is reserved → the
// call → the row is completed with real token counts and an estimated cost (with PRICING_VERSION), and the
// allowance is corrected from the expected to the estimated cost. A failed call keeps its reservation in the
// allowance: the provider may still have billed it. There are no mock answers: a refused or unconfigured
// provider throws LlmRefused, and callers show that state.

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { CapReached, adjustAllowance, completeUsage, keyFingerprint, reserveUsage, takeAllowance } from "./ledger";
import { llmDecision } from "./policy";
import { PRICING_VERSION, capCost, estimateCost } from "./pricing";

export type LlmProvider = "openai" | "anthropic";

export class LlmRefused extends Error {
  constructor(
    message: string,
    readonly reason: "policy" | "cap" | "not-configured",
  ) {
    super(message);
    this.name = "LlmRefused";
  }
}

export interface LlmMeter {
  userId: number;
  projectId: number | null;
  runId?: string | null;
}

export interface LlmUsage {
  input: number;
  output: number;
  cachedInput?: number;
  webSearches?: number;
}

const KEY_ENV: Record<LlmProvider, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

function apiKey(provider: LlmProvider): string | null {
  return process.env[KEY_ENV[provider]]?.trim() || null;
}

/** Why a provider can't be called right now, or null when it can (before caps). Used to show unavailable states. */
export function llmUnavailable(provider: LlmProvider, userId: number): string | null {
  const decision = llmDecision(userId);
  if (!decision.allowed) return decision.reason;
  if (!apiKey(provider)) return `${KEY_ENV[provider]} isn't configured on the server.`;
  return null;
}

export function openaiClient(): OpenAI {
  const key = apiKey("openai");
  if (!key) throw new LlmRefused("OPENAI_API_KEY isn't configured on the server.", "not-configured");
  return new OpenAI({ apiKey: key, maxRetries: 0, timeout: 120_000 });
}

export function anthropicClient(): Anthropic {
  const key = apiKey("anthropic");
  if (!key) throw new LlmRefused("ANTHROPIC_API_KEY isn't configured on the server.", "not-configured");
  // Retries are made explicitly (each one is a separate ledger row), never inside the SDK.
  return new Anthropic({ apiKey: key, maxRetries: 0, timeout: 120_000 });
}

/** A failed call that may still have cost something (e.g. a refusal after web searches). */
export class LlmCallError extends Error {
  constructor(
    message: string,
    readonly usage: LlmUsage | null,
    readonly model: string | null,
  ) {
    super(message);
    this.name = "LlmCallError";
  }
}

/**
 * Runs one metered model call. `expected` is the usage assumed before the call, for the cap check; `call`
 * returns its result with the real usage and the model that served it.
 */
export async function meteredCall<T>(
  meter: LlmMeter,
  provider: LlmProvider,
  operation: string,
  model: string,
  expected: LlmUsage,
  call: () => Promise<{ result: T; usage: LlmUsage; model?: string }>,
): Promise<{ result: T; costUsd: number | null; model: string }> {
  const decision = llmDecision(meter.userId);
  if (!decision.allowed) throw new LlmRefused(decision.reason, "policy");
  const key = apiKey(provider);
  if (!key) throw new LlmRefused(`${KEY_ENV[provider]} isn't configured on the server.`, "not-configured");

  const reserved = capCost(model, expected);
  try {
    await takeAllowance(decision.allowanceKey, reserved, decision.max, decision.note);
  } catch (e) {
    if (e instanceof CapReached) {
      throw new LlmRefused(`Daily AI spending limit reached ($${e.used.toFixed(2)} of $${e.max.toFixed(2)}, estimated). The rest can run tomorrow.`, "cap");
    }
    throw e;
  }
  const usageId = await reserveUsage({
    userId: meter.userId,
    projectId: meter.projectId,
    provider,
    operation,
    runId: meter.runId ?? null,
    keyFingerprint: keyFingerprint(key),
    units: 1,
    unitType: "tokens",
    model,
  });
  try {
    const out = await call();
    const served = out.model || model;
    const cost = estimateCost(served, out.usage);
    await completeUsage(usageId, {
      ok: true,
      inputTokens: out.usage.input,
      outputTokens: out.usage.output,
      estCostUsd: cost,
      pricingVersion: cost == null ? null : PRICING_VERSION,
      model: served,
    });
    // Unknown prices stay at the conservative cap cost in the allowance.
    await adjustAllowance(decision.allowanceKey, (cost ?? capCost(served, out.usage)) - reserved);
    return { result: out.result, costUsd: cost, model: served };
  } catch (e) {
    const usage = e instanceof LlmCallError ? e.usage : null;
    const served = (e instanceof LlmCallError && e.model) || model;
    const cost = usage ? estimateCost(served, usage) : null;
    await completeUsage(usageId, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      inputTokens: usage?.input,
      outputTokens: usage?.output,
      estCostUsd: cost,
      pricingVersion: cost == null ? null : PRICING_VERSION,
      model: served,
    });
    if (usage) await adjustAllowance(decision.allowanceKey, (cost ?? capCost(served, usage)) - reserved);
    throw e;
  }
}
