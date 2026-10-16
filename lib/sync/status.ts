// Sync & cache status for one account, read from local records only (report_cache, sync_jobs, provider_cooldown,
// provider_usage) — opening this page never asks a provider anything.

import { db } from "@/lib/db";
import { scopeOf } from "./cache";

export interface CacheEntryStatus {
  kind: string;
  provider: string;
  projectId: number | null;
  projectName: string | null;
  /** Human summary of the query (part, period). */
  label: string;
  fetchedAt: number | null;
  dataThrough: string | null;
  /** When it's due for a refresh (fresh_until). */
  dueAt: number | null;
  hits: number;
  misses: number;
  lastReadAt: number | null;
  lastError: string | null;
  accessError: string | null;
  job: { id: number; status: string; reason: string; attempts: number; runAfter: number; error: string | null } | null;
}

export interface SyncStatus {
  entries: CacheEntryStatus[];
  jobs: { queued: number; running: number; failed: number; done: number; providerRequests: number; retries: number; since: number };
  byProvider: Array<{ provider: string; jobs: number; failed: number; providerRequests: number; retries: number; hits: number; misses: number }>;
  cooldowns: Array<{ bucket: string; until: number; reason: string | null }>;
  generatedAt: number;
}

function label(kind: string, query: Record<string, unknown>): string {
  const period = query.period as { current?: { start: string; end: string } } | undefined;
  const range = period?.current ? ` · ${period.current.start} – ${period.current.end}` : "";
  const name: Record<string, string> = {
    "summary:gsc": "Search Console summary",
    "summary:ga4": "GA4 summary",
    "summary:kpi": "KPI actuals (GA4)",
    "summary:tasks": "Asana tasks",
    "summary:health": "Index coverage",
    "summary:rankings": "SE Ranking summary",
    "llm-traffic": "LLMs Traffic",
    "seranking:report": "SE Ranking rankings",
    pagemeta: "Page thumbnails",
  };
  return `${name[kind] ?? kind}${query.detail ? " (detail)" : ""}${range}`;
}

export async function syncStatus(userId: number, sinceMs = 7 * 24 * 3600_000): Promise<SyncStatus> {
  const scope = scopeOf(userId);
  const since = Date.now() - sinceMs;
  const rows = (await db
    .prepare(
      `SELECT c.kind, c.provider, c.project_id, p.name AS project_name, c.query, c.fetched_at, c.data_through, c.fresh_until, c.hits, c.misses,
              c.last_read_at, c.last_error, c.access_error,
              j.id AS job_id, j.status AS job_status, j.reason AS job_reason, j.attempts AS job_attempts, j.run_after AS job_run_after, j.error AS job_error
         FROM report_cache c
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN sync_jobs j ON j.scope = c.scope AND j.cache_key = c.cache_key AND j.status IN ('queued', 'running')
        WHERE c.scope = ?
        ORDER BY c.last_read_at DESC NULLS LAST
        LIMIT 300`,
    )
    .all(scope)) as Record<string, unknown>[];
  const n = (v: unknown) => (v == null ? null : Number(v));
  const entries: CacheEntryStatus[] = rows.map((r) => ({
    kind: String(r.kind),
    provider: String(r.provider),
    projectId: n(r.project_id),
    projectName: (r.project_name as string | null) ?? null,
    label: label(String(r.kind), (typeof r.query === "string" ? JSON.parse(r.query) : r.query) as Record<string, unknown>),
    fetchedAt: n(r.fetched_at),
    dataThrough: (r.data_through as string | null) ?? null,
    dueAt: n(r.fresh_until),
    hits: Number(r.hits ?? 0),
    misses: Number(r.misses ?? 0),
    lastReadAt: n(r.last_read_at),
    lastError: (r.last_error as string | null) ?? null,
    accessError: (r.access_error as string | null) ?? null,
    job: r.job_id == null ? null : { id: Number(r.job_id), status: String(r.job_status), reason: String(r.job_reason), attempts: Number(r.job_attempts), runAfter: Number(r.job_run_after), error: (r.job_error as string | null) ?? null },
  }));
  const jobRows = (await db
    .prepare(
      `SELECT provider, status, COUNT(*) AS n, SUM(provider_requests) AS req, SUM(retries) AS ret
         FROM sync_jobs WHERE scope = ? AND created_at >= ? GROUP BY provider, status`,
    )
    .all(scope, since)) as Array<{ provider: string; status: string; n: number; req: number; ret: number }>;
  const jobs = { queued: 0, running: 0, failed: 0, done: 0, providerRequests: 0, retries: 0, since };
  const byProvider = new Map<string, SyncStatus["byProvider"][number]>();
  for (const r of jobRows) {
    const s = r.status as "queued" | "running" | "failed" | "done";
    if (s in jobs) jobs[s] += Number(r.n);
    jobs.providerRequests += Number(r.req ?? 0);
    jobs.retries += Number(r.ret ?? 0);
    const p = byProvider.get(r.provider) ?? { provider: r.provider, jobs: 0, failed: 0, providerRequests: 0, retries: 0, hits: 0, misses: 0 };
    p.jobs += Number(r.n);
    if (s === "failed") p.failed += Number(r.n);
    p.providerRequests += Number(r.req ?? 0);
    p.retries += Number(r.ret ?? 0);
    byProvider.set(r.provider, p);
  }
  for (const e of entries) {
    const p = byProvider.get(e.provider) ?? { provider: e.provider, jobs: 0, failed: 0, providerRequests: 0, retries: 0, hits: 0, misses: 0 };
    p.hits += e.hits;
    p.misses += e.misses;
    byProvider.set(e.provider, p);
  }
  const cooldowns = (await db.prepare("SELECT bucket, until, reason FROM provider_cooldown WHERE until > ? ORDER BY until DESC LIMIT 20").all(Date.now())) as Array<{
    bucket: string;
    until: number;
    reason: string | null;
  }>;
  return {
    entries,
    jobs,
    byProvider: [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider)),
    // Buckets are quota scopes (a site, a property, a key fingerprint), not secrets; still, only show the type.
    cooldowns: cooldowns.map((c) => ({ bucket: c.bucket.split(":").slice(0, 2).join(":"), until: Number(c.until), reason: c.reason })),
    generatedAt: Date.now(),
  };
}
