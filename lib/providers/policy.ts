// Who may spend what, where. Paid provider calls go through these rules and the atomic allowances in
// ledger.ts; nothing here is a global "allow everything" switch.
//
// Preview (VERCEL_ENV=preview):
// - SerpApi: only for the one project named in PREVIEW_SERPAPI_TEST_PROJECT_ID, and at most
//   PREVIEW_SERPAPI_TEST_MAX_REQUESTS requests in total (never more than 5), counting pagination and
//   retries. The allowance is created once and never refills. Every other project: refused.
// - OpenAI, Anthropic, DataForSEO: refused (paid calls stay off), unless the existing, broader
//   ALLOW_PREVIEW_EXTERNAL_WRITES switch is on — which this setup doesn't use.
// - Asana writes, Indexing submissions and publishing are unaffected: they keep their own Preview block.
// Production and local development:
// - SerpApi: a per-project monthly cap (AI_AREA_SERPAPI_MONTHLY_CAP, default 500 requests).
// - Model calls: a per-account daily cap in USD (AI_AREA_DAILY_USD_LIMIT, default $5), checked against
//   the estimated cost before each call.

import { deploymentOf, externalWritesAllowed } from "@/lib/environment";

type Env = Record<string, string | undefined>;

export const PREVIEW_SERPAPI_HARD_MAX = 5;

export interface PreviewSerpTest {
  projectId: number | null;
  max: number;
}

export function previewSerpTest(env: Env = process.env): PreviewSerpTest {
  const id = Number(env.PREVIEW_SERPAPI_TEST_PROJECT_ID);
  const requested = Number(env.PREVIEW_SERPAPI_TEST_MAX_REQUESTS ?? PREVIEW_SERPAPI_HARD_MAX);
  return {
    projectId: Number.isSafeInteger(id) && id > 0 ? id : null,
    max: Math.max(0, Math.min(PREVIEW_SERPAPI_HARD_MAX, Number.isFinite(requested) ? Math.floor(requested) : PREVIEW_SERPAPI_HARD_MAX)),
  };
}

export type Decision = { allowed: true; allowanceKey: string; max: number; note: string; scope: string } | { allowed: false; reason: string };

const month = (now: Date) => now.toISOString().slice(0, 7);
const day = (now: Date) => now.toISOString().slice(0, 10);

export function serpDecision(projectId: number, env: Env = process.env, now = new Date()): Decision {
  if (deploymentOf(env) === "preview") {
    const test = previewSerpTest(env);
    if (test.projectId !== projectId) {
      return { allowed: false, reason: "SerpApi calls are switched off on Preview, except for the one project set up for the SerpApi smoke test." };
    }
    if (test.max <= 0) return { allowed: false, reason: "The Preview SerpApi smoke test has no requests allowed." };
    return {
      allowed: true,
      allowanceKey: `preview-serpapi-test:project:${projectId}`,
      max: test.max,
      note: "Preview SerpApi smoke test",
      scope: `Preview smoke test: at most ${test.max} SerpApi requests in total for this project`,
    };
  }
  const cap = Number(env.AI_AREA_SERPAPI_MONTHLY_CAP ?? 500);
  return {
    allowed: true,
    allowanceKey: `serpapi-month:project:${projectId}:${month(now)}`,
    max: Number.isFinite(cap) && cap >= 0 ? cap : 500,
    note: "Monthly SerpApi cap for this project",
    scope: `Monthly cap: ${Number.isFinite(cap) ? cap : 500} SerpApi requests for this project in ${month(now)}`,
  };
}

export function llmDecision(userId: number, env: Env = process.env, now = new Date()): Decision {
  if (deploymentOf(env) === "preview" && !externalWritesAllowed(env)) {
    return { allowed: false, reason: "Paid model calls (OpenAI, Anthropic) are switched off on Preview." };
  }
  const cap = Number(env.AI_AREA_DAILY_USD_LIMIT ?? 5);
  const max = Number.isFinite(cap) && cap >= 0 ? cap : 5;
  return {
    allowed: true,
    allowanceKey: `llm-usd:user:${userId}:${day(now)}`,
    max,
    note: "Daily AI spending limit",
    scope: `Daily limit: $${max.toFixed(2)} of estimated model spend for this account (UTC day)`,
  };
}
