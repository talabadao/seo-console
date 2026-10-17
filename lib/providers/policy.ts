// Who may spend what, where. Paid provider calls go through these rules and the atomic allowances in
// ledger.ts; nothing here is a global "allow everything" switch. Every applicable limit is enforced together:
// a request takes one unit (or its estimated cost) from each of its allowances, atomically per allowance, and
// gives back what it took if a later one is full — so concurrent requests and retries can't get past any of
// them (ledger.takeAllowances).
//
// Preview (VERCEL_ENV=preview):
// - SerpApi: only for the one project named in PREVIEW_SERPAPI_TEST_PROJECT_ID, and at most
//   PREVIEW_SERPAPI_TEST_MAX_REQUESTS requests in total (never more than 5), counting pagination and
//   retries. That allowance is created once and never refills, whatever the limits in Settings say; the
//   account and project limits apply on top. Every other project: refused.
// - OpenAI, Anthropic, DataForSEO: always refused. The broader ALLOW_PREVIEW_EXTERNAL_WRITES switch (Asana,
//   Indexing) deliberately doesn't open them, and saving a credential doesn't either.
// - Asana writes, Indexing submissions and publishing are unaffected: they keep their own Preview block.
// Everywhere, the limits come from Settings (lib/budgets.ts), falling back to the server defaults:
// - SerpApi: per-project requests per month (default AI_AREA_SERPAPI_MONTHLY_CAP or 500) and, if set, an
//   account-wide requests-per-month limit across all projects.
// - Model calls: account-wide estimated USD per day (default AI_AREA_DAILY_USD_LIMIT or $5) and, if set, a
//   project's estimated USD per month.

import { deploymentOf } from "@/lib/environment";
import { effectiveLimits } from "@/lib/budgets";

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

/** One allowance a request must fit into. `syncMax`: the period's maximum follows the current setting. */
export interface Allowance {
  key: string;
  max: number;
  note: string;
  label: string;
  syncMax: boolean;
}

/** Why a request is refused before anything is sent (shown with a remedy in the UI). */
export type RefusalCode = "preview-no-test-project" | "preview-other-project" | "preview-no-allowance" | "preview-model-blocked";
export type Decision = { allowed: true; allowances: Allowance[]; scope: string } | { allowed: false; reason: string; code?: RefusalCode };

const month = (now: Date) => now.toISOString().slice(0, 7);
const day = (now: Date) => now.toISOString().slice(0, 10);

export const allowanceKeys = {
  previewSerp: (projectId: number) => `preview-serpapi-test:project:${projectId}`,
  projectSerpMonth: (projectId: number, now: Date) => `serpapi-month:project:${projectId}:${month(now)}`,
  accountSerpMonth: (userId: number, now: Date) => `serpapi-month:user:${userId}:${month(now)}`,
  accountModelDay: (userId: number, now: Date) => `llm-usd:user:${userId}:${day(now)}`,
  projectModelMonth: (projectId: number, now: Date) => `llm-usd-month:project:${projectId}:${month(now)}`,
};

export async function serpDecision(userId: number, projectId: number, env: Env = process.env, now = new Date()): Promise<Decision> {
  const allowances: Allowance[] = [];
  if (deploymentOf(env) === "preview") {
    const test = previewSerpTest(env);
    if (test.projectId == null) {
      return {
        allowed: false,
        code: "preview-no-test-project",
        reason: "SerpApi calls are switched off on Preview: no smoke-test project is configured (PREVIEW_SERPAPI_TEST_PROJECT_ID is unset).",
      };
    }
    if (test.projectId !== projectId) {
      return {
        allowed: false,
        code: "preview-other-project",
        reason: "SerpApi calls are switched off on Preview, except for the one project set up for the SerpApi smoke test.",
      };
    }
    if (test.max <= 0) return { allowed: false, code: "preview-no-allowance", reason: "The Preview SerpApi smoke test has no requests allowed." };
    allowances.push({
      key: allowanceKeys.previewSerp(projectId),
      max: test.max,
      note: "Preview SerpApi smoke test",
      label: `Preview smoke test: at most ${test.max} SerpApi requests in total for this project`,
      syncMax: false,
    });
  }
  const limits = await effectiveLimits(userId, projectId, env);
  const project = limits.find((l) => l.scope === "project" && l.metric === "serpapi_requests_month");
  const account = limits.find((l) => l.scope === "account" && l.metric === "serpapi_requests_month");
  if (project?.value != null) {
    allowances.push({
      key: allowanceKeys.projectSerpMonth(projectId, now),
      max: project.value,
      note: "Monthly SerpApi limit for this project",
      label: `${project.value.toLocaleString("en-US")} SerpApi requests for this project in ${month(now)}`,
      syncMax: true,
    });
  }
  if (account?.value != null) {
    allowances.push({
      key: allowanceKeys.accountSerpMonth(userId, now),
      max: account.value,
      note: "Monthly SerpApi limit for all your projects",
      label: `${account.value.toLocaleString("en-US")} SerpApi requests across all your projects in ${month(now)}`,
      syncMax: true,
    });
  }
  return { allowed: true, allowances, scope: allowances.map((a) => a.label).join("; ") || "No SerpApi limit set" };
}

/**
 * The account-wide SerpApi limits only (for the account Usage & Costs view). Actual requests always go through
 * serpDecision, which adds the project's own limit and, on Preview, the smoke-test allowance.
 */
export async function accountSerpDecision(userId: number, env: Env = process.env, now = new Date()): Promise<Decision> {
  const limits = await effectiveLimits(userId, null, env);
  const account = limits.find((l) => l.scope === "account" && l.metric === "serpapi_requests_month");
  const allowances: Allowance[] =
    account?.value != null
      ? [
          {
            key: allowanceKeys.accountSerpMonth(userId, now),
            max: account.value,
            note: "Monthly SerpApi limit for all your projects",
            label: `${account.value.toLocaleString("en-US")} SerpApi requests across all your projects in ${month(now)}`,
            syncMax: true,
          },
        ]
      : [];
  const preview = deploymentOf(env) === "preview" ? " On Preview, SerpApi runs only for the smoke-test project, within its 5-request allowance." : "";
  return { allowed: true, allowances, scope: (allowances.map((a) => a.label).join("; ") || "No account-wide SerpApi limit set; each project has its own") + preview };
}

export async function llmDecision(userId: number, projectId: number | null = null, env: Env = process.env, now = new Date()): Promise<Decision> {
  if (deploymentOf(env) === "preview") {
    return { allowed: false, code: "preview-model-blocked", reason: "Paid model calls (OpenAI, Anthropic) are switched off on Preview." };
  }
  const limits = await effectiveLimits(userId, projectId, env);
  const allowances: Allowance[] = [];
  const daily = limits.find((l) => l.scope === "account" && l.metric === "model_usd_day");
  const monthly = limits.find((l) => l.scope === "project" && l.metric === "model_usd_month");
  if (daily?.value != null) {
    allowances.push({
      key: allowanceKeys.accountModelDay(userId, now),
      max: daily.value,
      note: "Daily AI spending limit",
      label: `$${daily.value.toFixed(2)} of estimated model spend per day for this account (UTC)`,
      syncMax: true,
    });
  }
  if (projectId != null && monthly?.value != null) {
    allowances.push({
      key: allowanceKeys.projectModelMonth(projectId, now),
      max: monthly.value,
      note: "Monthly AI spending limit for this project",
      label: `$${monthly.value.toFixed(2)} of estimated model spend for this project in ${month(now)}`,
      syncMax: true,
    });
  }
  return { allowed: true, allowances, scope: allowances.map((a) => a.label).join("; ") || "No model spending limit set" };
}
