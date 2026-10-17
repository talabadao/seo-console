// Usage & Costs report. Three kinds of numbers, never mixed:
// - provider-reported: what the provider's own account/billing API says. Account-wide (the whole SerpApi
//   account, OpenAI organisation, Anthropic organisation, DataForSEO account), never a project's allocation.
// - app-recorded: requests this app made and wrote to the ledger — account-wide, or for one project when the
//   report is filtered, with a per-project attribution table.
// - estimated: USD computed from app-recorded tokens with a stated pricing version.
// Limits are read from the same policy that enforces them (lib/providers/policy.ts + lib/budgets.ts).
// Each provider section has a state: live, unavailable (not configured / not reported), error.

import { db } from "@/lib/db";
import { allowanceState, allowanceStatuses, dailyModelSpend, ledgerAvailable, usageTotals, type DaySpend, type LimitLine, type UsageTotals } from "./ledger";
import { PRICING_VERSION } from "./pricing";
import { accountSerpDecision, allowanceKeys, llmDecision, previewSerpTest, serpDecision } from "./policy";
import { NO_SERP_KEY, serpAccount, serpKey, type SerpAccount } from "./serpapi";
import { resolveCredential, type CredentialSource } from "@/lib/credentials/resolve";
import { deploymentOf } from "@/lib/environment";

type State = "live" | "unavailable" | "error";

export interface ProviderReported<T> {
  state: State;
  message?: string;
  scope: string;
  fetchedAt?: number;
  data?: T;
}

export interface RunRow {
  id: string;
  projectId: number;
  projectName: string;
  kind: string;
  trigger: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  estimate: unknown;
  actual: unknown;
  error: string | null;
}

export interface ProjectUsage {
  projectId: number | null;
  projectName: string;
  serpRequests: number;
  serpFailed: number;
  modelCalls: number;
  estCostUsd: number | null;
  unpriced: number;
}

export interface UsageReport {
  since: number;
  ledger: boolean;
  /** null = the whole account (every project); otherwise the filtered project. */
  projectId: number | null;
  serpapi: {
    keySource: CredentialSource | null;
    account: ProviderReported<SerpAccount>;
    recorded: UsageTotals | null;
    /** Limits that apply: for a project, its own and the account's; for the account, its own. */
    policy: { allowed: boolean; scope: string; limits: LimitLine[] };
    previewTest: { enabled: boolean; projectId: number | null; thisProject: boolean; max: number; used: number | null } | null;
  };
  openai: { recorded: UsageTotals | null; reported: ProviderReported<{ usd: number; currency: string }> };
  anthropic: { recorded: UsageTotals | null; reported: ProviderReported<{ amount: number; currency: string }> };
  dataforseo: { recorded: UsageTotals | null; reported: ProviderReported<{ balance: number | null; totalSpent: number | null }> };
  llmPolicy: { allowed: boolean; scope: string; limits: LimitLine[] };
  /** Estimated model spend per UTC day for the account (last 14 days). */
  modelDays: DaySpend[];
  /** App-recorded usage attributed to each project (account report only). */
  byProject: ProjectUsage[];
  pricingVersion: string;
  runs: RunRow[];
}

async function openaiReported(since: number): Promise<ProviderReported<{ usd: number; currency: string }>> {
  const scope = "OpenAI organisation (all projects and apps on it)";
  const key = process.env.OPENAI_ADMIN_KEY?.trim();
  if (!key) return { state: "unavailable", scope, message: "Not reported: needs an OpenAI admin key (OPENAI_ADMIN_KEY) on the server." };
  try {
    const res = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${Math.floor(since / 1000)}&bucket_width=1d&limit=180`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { results?: { amount?: { value?: number; currency?: string } }[] }[]; error?: { message?: string } };
    if (!res.ok) return { state: "error", scope, message: body.error?.message ?? `HTTP ${res.status}` };
    let usd = 0;
    let currency = "usd";
    for (const b of body.data ?? []) for (const r of b.results ?? []) {
      usd += r.amount?.value ?? 0;
      currency = r.amount?.currency ?? currency;
    }
    return { state: "live", scope, fetchedAt: Date.now(), data: { usd, currency } };
  } catch (e) {
    return { state: "error", scope, message: e instanceof Error ? e.message : String(e) };
  }
}

async function anthropicReported(since: number): Promise<ProviderReported<{ amount: number; currency: string }>> {
  const scope = "Anthropic organisation (all workspaces and apps on it)";
  const key = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!key) return { state: "unavailable", scope, message: "Not reported: needs an Anthropic Admin API key (ANTHROPIC_ADMIN_KEY) on the server." };
  try {
    const res = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(new Date(since).toISOString())}`, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { results?: { amount?: string; currency?: string }[] }[]; error?: { message?: string } };
    if (!res.ok) return { state: "error", scope, message: body.error?.message ?? `HTTP ${res.status}` };
    let amount = 0;
    let currency = "USD";
    for (const b of body.data ?? []) for (const r of b.results ?? []) {
      amount += Number(r.amount ?? 0);
      currency = r.currency ?? currency;
    }
    // Anthropic reports amounts in the currency's smallest unit (cents for USD).
    return { state: "live", scope, fetchedAt: Date.now(), data: { amount: amount / 100, currency } };
  } catch (e) {
    return { state: "error", scope, message: e instanceof Error ? e.message : String(e) };
  }
}

async function dataforseoReported(userId: number): Promise<ProviderReported<{ balance: number | null; totalSpent: number | null }>> {
  const scope = "DataForSEO account";
  const cred = await resolveCredential(userId, "dataforseo");
  if (!cred) return { state: "unavailable", scope, message: "Not connected: no DataForSEO API login and password in Settings → Account → API credentials." };
  const { login, password } = cred.values;
  try {
    // Account information is a free endpoint; no paid task is created.
    const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { tasks?: { result?: { money?: { balance?: number; total?: number } }[] }[]; status_message?: string };
    if (!res.ok) return { state: "error", scope, message: body.status_message ?? `HTTP ${res.status}` };
    const money = body.tasks?.[0]?.result?.[0]?.money;
    return { state: "live", scope, fetchedAt: Date.now(), data: { balance: money?.balance ?? null, totalSpent: money?.total ?? null } };
  } catch (e) {
    return { state: "error", scope, message: e instanceof Error ? e.message : String(e) };
  }
}

async function byProjectUsage(userId: number, since: number): Promise<ProjectUsage[]> {
  if (!(await ledgerAvailable())) return [];
  const rows = (await db
    .prepare(
      `SELECT u.project_id, p.name,
              SUM(CASE WHEN u.provider = 'serpapi' THEN 1 ELSE 0 END) AS serp,
              SUM(CASE WHEN u.provider = 'serpapi' AND u.status = 'error' THEN 1 ELSE 0 END) AS serp_failed,
              SUM(CASE WHEN u.provider IN ('openai', 'anthropic') THEN 1 ELSE 0 END) AS model_calls,
              SUM(CASE WHEN u.provider IN ('openai', 'anthropic') THEN u.est_cost_usd END) AS est,
              SUM(CASE WHEN u.unit_type = 'tokens' AND u.est_cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM provider_usage u LEFT JOIN projects p ON p.id = u.project_id AND p.user_id = u.user_id
        WHERE u.user_id = ? AND u.created_at >= ?
        GROUP BY u.project_id, p.name
        ORDER BY serp DESC`,
    )
    .all(userId, since)) as Record<string, unknown>[];
  return rows.map((r) => ({
    projectId: r.project_id == null ? null : Number(r.project_id),
    projectName: r.project_id == null ? "No project" : String(r.name ?? `Deleted project #${r.project_id}`),
    serpRequests: Number(r.serp ?? 0),
    serpFailed: Number(r.serp_failed ?? 0),
    modelCalls: Number(r.model_calls ?? 0),
    estCostUsd: r.est == null ? null : Number(r.est),
    unpriced: Number(r.unpriced ?? 0),
  }));
}

/**
 * Usage & Costs for the signed-in account (projectId null) or one of its projects. The caller checks that the
 * project is the user's. Free reads only.
 */
export async function usageReport(userId: number, projectId: number | null, since: number): Promise<UsageReport> {
  const ledger = await ledgerAvailable();
  const totals = await usageTotals(userId, projectId, since);
  const pick = (p: string) => totals.find((t) => t.provider === p) ?? null;
  const key = await serpKey(userId, projectId);
  let account: ProviderReported<SerpAccount>;
  const accountScope = key
    ? `SerpApi account behind ${key.source === "project-legacy" ? "this project's own legacy key" : key.source === "account" ? "your account's SerpApi key" : "the server key (legacy, allowed for this account)"} — shared by every project that uses the same key`
    : "SerpApi account";
  if (!key) account = { state: "unavailable", scope: accountScope, message: NO_SERP_KEY };
  else {
    try {
      const a = await serpAccount(key);
      account = { state: "live", scope: accountScope, fetchedAt: a.fetchedAt, data: a };
    } catch (e) {
      account = { state: "error", scope: accountScope, message: e instanceof Error ? e.message : String(e) };
    }
  }

  // Limits: a project report shows the project's and the account's; the account report shows the account's.
  const sd = projectId != null ? await serpDecision(userId, projectId) : await accountSerpDecision(userId);
  const serpPolicy: UsageReport["serpapi"]["policy"] = sd.allowed
    ? { allowed: true, scope: sd.scope, limits: await allowanceStatuses(sd.allowances) }
    : { allowed: false, scope: sd.reason, limits: [] };
  const ld = await llmDecision(userId, projectId);
  const llmPolicy: UsageReport["llmPolicy"] = ld.allowed
    ? { allowed: true, scope: ld.scope, limits: await allowanceStatuses(ld.allowances) }
    : { allowed: false, scope: ld.reason, limits: [] };
  const test = previewSerpTest();
  const preview = deploymentOf() === "preview";
  const previewUsed = preview && test.projectId != null ? ((await allowanceState(allowanceKeys.previewSerpTotal()))?.used ?? 0) : null;

  const runs = ledger
    ? ((await db
        .prepare(
          `SELECT r.id, r.project_id, r.kind, r.trigger, r.status, r.started_at, r.finished_at, r.estimate, r.actual, r.error, p.name AS project_name
             FROM ai_runs r LEFT JOIN projects p ON p.id = r.project_id
            WHERE r.user_id = ? AND (?::bigint IS NULL OR r.project_id = ?) AND r.started_at >= ?
            ORDER BY r.started_at DESC LIMIT 50`,
        )
        .all(userId, projectId, projectId, since)) as Record<string, unknown>[])
    : [];
  const parse = (v: unknown) => {
    try {
      return typeof v === "string" ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };
  const [openai, anthropic, dataforseo, modelDays, byProject] = await Promise.all([
    openaiReported(since),
    anthropicReported(since),
    dataforseoReported(userId),
    dailyModelSpend(userId, 14),
    projectId == null ? byProjectUsage(userId, since) : Promise.resolve([] as ProjectUsage[]),
  ]);
  return {
    since,
    ledger,
    projectId,
    serpapi: {
      keySource: key?.source ?? null,
      account,
      recorded: pick("serpapi"),
      policy: serpPolicy,
      previewTest: preview ? { enabled: test.projectId != null, projectId: test.projectId, thisProject: test.projectId === projectId, max: test.max, used: previewUsed } : null,
    },
    openai: { recorded: pick("openai"), reported: openai },
    anthropic: { recorded: pick("anthropic"), reported: anthropic },
    dataforseo: { recorded: pick("dataforseo"), reported: dataforseo },
    llmPolicy,
    modelDays,
    byProject,
    pricingVersion: PRICING_VERSION,
    runs: runs.map((r) => ({
      id: String(r.id),
      projectId: Number(r.project_id),
      projectName: String(r.project_name ?? ""),
      kind: String(r.kind),
      trigger: String(r.trigger),
      status: String(r.status),
      startedAt: Number(r.started_at),
      finishedAt: r.finished_at == null ? null : Number(r.finished_at),
      estimate: parse(r.estimate),
      actual: parse(r.actual),
      error: (r.error as string | null) ?? null,
    })),
  };
}
