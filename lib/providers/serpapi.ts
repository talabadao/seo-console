// SerpApi for the AI Area (Google Search Tracking, Brand Mentions' Google AI sources, Rank tracking).
//
// - The key comes from the shared credential resolver (lib/credentials/resolve.ts): a legacy project key until
//   it's resolved, else the signed-in account's encrypted SerpApi credential, else a server key only for
//   accounts explicitly allowed to use it. Keys stay on the server; there's no key rotation to get around an
//   exhausted quota — an exhausted key stops the run with SerpApi's message.
// - Every search passes serpDecision (policy.ts), takes one unit from each applicable allowance and is written to the
//   ledger before it's sent. Account balance checks (account.json) are free and aren't metered.
// - SerpApi doesn't charge for responses it serves from its own cache, but the app can't always tell which
//   those were, so it counts every request it makes. SerpApi's own figures are shown next to it.

import { resolveCredential, type CredentialSource } from "@/lib/credentials/resolve";
import { CapReached, completeUsage, keyFingerprint, reserveUsage, takeAllowances } from "./ledger";
import { serpDecision } from "./policy";

const SEARCH_URL = "https://serpapi.com/search.json";
const ACCOUNT_URL = "https://serpapi.com/account.json";

export type Json = Record<string, unknown>;

export class SerpRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerpRefused";
  }
}

export interface SerpKey {
  key: string;
  source: CredentialSource;
  fingerprint: string;
}

/** The SerpApi key this account uses for this project (or account-wide when projectId is null). */
export async function serpKey(userId: number, projectId: number | null): Promise<SerpKey | null> {
  const r = await resolveCredential(userId, "serpapi", projectId);
  return r ? { key: r.values.apiKey, source: r.source, fingerprint: keyFingerprint(r.values.apiKey) } : null;
}

export const NO_SERP_KEY = "No SerpApi key: add one in Settings → Account → API credentials.";

export interface SerpContext {
  userId: number;
  projectId: number;
  runId: string | null;
  key: SerpKey;
}

/**
 * One metered SerpApi search. Throws SerpRefused when policy or a cap stops it (nothing is sent), and
 * Error for SerpApi failures. "No results" comes back as an empty object, not an error.
 */
export async function serpSearch(params: Record<string, string>, ctx: SerpContext): Promise<Json> {
  const decision = await serpDecision(ctx.userId, ctx.projectId);
  if (!decision.allowed) throw new SerpRefused(decision.reason);
  try {
    await takeAllowances(decision.allowances, 1);
  } catch (e) {
    if (e instanceof CapReached) throw new SerpRefused(`${e.message} The run stopped before sending more requests.`);
    throw e;
  }
  const usageId = await reserveUsage({
    userId: ctx.userId,
    projectId: ctx.projectId,
    provider: "serpapi",
    operation: params.engine ?? "search",
    runId: ctx.runId,
    keyFingerprint: ctx.key.fingerprint,
    units: 1,
    unitType: "search",
  });
  try {
    const res = await fetch(`${SEARCH_URL}?${new URLSearchParams({ ...params, api_key: ctx.key.key })}`, {
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    const error = typeof body.error === "string" ? body.error : null;
    if (error && /hasn't returned any results/i.test(error)) {
      await completeUsage(usageId, { ok: true });
      return {};
    }
    if (!res.ok || error) {
      const message = /run out of searches|limit/i.test(error ?? "")
        ? "This SerpApi key has no searches left."
        : res.status === 401 || /invalid api key/i.test(error ?? "")
          ? "SerpApi rejected the API key."
          : `SerpApi ${params.engine ?? "search"}: ${error ?? `HTTP ${res.status}`}`;
      await completeUsage(usageId, { ok: false, error: message });
      throw new Error(message);
    }
    await completeUsage(usageId, { ok: true });
    return body;
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      await completeUsage(usageId, { ok: false, error: "SerpApi didn't answer in time" });
      throw new Error("SerpApi didn't answer in time.");
    }
    // Already completed above for SerpApi errors; this covers network failures.
    await completeUsage(usageId, { ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * Meters one SerpApi search made by another client (Maps reviews' own SerpApi client): the same policy, limits
 * and ledger as serpSearch. Throws SerpRefused (nothing to send) when a limit or policy stops it; otherwise
 * returns a function to call when the search has finished, ok or not.
 */
export async function meterSerpSearch(
  ctx: { userId: number; projectId: number; fingerprint: string },
  operation: string,
): Promise<(ok: boolean, error?: string) => Promise<void>> {
  const decision = await serpDecision(ctx.userId, ctx.projectId);
  if (!decision.allowed) throw new SerpRefused(decision.reason);
  try {
    await takeAllowances(decision.allowances, 1);
  } catch (e) {
    if (e instanceof CapReached) throw new SerpRefused(`${e.message} Change it in Settings → Account → Budgets & limits.`);
    throw e;
  }
  const usageId = await reserveUsage({
    userId: ctx.userId,
    projectId: ctx.projectId,
    provider: "serpapi",
    operation,
    keyFingerprint: ctx.fingerprint,
    units: 1,
    unitType: "search",
  });
  return (ok, error) => completeUsage(usageId, { ok, error });
}

export interface SerpAccount {
  fetchedAt: number;
  planId: string | null;
  planSearchesLeft: number | null;
  extraCreditsLeft: number | null;
  totalSearchesLeft: number | null;
  thisMonthUsage: number | null;
  searchesPerMonth: number | null;
  /** Which account: the same key (and so the same balance) may serve several projects. */
  keySource: CredentialSource;
  keyFingerprint: string;
}

const accountCache = new Map<string, SerpAccount>();

/** SerpApi's own account figures (free; not metered). Cached for 10 minutes per key. */
export async function serpAccount(key: SerpKey, refresh = false): Promise<SerpAccount> {
  const hit = accountCache.get(key.fingerprint);
  if (!refresh && hit && Date.now() - hit.fetchedAt < 600_000) return { ...hit, keySource: key.source };
  const res = await fetch(`${ACCOUNT_URL}?${new URLSearchParams({ api_key: key.key })}`, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const d = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || typeof d.error === "string") throw new Error(`SerpApi account: ${typeof d.error === "string" ? d.error : `HTTP ${res.status}`}`);
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  const account: SerpAccount = {
    fetchedAt: Date.now(),
    planId: typeof d.plan_id === "string" ? d.plan_id : null,
    planSearchesLeft: n(d.plan_searches_left),
    extraCreditsLeft: n(d.extra_credits),
    totalSearchesLeft: n(d.total_searches_left),
    thisMonthUsage: n(d.this_month_usage),
    searchesPerMonth: n(d.searches_per_month),
    keySource: key.source,
    keyFingerprint: key.fingerprint,
  };
  accountCache.set(key.fingerprint, account);
  return account;
}
