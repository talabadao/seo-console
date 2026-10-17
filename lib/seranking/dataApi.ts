// SE Ranking Data API (the backlink index behind Link Building → Backlinks). Unlike the Project API it spends API
// credits: SE Ranking's docs list /backlinks/summary at 100 credits; the donor's full profile is about
// LINK_PROFILE_CREDITS (≈750) per refresh. Failed (4xx/5xx) calls don't consume credits.
//
// - Entitlement: GET /v1/account/subscription costs 0 credits and returns the key's remaining units. A 401/403 there
//   means the key has no Data API access (Project API keys may not be accepted by the Data API).
// - Spending: never on Preview; on Production only within SERANKING_DATA_CREDITS_MONTH (account-wide credits per
//   UTC month, an atomic allowance), and only from an explicit "Refresh backlink profile" action. Each refresh is
//   recorded in the provider ledger (provider "seranking-data", units = credits estimated).

import { deploymentOf } from "@/lib/environment";
import { SeRankingError, num, seGet } from "./client";
import { LINK_PROFILE_CREDITS } from "./donor/types";
import type { Allowance } from "@/lib/providers/policy";

type Env = Record<string, string | undefined>;

export interface DataApiEntitlement {
  state: "available" | "no-access" | "insufficient" | "unknown" | "unconfigured";
  unitsLeft: number | null;
  message: string;
  checkedAt: number;
}

let cached: DataApiEntitlement | null = null;

/** The key's Data API units (free call), cached for 10 minutes per server instance. */
export async function dataApiEntitlement(force = false): Promise<DataApiEntitlement> {
  if (!process.env.SERANKING_API_KEY?.trim()) return { state: "unconfigured", unitsLeft: null, message: "No SE Ranking API key on the server.", checkedAt: Date.now() };
  if (!force && cached && Date.now() - cached.checkedAt < 600_000) return cached;
  try {
    const r = (await seGet("account/subscription")) as Record<string, unknown>;
    const sub = (r && typeof r === "object" && r.subscription_info && typeof r.subscription_info === "object" ? r.subscription_info : r) as Record<string, unknown>;
    const units = num(sub.units_left ?? sub.unitsLeft ?? r.units_left);
    cached =
      units == null
        ? { state: "unknown", unitsLeft: null, message: "SE Ranking answered but didn't report remaining Data API units.", checkedAt: Date.now() }
        : units < LINK_PROFILE_CREDITS
          ? { state: "insufficient", unitsLeft: units, message: `${units.toLocaleString("en-US")} Data API units left; a backlink profile refresh needs about ${LINK_PROFILE_CREDITS}.`, checkedAt: Date.now() }
          : { state: "available", unitsLeft: units, message: `${units.toLocaleString("en-US")} Data API units left.`, checkedAt: Date.now() };
  } catch (e) {
    const status = e instanceof SeRankingError ? e.status : 0;
    cached =
      status === 401 || status === 403 || status === 404
        ? { state: "no-access", unitsLeft: null, message: `The server's SE Ranking key has no Data API access (HTTP ${status}). Backlink profiles need a Data API subscription/credits.`, checkedAt: Date.now() }
        : { state: "unknown", unitsLeft: null, message: `Couldn't check Data API access: ${e instanceof Error ? e.message : String(e)}`, checkedAt: Date.now() };
  }
  return cached;
}

export type LinkProfileDecision = { allowed: true; allowances: Allowance[] } | { allowed: false; code: "preview" | "no-budget"; reason: string; remedy: string };

const month = (now: Date) => now.toISOString().slice(0, 7);

/** Whether this account may spend Data API credits on a backlink profile refresh. */
export function linkProfileDecision(userId: number, env: Env = process.env, now = new Date()): LinkProfileDecision {
  if (deploymentOf(env) === "preview") {
    return {
      allowed: false,
      code: "preview",
      reason: "Paid SE Ranking Data API calls (backlink profiles) are switched off on Preview.",
      remedy: "Saved profiles stay readable; refresh on Production within its credit budget.",
    };
  }
  const budget = Number(env.SERANKING_DATA_CREDITS_MONTH);
  if (!Number.isFinite(budget) || budget <= 0) {
    return {
      allowed: false,
      code: "no-budget",
      reason: "No SE Ranking Data API credit budget is set for this deployment.",
      remedy: "Set SERANKING_DATA_CREDITS_MONTH (credits per month across all projects) to allow explicit refreshes.",
    };
  }
  return {
    allowed: true,
    allowances: [
      {
        key: `seranking-data-month:user:${userId}:${month(now)}`,
        max: Math.floor(budget),
        note: "Monthly SE Ranking Data API credits",
        label: `${Math.floor(budget).toLocaleString("en-US")} SE Ranking Data API credits in ${month(now)}`,
        syncMax: true,
      },
    ],
  };
}
