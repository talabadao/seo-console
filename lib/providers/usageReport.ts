// Usage & Costs report. Three kinds of numbers, never mixed:
// - provider-reported: what the provider's own account/billing API says. Account-wide (the whole SerpApi
//   account, OpenAI organisation, Anthropic organisation, DataForSEO account), never a project's allocation.
// - app-recorded: requests this app made and wrote to the ledger, per project.
// - estimated: USD computed from app-recorded tokens with a stated pricing version.
// Each provider section has a state: live, unavailable (not configured / not reported), error.

import { db } from "@/lib/db";
import { allowanceState, ledgerAvailable, usageTotals, type UsageTotals } from "./ledger";
import { PRICING_VERSION } from "./pricing";
import { llmDecision, previewSerpTest, serpDecision } from "./policy";
import { serpAccount, serpKey, type SerpAccount } from "./serpapi";
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
  kind: string;
  trigger: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  estimate: unknown;
  actual: unknown;
  error: string | null;
}

export interface UsageReport {
  since: number;
  ledger: boolean;
  serpapi: {
    keySource: "project" | "server" | null;
    account: ProviderReported<SerpAccount>;
    recorded: UsageTotals | null;
    policy: { allowed: boolean; scope: string; used: number | null; max: number | null };
    previewTest: { enabled: boolean; thisProject: boolean; max: number } | null;
  };
  openai: { recorded: UsageTotals | null; reported: ProviderReported<{ usd: number; currency: string }> };
  anthropic: { recorded: UsageTotals | null; reported: ProviderReported<{ amount: number; currency: string }> };
  dataforseo: { recorded: UsageTotals | null; reported: ProviderReported<{ balance: number | null; totalSpent: number | null }> };
  llmPolicy: { allowed: boolean; scope: string; used: number | null; max: number | null };
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

async function dataforseoReported(): Promise<ProviderReported<{ balance: number | null; totalSpent: number | null }>> {
  const scope = "DataForSEO account";
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  if (!login || !password) return { state: "unavailable", scope, message: "Not connected: SEO Console has no DataForSEO credentials, and nothing in the app uses DataForSEO yet." };
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

export async function usageReport(userId: number, projectId: number, since: number): Promise<UsageReport> {
  const ledger = await ledgerAvailable();
  const totals = await usageTotals(userId, projectId, since);
  const pick = (p: string) => totals.find((t) => t.provider === p) ?? null;
  const key = await serpKey(projectId);
  let account: ProviderReported<SerpAccount>;
  const accountScope = key
    ? `SerpApi account behind the ${key.source === "project" ? "project's own key" : "server key"} (shared by every project that uses this key)`
    : "SerpApi account";
  if (!key) account = { state: "unavailable", scope: accountScope, message: "No SerpApi key: add one in Project settings, or set SERPAPI_API_KEY on the server." };
  else {
    try {
      const a = await serpAccount(key);
      account = { state: "live", scope: accountScope, fetchedAt: a.fetchedAt, data: a };
    } catch (e) {
      account = { state: "error", scope: accountScope, message: e instanceof Error ? e.message : String(e) };
    }
  }
  const sd = serpDecision(projectId);
  const sState = sd.allowed ? await allowanceState(sd.allowanceKey) : null;
  const ld = llmDecision(userId);
  const lState = ld.allowed ? await allowanceState(ld.allowanceKey) : null;
  const test = previewSerpTest();
  const runs = ledger
    ? ((await db
        .prepare("SELECT id, kind, trigger, status, started_at, finished_at, estimate, actual, error FROM ai_runs WHERE user_id = ? AND project_id = ? AND started_at >= ? ORDER BY started_at DESC LIMIT 50")
        .all(userId, projectId, since)) as Record<string, unknown>[])
    : [];
  const parse = (v: unknown) => {
    try {
      return typeof v === "string" ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };
  const [openai, anthropic, dataforseo] = await Promise.all([openaiReported(since), anthropicReported(since), dataforseoReported()]);
  return {
    since,
    ledger,
    serpapi: {
      keySource: key?.source ?? null,
      account,
      recorded: pick("serpapi"),
      policy: { allowed: sd.allowed, scope: sd.allowed ? sd.scope : sd.reason, used: sState?.used ?? (sd.allowed ? 0 : null), max: sd.allowed ? sd.max : null },
      previewTest: deploymentOf() === "preview" ? { enabled: test.projectId != null, thisProject: test.projectId === projectId, max: test.max } : null,
    },
    openai: { recorded: pick("openai"), reported: openai },
    anthropic: { recorded: pick("anthropic"), reported: anthropic },
    dataforseo: { recorded: pick("dataforseo"), reported: dataforseo },
    llmPolicy: { allowed: ld.allowed, scope: ld.allowed ? ld.scope : ld.reason, used: lState?.used ?? (ld.allowed ? 0 : null), max: ld.allowed ? ld.max : null },
    pricingVersion: PRICING_VERSION,
    runs: runs.map((r) => ({
      id: String(r.id),
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
