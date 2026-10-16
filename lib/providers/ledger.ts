// Provider usage ledger and caps (tables from migration 0003).
//
// Accounting rules:
// - Every metered request is recorded BEFORE it is sent (status "reserved") and completed after it
//   returns ("ok" / "error"). A request that fails after leaving the app still counts — SerpApi or a
//   model provider may have billed it. Retries and pagination are separate requests and separate rows.
// - Caps are allowances: a row with max_units and used_units, incremented atomically with
//   UPDATE ... WHERE used_units + n <= max_units. Two concurrent requests can't both take the last unit.
// - Units are per provider and never mixed: SerpApi "search", model "token" counts plus an estimated
//   USD cost with the pricing version that produced it.

import { createHash } from "node:crypto";
import { db, tableExists } from "@/lib/db";

export type Provider = "serpapi" | "openai" | "anthropic" | "dataforseo";

export class CapReached extends Error {
  constructor(
    readonly key: string,
    readonly used: number,
    readonly max: number,
    message: string,
  ) {
    super(message);
    this.name = "CapReached";
  }
}

export class LedgerUnavailable extends Error {
  constructor() {
    super("This database hasn't run migration 0003 (AI Area), so paid provider calls are switched off.");
    this.name = "LedgerUnavailable";
  }
}

/** A short, non-reversible fingerprint that groups usage by provider account without storing the key. */
export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

export async function ledgerAvailable(): Promise<boolean> {
  return tableExists("provider_usage");
}

/**
 * Takes `units` from an allowance, creating it with `max` the first time. Throws CapReached when it doesn't fit.
 * With `syncMax`, an existing allowance's maximum is updated to `max` first (a limit changed in Settings applies
 * to the current period); its used amount is never reset.
 */
export async function takeAllowance(key: string, units: number, max: number, note: string, syncMax = false): Promise<{ used: number; max: number }> {
  const now = Date.now();
  await db
    .prepare("INSERT INTO provider_allowances (key, max_units, used_units, note, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?) ON CONFLICT (key) DO NOTHING")
    .run(key, max, note, now, now);
  if (syncMax) await db.prepare("UPDATE provider_allowances SET max_units = ?, updated_at = ? WHERE key = ? AND max_units <> ?").run(max, now, key, max);
  const row = (await db
    .prepare("UPDATE provider_allowances SET used_units = used_units + ?, updated_at = ? WHERE key = ? AND used_units + ? <= max_units RETURNING used_units, max_units")
    .get(units, now, key, units)) as { used_units: number; max_units: number } | undefined;
  if (row) return { used: Number(row.used_units), max: Number(row.max_units) };
  const current = (await db.prepare("SELECT used_units, max_units FROM provider_allowances WHERE key = ?").get(key)) as
    | { used_units: number; max_units: number }
    | undefined;
  const used = Number(current?.used_units ?? max);
  const cap = Number(current?.max_units ?? max);
  throw new CapReached(key, used, cap, `${note}: ${used} of ${cap} used.`);
}

/**
 * Takes `units` from every allowance in order. If one is full, what was already taken from the earlier ones is
 * given back and its CapReached is thrown — so all limits hold together, even under concurrent requests.
 */
export async function takeAllowances(allowances: Array<{ key: string; max: number; note: string; syncMax: boolean }>, units: number): Promise<void> {
  const taken: string[] = [];
  try {
    for (const a of allowances) {
      await takeAllowance(a.key, units, a.max, a.note, a.syncMax);
      taken.push(a.key);
    }
  } catch (e) {
    for (const key of taken) await adjustAllowance(key, -units);
    throw e;
  }
}

/** Applies the same correction to several allowances (e.g. expected → estimated model cost). */
export async function adjustAllowances(keys: string[], delta: number): Promise<void> {
  for (const key of keys) await adjustAllowance(key, delta);
}

export interface LimitLine {
  label: string;
  used: number;
  max: number;
  left: number;
}

/** Used / left for each allowance (a period not started yet counts as 0 used). */
export async function allowanceStatuses(allowances: Array<{ key: string; max: number; label: string }>): Promise<LimitLine[]> {
  const out: LimitLine[] = [];
  for (const a of allowances) {
    const st = await allowanceState(a.key);
    const used = st?.used ?? 0;
    const max = a.max;
    out.push({ label: a.label, used, max, left: Math.max(0, max - used) });
  }
  return out;
}

/** The limit with the least room left, or null when there are none. */
export const tightest = (lines: LimitLine[]): LimitLine | null => (lines.length ? lines.reduce((a, b) => (b.left < a.left ? b : a)) : null);

export async function allowanceState(key: string): Promise<{ used: number; max: number } | null> {
  if (!(await tableExists("provider_allowances"))) return null;
  const row = (await db.prepare("SELECT used_units, max_units FROM provider_allowances WHERE key = ?").get(key)) as
    | { used_units: number; max_units: number }
    | undefined;
  return row ? { used: Number(row.used_units), max: Number(row.max_units) } : null;
}

export interface UsageStart {
  userId: number;
  projectId: number | null;
  provider: Provider;
  operation: string;
  runId?: string | null;
  keyFingerprint?: string | null;
  units: number;
  unitType: "search" | "tokens" | "call";
  model?: string | null;
}

/** Records a request before it's sent. Returns the ledger row id to complete afterwards. */
export async function reserveUsage(u: UsageStart): Promise<number> {
  if (!(await ledgerAvailable())) throw new LedgerUnavailable();
  const row = (await db
    .prepare(
      `INSERT INTO provider_usage (user_id, project_id, provider, operation, run_id, key_fingerprint, units, unit_type, model, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?) RETURNING id`,
    )
    .get(u.userId, u.projectId, u.provider, u.operation, u.runId ?? null, u.keyFingerprint ?? null, u.units, u.unitType, u.model ?? null, Date.now())) as {
    id: number;
  };
  return Number(row.id);
}

export async function completeUsage(
  id: number,
  r: { ok: boolean; error?: string; inputTokens?: number; outputTokens?: number; estCostUsd?: number | null; pricingVersion?: string | null; model?: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_usage SET status = ?, error = ?, input_tokens = COALESCE(?, input_tokens), output_tokens = COALESCE(?, output_tokens),
         est_cost_usd = COALESCE(?, est_cost_usd), pricing_version = COALESCE(?, pricing_version), model = COALESCE(?, model), completed_at = ?
       WHERE id = ? AND status = 'reserved'`,
    )
    .run(
      r.ok ? "ok" : "error",
      r.error?.slice(0, 300) ?? null,
      r.inputTokens ?? null,
      r.outputTokens ?? null,
      r.estCostUsd ?? null,
      r.pricingVersion ?? null,
      r.model ?? null,
      Date.now(),
      id,
    );
}

export interface UsageTotals {
  provider: Provider;
  requests: number;
  failed: number;
  units: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number | null;
  /** Requests whose cost couldn't be estimated (unknown model price). */
  unpriced: number;
  pricingVersions: string[];
}

/** Application-recorded usage for a project (or all of a user's projects) since `since` (ms). */
export async function usageTotals(userId: number, projectId: number | null, since: number): Promise<UsageTotals[]> {
  if (!(await ledgerAvailable())) return [];
  const rows = (await db
    .prepare(
      `SELECT provider, COUNT(*) AS requests, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed, SUM(units) AS units,
              SUM(COALESCE(input_tokens, 0)) AS input_tokens, SUM(COALESCE(output_tokens, 0)) AS output_tokens,
              SUM(est_cost_usd) AS est_cost, SUM(CASE WHEN unit_type = 'tokens' AND est_cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced,
              STRING_AGG(DISTINCT pricing_version, ',') AS versions
         FROM provider_usage
        WHERE user_id = ? AND (?::bigint IS NULL OR project_id = ?) AND created_at >= ?
        GROUP BY provider`,
    )
    .all(userId, projectId, projectId, since)) as Record<string, unknown>[];
  return rows.map((r) => ({
    provider: r.provider as Provider,
    requests: Number(r.requests ?? 0),
    failed: Number(r.failed ?? 0),
    units: Number(r.units ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    estCostUsd: r.est_cost == null ? null : Number(r.est_cost),
    unpriced: Number(r.unpriced ?? 0),
    pricingVersions: String(r.versions ?? "").split(",").filter(Boolean),
  }));
}

/**
 * Corrects an allowance after the fact, e.g. a model call reserved at its expected cost and then priced from
 * its real token usage. Never goes below zero; may go above max (the call already happened).
 */
export async function adjustAllowance(key: string, delta: number): Promise<void> {
  if (!delta) return;
  await db
    .prepare("UPDATE provider_allowances SET used_units = GREATEST(0, used_units + ?), updated_at = ? WHERE key = ?")
    .run(delta, Date.now(), key);
}

export interface DaySpend {
  day: string;
  totalUsd: number;
  byProvider: { openai: number; anthropic: number };
  calls: number;
}

/** Estimated model spend per UTC day for one account, oldest first (recorded usage, not billed amounts). */
export async function dailyModelSpend(userId: number, days: number): Promise<DaySpend[]> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const out: DaySpend[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    return { day: d.toISOString().slice(0, 10), totalUsd: 0, byProvider: { openai: 0, anthropic: 0 }, calls: 0 };
  });
  if (!(await ledgerAvailable())) return out;
  const rows = (await db
    .prepare(
      `SELECT provider, created_at, est_cost_usd FROM provider_usage
        WHERE user_id = ? AND provider IN ('openai', 'anthropic') AND created_at >= ?`,
    )
    .all(userId, start.getTime())) as { provider: "openai" | "anthropic"; created_at: number; est_cost_usd: number | null }[];
  for (const r of rows) {
    const i = Math.floor((Number(r.created_at) - start.getTime()) / 86_400_000);
    const d = out[i];
    if (!d) continue;
    const usd = Number(r.est_cost_usd ?? 0);
    d.totalUsd += usd;
    d.byProvider[r.provider] += usd;
    d.calls++;
  }
  return out;
}
