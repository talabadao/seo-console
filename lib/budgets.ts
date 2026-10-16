// Budget limits: one canonical service behind Settings → Account → Budgets & limits, Project settings →
// Budgets and the spend checks in lib/providers/policy.ts.
//
// Metrics (units stay per provider; SerpApi requests are never mixed with dollars):
// - Account (all of the account's projects together):
//     serpapi_requests_month  SerpApi requests per calendar month (UTC). Default: no account-wide limit.
//     model_usd_day           estimated model spend per UTC day.        Default: AI_AREA_DAILY_USD_LIMIT or $5.
// - Project:
//     serpapi_requests_month  SerpApi requests per calendar month.      Default: AI_AREA_SERPAPI_MONTHLY_CAP or 500.
//     model_usd_month         estimated model spend per month.          Default: no project limit.
// A stored value overrides the default; clearing it returns to the default. Values are validated server-side.

import { db, tableExists } from "@/lib/db";

type Env = Record<string, string | undefined>;

export type LimitScope = "account" | "project";
export type LimitMetric = "serpapi_requests_month" | "model_usd_day" | "model_usd_month";

export interface LimitSpec {
  metric: LimitMetric;
  scope: LimitScope;
  label: string;
  unit: "requests" | "USD";
  period: "month" | "day";
  /** Upper bound accepted from the form. */
  max: number;
  default: (env: Env) => number | null;
}

/** A server default from the environment; a blank or invalid value means "not set" (never a limit of 0). */
const envNumber = (env: Env, name: string, fallback: number) => {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export const LIMITS: LimitSpec[] = [
  { metric: "serpapi_requests_month", scope: "account", label: "SerpApi requests per month, all projects", unit: "requests", period: "month", max: 1_000_000, default: () => null },
  { metric: "model_usd_day", scope: "account", label: "Model spend per day, all projects (estimated)", unit: "USD", period: "day", max: 10_000, default: (env) => envNumber(env, "AI_AREA_DAILY_USD_LIMIT", 5) },
  { metric: "serpapi_requests_month", scope: "project", label: "SerpApi requests per month", unit: "requests", period: "month", max: 1_000_000, default: (env) => envNumber(env, "AI_AREA_SERPAPI_MONTHLY_CAP", 500) },
  { metric: "model_usd_month", scope: "project", label: "Model spend per month (estimated)", unit: "USD", period: "month", max: 100_000, default: () => null },
];

export const limitSpec = (scope: LimitScope, metric: string) => LIMITS.find((l) => l.scope === scope && l.metric === metric);

export interface EffectiveLimit extends Omit<LimitSpec, "default"> {
  projectId: number | null;
  /** The limit in force; null = no limit. */
  value: number | null;
  /** "configured" when set in Settings, "default" when the server default applies. */
  source: "configured" | "default";
  defaultValue: number | null;
  updatedAt: number | null;
}

export class BudgetInputError extends Error {}

export async function budgetsReady(): Promise<boolean> {
  return tableExists("budget_limits");
}

type LimitRow = { project_id: number; metric: string; limit_value: number; updated_at: number };

/** Stored limits for the account (project 0) and, optionally, one project. */
async function rows(userId: number, projectId: number | null): Promise<LimitRow[]> {
  if (!(await budgetsReady())) return [];
  return (await db
    .prepare("SELECT project_id, metric, limit_value, updated_at FROM budget_limits WHERE user_id = ? AND (project_id = 0 OR project_id = ?)")
    .all(userId, projectId ?? -1)) as unknown as LimitRow[];
}

/** Every stored project limit of an account, for the per-project table. */
export async function storedProjectLimits(userId: number): Promise<LimitRow[]> {
  if (!(await budgetsReady())) return [];
  return (await db.prepare("SELECT project_id, metric, limit_value, updated_at FROM budget_limits WHERE user_id = ? AND project_id <> 0").all(userId)) as unknown as LimitRow[];
}

/** The limits in force for the account (projectId null) or for the account and one project. */
export async function effectiveLimits(userId: number, projectId: number | null, env: Env = process.env): Promise<EffectiveLimit[]> {
  const stored = await rows(userId, projectId);
  const specs = LIMITS.filter((l) => l.scope === "account" || projectId != null);
  return specs.map((spec) => {
    const pid = spec.scope === "account" ? 0 : projectId!;
    const row = stored.find((r) => Number(r.project_id) === pid && r.metric === spec.metric);
    const def = spec.default(env);
    const { default: _omit, ...rest } = spec;
    void _omit;
    return {
      ...rest,
      projectId: spec.scope === "account" ? null : projectId,
      value: row ? Number(row.limit_value) : def,
      source: row ? "configured" : "default",
      defaultValue: def,
      updatedAt: row ? Number(row.updated_at) : null,
    };
  });
}

/**
 * Sets (value) or clears (null → back to the server default) one limit. projectId must already be checked as
 * one of the user's projects by the caller. Returns the limit now in force.
 */
export async function setLimit(userId: number, scope: LimitScope, projectId: number | null, metric: string, value: number | null, env: Env = process.env): Promise<EffectiveLimit> {
  const spec = limitSpec(scope, metric);
  if (!spec) throw new BudgetInputError("Unknown limit.");
  if (scope === "project" && projectId == null) throw new BudgetInputError("Choose a project.");
  const pid = scope === "account" ? 0 : projectId!;
  if (value === null) {
    await db.prepare("DELETE FROM budget_limits WHERE user_id = ? AND project_id = ? AND metric = ?").run(userId, pid, metric);
  } else {
    if (!Number.isFinite(value) || value < 0) throw new BudgetInputError("Enter a number of zero or more, or clear the field to use the default.");
    if (value > spec.max) throw new BudgetInputError(`At most ${spec.max.toLocaleString("en-US")} ${spec.unit === "USD" ? "USD" : "requests"}.`);
    const v = spec.unit === "requests" ? Math.floor(value) : Math.round(value * 100) / 100;
    await db
      .prepare(
        `INSERT INTO budget_limits (user_id, project_id, metric, limit_value, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, project_id, metric) DO UPDATE SET limit_value = EXCLUDED.limit_value, updated_at = EXCLUDED.updated_at`,
      )
      .run(userId, pid, metric, v, Date.now());
  }
  const now = await effectiveLimits(userId, scope === "project" ? projectId : null, env);
  return now.find((l) => l.scope === scope && l.metric === metric)!;
}
