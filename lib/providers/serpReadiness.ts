// SerpApi readiness for one project, before anything is sent: which credential would be used and whether it was
// verified, whether this deployment's policy and the limits allow a search now, and how the last attempt ended.
// Reads local records only (credential rows, allowances, the usage ledger); never calls SerpApi.
//
// The states keep three questions apart:
// - credential: missing / saved, and verified / invalid / not verified (a free account.json check, run from
//   Account → API credentials) — saving is not verifying;
// - execution: allowed, or blocked with a code, a reason and a remedy (Preview policy, wrong test project,
//   allowance or budget exhausted, no key);
// - last attempt: ok, empty result, invalid key, out of searches, rate-limited, timeout, network failure or another
//   provider error — from the ledger row of the most recent request for this project.

import { db } from "@/lib/db";
import { deploymentOf } from "@/lib/environment";
import { credentialStatuses } from "@/lib/credentials/store";
import { resolveCredential, type CredentialSource } from "@/lib/credentials/resolve";
import { allowanceStatuses, tightest, type LimitLine } from "./ledger";
import { allowanceKeys, previewSerpTest, serpDecision, type RefusalCode } from "./policy";

export type ExecutionCode = "ok" | "no-key" | RefusalCode | "preview-allowance-exhausted" | "limit-reached";
export type AttemptCode = "ok" | "invalid-key" | "out-of-searches" | "rate-limited" | "timeout" | "network" | "refused" | "provider-error";

export interface SerpReadiness {
  deployment: "production" | "preview" | "development";
  credential: {
    state: "missing" | "saved";
    source: CredentialSource | null;
    /** Only account credentials are verified (Account → API credentials → Verify). */
    verification: "verified" | "invalid" | "not-verified";
    verifiedAt: number | null;
    message: string | null;
  };
  execution: { allowed: boolean; code: ExecutionCode; reason: string | null; remedy: string | null };
  limits: LimitLine[];
  /** Preview only: the cumulative smoke-test allowance for this project, if it's the test project. */
  previewAllowance: { used: number; max: number } | null;
  lastAttempt: { at: number; code: AttemptCode; message: string | null; operation: string } | null;
}

export function classifyAttempt(status: string, error: string | null): AttemptCode {
  if (status === "ok") return "ok";
  const e = (error ?? "").toLowerCase();
  if (/rejected the api key|invalid api key|http 401/.test(e)) return "invalid-key";
  if (/no searches left|run out of searches/.test(e)) return "out-of-searches";
  if (/rate-limiting|http 429/.test(e)) return "rate-limited";
  if (/didn't answer in time|timeout/.test(e)) return "timeout";
  if (/fetch failed|econn|enotfound|network|socket/.test(e)) return "network";
  if (/refused|switched off|limit/.test(e)) return "refused";
  return "provider-error";
}

const REMEDY: Partial<Record<ExecutionCode, string>> = {
  "no-key": "Add a SerpApi key in Account → API credentials.",
  "preview-no-test-project": "Set PREVIEW_SERPAPI_TEST_PROJECT_ID (Preview only) to the smoke-test project's id and redeploy.",
  "preview-other-project": "On Preview only the smoke-test project may search. Use that project, or test on Production.",
  "preview-no-allowance": "The Preview smoke test is configured with no requests (PREVIEW_SERPAPI_TEST_MAX_REQUESTS).",
  "preview-allowance-exhausted": "The cumulative Preview smoke-test allowance is used up and never refills. Verify further on Production.",
  "limit-reached": "Raise the limit in Account → Budgets & limits, or wait for next month.",
};

export async function serpReadiness(userId: number, projectId: number, env: Record<string, string | undefined> = process.env): Promise<SerpReadiness> {
  const deployment = deploymentOf(env);
  const resolved = await resolveCredential(userId, "serpapi", projectId, env);
  const statuses = await credentialStatuses(userId).catch(() => []);
  const account = statuses.find((s) => s.provider === "serpapi");
  const credential: SerpReadiness["credential"] = !resolved
    ? { state: "missing", source: null, verification: "not-verified", verifiedAt: null, message: null }
    : resolved.source === "account"
      ? {
          state: "saved",
          source: "account",
          verification: account?.verifyStatus === "ok" ? "verified" : account?.verifyStatus === "failed" ? "invalid" : "not-verified",
          verifiedAt: account?.verifiedAt ?? null,
          message: account?.verifyMessage ?? null,
        }
      : { state: "saved", source: resolved.source, verification: "not-verified", verifiedAt: null, message: null };

  const decision = await serpDecision(userId, projectId, env);
  let limits: LimitLine[] = [];
  let execution: SerpReadiness["execution"];
  if (!decision.allowed) {
    const code: ExecutionCode = decision.code ?? "limit-reached";
    execution = { allowed: false, code, reason: decision.reason, remedy: REMEDY[code] ?? null };
  } else {
    limits = await allowanceStatuses(decision.allowances);
    const tight = tightest(limits);
    const exhausted = tight && tight.left <= 0;
    const previewLine = decision.allowances.find((a) => a.key === allowanceKeys.previewSerpTotal());
    const code: ExecutionCode = !resolved ? "no-key" : exhausted ? (previewLine && tight?.label === previewLine.label ? "preview-allowance-exhausted" : "limit-reached") : "ok";
    execution = {
      allowed: code === "ok",
      code,
      reason: code === "ok" ? null : code === "no-key" ? "No SerpApi key applies to this project." : `Limit reached: ${tight!.label}.`,
      remedy: REMEDY[code] ?? null,
    };
  }

  let previewAllowance: SerpReadiness["previewAllowance"] = null;
  if (deployment === "preview" && previewSerpTest(env).projectId === projectId) {
    const r = (await db.prepare("SELECT used_units, max_units FROM provider_allowances WHERE key = ?").get(allowanceKeys.previewSerpTotal())) as
      | { used_units: number; max_units: number }
      | undefined;
    previewAllowance = { used: Number(r?.used_units ?? 0), max: Number(r?.max_units ?? previewSerpTest(env).max) };
  }

  const last = (await db
    .prepare("SELECT operation, status, error, COALESCE(completed_at, created_at) AS at FROM provider_usage WHERE provider = 'serpapi' AND user_id = ? AND project_id = ? ORDER BY id DESC LIMIT 1")
    .get(userId, projectId)) as { operation: string; status: string; error: string | null; at: number } | undefined;

  return {
    deployment,
    credential,
    execution,
    limits,
    previewAllowance,
    lastAttempt: last ? { at: Number(last.at), code: classifyAttempt(last.status, last.error), message: last.error, operation: last.operation } : null,
  };
}
