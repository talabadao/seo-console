// Shared, persistent read-through cache with durable synchronization jobs (tables from migration 0008).
//
// Reads never wait on a provider when a usable result exists:
// - fresh hit      → the saved result.
// - stale hit      → the last successful result (with its real timestamp) and one refresh job (joined if one is
//                    already queued or running anywhere).
// - cold miss      → create or join the one job for this query and run it now if nobody holds it; other readers
//                    wait briefly for its result, then get "pending" and poll.
// Jobs are rows, not promises: a lease (lease_until + lease_token) lets another worker pick up a job whose worker
// died; only the current lease holder can complete it; a result from an older job never replaces a newer one
// (generation = job id). Failures keep the previous result; an access error (401/403) hides it.
//
// Identity: (scope, cache_key). scope is the account ("user:<id>") — data produced with one account's credentials
// and project ownership is only ever served to that account. cache_key hashes the kind and the canonical query
// (ids, dates, filters, metrics, time zone and config versions). Credentials are never part of a query.

import { createHash, randomUUID } from "node:crypto";
import { db, tableExists, withTransaction } from "@/lib/db";
import { runWithJobContext, type JobCounters } from "./context";
import { ProviderBusyError } from "./providerHttp";

export interface JobKind<Q = unknown, P = unknown> {
  kind: string;
  provider: string;
  /** How long a result counts as fresh. */
  freshMs: number;
  /** Fetches from the provider for this query. Throw to fail; the previous result is kept. */
  run(ctx: { userId: number; projectId: number | null; query: Q }): Promise<{ payload: P; dataThrough?: string | null }>;
  /** True when the error means the account no longer has access: cached data must not be served. */
  isAccessError?(e: unknown): boolean;
  /** Refreshed only by an explicit (e.g. chargeable) action: never by stale reads or the scheduler. */
  manualOnly?: boolean;
  /**
   * A result's own freshness, when it depends on the result: a resumable dataset that isn't complete yet returns a
   * short time, so the next read or scheduled tick continues it; a complete one returns its full interval.
   */
  freshFor?(payload: P): number;
}

const registry = new Map<string, JobKind>();
export function registerKind<Q, P>(k: JobKind<Q, P>): void {
  registry.set(k.kind, k as JobKind);
}
export const kindOf = (kind: string) => registry.get(kind);

/** Hook for starting background work after a response (after() in route handlers); tests replace it. */
let background: (fn: () => Promise<void>) => void = (fn) => {
  void fn().catch(() => {});
};
export function setBackgroundRunner(run: (fn: () => Promise<void>) => void): void {
  background = run;
}

export const LEASE_MS = 90_000;
export const MANUAL_COOLDOWN_MS = 5 * 60_000;
/** After an access error, how long before a read tries the provider again (e.g. after reconnecting). */
export const ACCESS_RETRY_MS = 15 * 60_000;
const POLL_MS = 250;

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export const cacheKey = (kind: string, query: unknown) => createHash("sha256").update(`${kind}|${stableStringify(query)}`).digest("hex");
export const scopeOf = (userId: number) => `user:${userId}`;

export async function syncReady(): Promise<boolean> {
  return tableExists("report_cache");
}

export interface ReadResult<P> {
  state: "fresh" | "stale" | "pending" | "error";
  payload?: P;
  fetchedAt?: number | null;
  dataThrough?: string | null;
  /** A refresh job is queued or running for this query. */
  refreshing?: boolean;
  jobId?: number | null;
  error?: string | null;
  /** A manual refresh was skipped because the result is recent (cooldown). */
  cooldown?: boolean;
}

interface CacheRow {
  payload: unknown;
  last_error_at: number | null;
  fetched_at: number | null;
  fresh_until: number | null;
  data_through: string | null;
  access_error: string | null;
  last_error: string | null;
  generation: number;
}

const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

async function readRow(scope: string, key: string): Promise<CacheRow | undefined> {
  return (await db
    .prepare("SELECT payload, fetched_at, fresh_until, data_through, access_error, last_error, last_error_at, generation FROM report_cache WHERE scope = ? AND cache_key = ?")
    .get(scope, key)) as CacheRow | undefined;
}

/** Creates the one open job for this query, or returns the one already queued or running. */
export async function enqueue(opts: {
  kind: string;
  userId: number;
  projectId: number | null;
  query: unknown;
  reason: "cold" | "stale" | "manual" | "schedule";
  runAfter?: number;
}): Promise<number> {
  const k = kindOf(opts.kind);
  if (!k) throw new Error(`Unknown sync kind ${opts.kind}`);
  const scope = scopeOf(opts.userId);
  const key = cacheKey(opts.kind, opts.query);
  const now = Date.now();
  const q = JSON.stringify(opts.query);
  await db
    .prepare(
      `INSERT INTO report_cache (scope, cache_key, kind, provider, user_id, project_id, query) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)
       ON CONFLICT (scope, cache_key) DO NOTHING`,
    )
    .run(scope, key, opts.kind, k.provider, opts.userId, opts.projectId, q);
  for (let i = 0; i < 3; i++) {
    const created = (await db
      .prepare(
        `INSERT INTO sync_jobs (scope, cache_key, kind, provider, user_id, project_id, query, reason, status, run_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'queued', ?, ?)
         ON CONFLICT (scope, cache_key) WHERE status IN ('queued', 'running') DO NOTHING RETURNING id`,
      )
      .get(scope, key, opts.kind, k.provider, opts.userId, opts.projectId, q, opts.reason, opts.runAfter ?? now, now)) as { id: number } | undefined;
    if (created) return Number(created.id);
    const open = (await db
      .prepare("SELECT id FROM sync_jobs WHERE scope = ? AND cache_key = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1")
      .get(scope, key)) as { id: number } | undefined;
    if (open) return Number(open.id);
  }
  throw new Error("Couldn't create or join a sync job.");
}

export type RunOutcome = "done" | "not-claimed" | "requeued" | "failed" | "lost-lease" | "skipped";

const backoffMs = (attempt: number) => Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1)) + Math.floor(Math.random() * 5000);

/** Claims and runs one job. Safe to call from any instance at any time: only one can hold the lease. */
export async function runJob(id: number, leaseMs = LEASE_MS): Promise<RunOutcome> {
  const token = randomUUID();
  const now = Date.now();
  const job = (await db
    .prepare(
      `UPDATE sync_jobs SET status = 'running', lease_token = ?, lease_until = ?, attempts = attempts + 1, started_at = COALESCE(started_at, ?)
        WHERE id = ? AND ((status = 'queued' AND run_after <= ?) OR (status = 'running' AND lease_until < ?))
        RETURNING id, scope, cache_key, kind, user_id, project_id, query, attempts, max_attempts, reason`,
    )
    .get(token, now + leaseMs, now, id, now, now)) as
    | { id: number; scope: string; cache_key: string; kind: string; user_id: number; project_id: number | null; query: unknown; attempts: number; max_attempts: number; reason: string }
    | undefined;
  if (!job) return "not-claimed";
  const k = kindOf(job.kind);
  const finish = async (status: "failed" | "queued", error: string, runAfter: number | null, counters: JobCounters) => {
    const r = await db
      .prepare(
        `UPDATE sync_jobs SET status = ?, error = ?, run_after = COALESCE(?, run_after), lease_until = NULL, lease_token = NULL,
           finished_at = CASE WHEN ? = 'failed' THEN ? ELSE finished_at END,
           provider_requests = provider_requests + ?, retries = retries + ?
         WHERE id = ? AND lease_token = ?`,
      )
      .run(status, error.slice(0, 500), runAfter, status, Date.now(), counters.providerRequests, counters.retries, id, token);
    if (r.count) {
      await db
        .prepare("UPDATE report_cache SET last_error = ?, last_error_at = ? WHERE scope = ? AND cache_key = ?")
        .run(error.slice(0, 500), Date.now(), job.scope, job.cache_key);
    }
    return r.count > 0;
  };
  const counters: JobCounters = { providerRequests: 0, retries: 0 };
  if (!k) {
    await finish("failed", `Unknown sync kind ${job.kind}`, null, counters);
    return "failed";
  }
  // Authorization is rechecked when the job runs, not only when it was queued.
  if (job.project_id != null) {
    const owns = await db.prepare("SELECT 1 FROM projects WHERE id = ? AND user_id = ?").get(job.project_id, job.user_id);
    if (!owns) {
      await finish("failed", "The project is no longer this account's.", null, counters);
      await db.prepare("UPDATE report_cache SET payload = NULL, access_error = ? WHERE scope = ? AND cache_key = ?").run("Project no longer accessible", job.scope, job.cache_key);
      return "failed";
    }
  }
  // A reader may have seen the old result just before another job refreshed it, and queued this one. If the
  // result is already fresh (or, for a manual refresh, within the cooldown), finish without asking the provider.
  const cur = (await db
    .prepare("SELECT fresh_until, fetched_at FROM report_cache WHERE scope = ? AND cache_key = ? AND payload IS NOT NULL AND access_error IS NULL")
    .get(job.scope, job.cache_key)) as { fresh_until: number | null; fetched_at: number | null } | undefined;
  const alreadyFresh = cur && (job.reason === "manual" ? Number(cur.fetched_at ?? 0) > now - MANUAL_COOLDOWN_MS : Number(cur.fresh_until ?? 0) > now);
  if (alreadyFresh) {
    await db
      .prepare("UPDATE sync_jobs SET status = 'done', finished_at = ?, error = 'skipped: already fresh', lease_until = NULL, lease_token = NULL WHERE id = ? AND lease_token = ?")
      .run(Date.now(), id, token);
    return "skipped";
  }
  let result: { payload: unknown; dataThrough?: string | null };
  try {
    result = await runWithJobContext(counters, () => k.run({ userId: Number(job.user_id), projectId: job.project_id == null ? null : Number(job.project_id), query: parse(job.query) }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof ProviderBusyError) {
      // Rate-limited: try again when the provider allows, without counting it as a failed attempt.
      await db.prepare("UPDATE sync_jobs SET attempts = GREATEST(0, attempts - 1) WHERE id = ? AND lease_token = ?").run(id, token);
      return (await finish("queued", message, e.until, counters)) ? "requeued" : "lost-lease";
    }
    if (k.isAccessError?.(e)) {
      await finish("failed", message, null, counters);
      await db.prepare("UPDATE report_cache SET access_error = ? WHERE scope = ? AND cache_key = ?").run(message.slice(0, 300), job.scope, job.cache_key);
      return "failed";
    }
    if (job.attempts < job.max_attempts) return (await finish("queued", message, Date.now() + backoffMs(job.attempts), counters)) ? "requeued" : "lost-lease";
    await finish("failed", message, null, counters);
    return "failed";
  }
  // Commit only if this worker still holds the lease, and never over a result from a newer job.
  return withTransaction(async (q) => {
    const held = await q("SELECT status, lease_token FROM sync_jobs WHERE id = ? FOR UPDATE", id);
    if (!held[0] || held[0].status !== "running" || held[0].lease_token !== token) return "lost-lease" as const;
    const now2 = Date.now();
    await q(
      `UPDATE report_cache SET payload = ?::jsonb, generation = ?, fetched_at = ?, fresh_until = ?, data_through = ?, access_error = NULL, last_error = NULL
        WHERE scope = ? AND cache_key = ? AND generation < ?`,
      JSON.stringify(result.payload),
      id,
      now2,
      now2 + (k.freshFor ? k.freshFor(result.payload) : k.freshMs),
      result.dataThrough ?? null,
      job.scope,
      job.cache_key,
      id,
    );
    await q(
      `UPDATE sync_jobs SET status = 'done', finished_at = ?, error = NULL, lease_until = NULL, lease_token = NULL,
         provider_requests = provider_requests + ?, retries = retries + ? WHERE id = ?`,
      now2,
      counters.providerRequests,
      counters.retries,
      id,
    );
    return "done" as const;
  });
}

/**
 * Runs due jobs (queued and due, or running with an expired lease), oldest first, within a time budget, with
 * up to `concurrency` at once (default 4; provider rate windows still apply). Safe alongside other runners:
 * each job is claimed atomically, so two runners never run the same job.
 */
export async function runDueJobs(opts: { limit: number; budgetMs: number; userId?: number; concurrency?: number }): Promise<{ ran: number; outcomes: Record<string, number> }> {
  const deadline = Date.now() + opts.budgetMs;
  const outcomes: Record<string, number> = {};
  const inFlight = new Set<number>();
  let ran = 0;
  let exhausted = false;
  const lanes = Math.max(1, opts.concurrency ?? 4);
  /** The next due job no lane here is running; null when nothing is due. */
  const next = async (): Promise<number | null> => {
    for (;;) {
      const now = Date.now();
      const rows = (await db
        .prepare(
          `SELECT id FROM sync_jobs WHERE ((status = 'queued' AND run_after <= ?) OR (status = 'running' AND lease_until < ?))
             AND (?::bigint IS NULL OR user_id = ?) ORDER BY run_after, id LIMIT ?`,
        )
        .all(now, now, opts.userId ?? null, opts.userId ?? null, inFlight.size + lanes)) as Array<{ id: number }>;
      if (!rows.length) return null;
      const id = rows.map((r) => Number(r.id)).find((x) => !inFlight.has(x));
      if (id != null) return id;
      // Everything due is being run by another lane right now: wait for one to finish.
      if (Date.now() >= deadline) return null;
      await sleep(50);
    }
  };
  const lane = async () => {
    while (!exhausted && ran < opts.limit && Date.now() < deadline) {
      const id = await next();
      if (id == null) {
        exhausted = true;
        break;
      }
      inFlight.add(id);
      ran++;
      try {
        const outcome = await runJob(id);
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      } finally {
        inFlight.delete(id);
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return { ran, outcomes };
}

/** Queues refreshes for stale results that were read recently ("active"), for scheduled ticks. */
export async function enqueueDueRefreshes(opts: { activeSinceMs: number; limit: number }): Promise<number> {
  const now = Date.now();
  const due = (await db
    .prepare(
      `SELECT c.kind, c.user_id, c.project_id, c.query FROM report_cache c
        WHERE c.fresh_until IS NOT NULL AND c.fresh_until < ? AND c.last_read_at >= ? AND c.access_error IS NULL
          AND NOT EXISTS (SELECT 1 FROM sync_jobs j WHERE j.scope = c.scope AND j.cache_key = c.cache_key AND j.status IN ('queued', 'running'))
        ORDER BY c.fresh_until LIMIT ?`,
    )
    .all(now, now - opts.activeSinceMs, opts.limit)) as Array<{ kind: string; user_id: number; project_id: number | null; query: unknown }>;
  let n = 0;
  for (const r of due) {
    const k = kindOf(r.kind);
    if (!k || k.manualOnly) continue;
    await enqueue({ kind: r.kind, userId: Number(r.user_id), projectId: r.project_id == null ? null : Number(r.project_id), query: parse(r.query), reason: "schedule" });
    n++;
  }
  return n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads a result through the cache (see the header). The caller has already checked that the user may see this
 * project. `force` is a manual refresh: it joins any open job and respects a cooldown on recent results.
 */
export async function readThrough<Q, P>(opts: { kind: string; userId: number; projectId: number | null; query: Q; waitMs?: number; force?: boolean }): Promise<ReadResult<P>> {
  const scope = scopeOf(opts.userId);
  const key = cacheKey(opts.kind, opts.query);
  const now = Date.now();
  const row = await readRow(scope, key);
  const usable = row && row.payload != null && !row.access_error;
  const fresh = usable && Number(row!.fresh_until ?? 0) > now;
  await db
    .prepare(`UPDATE report_cache SET ${fresh ? "hits = hits + 1" : "misses = misses + 1"}, last_read_at = ? WHERE scope = ? AND cache_key = ?`)
    .run(now, scope, key);
  const base = usable ? { payload: parse(row!.payload) as P, fetchedAt: row!.fetched_at == null ? null : Number(row!.fetched_at), dataThrough: row!.data_through } : {};
  if (row?.access_error) {
    // Never serve it. Try again — once, joined by every reader — on a manual refresh or after ACCESS_RETRY_MS, so
    // reconnecting an account or fixing a mapping recovers without anyone clearing the cache.
    if (opts.force || Number(row.last_error_at ?? 0) < now - ACCESS_RETRY_MS) {
      const jobId = await enqueue({ kind: opts.kind, userId: opts.userId, projectId: opts.projectId, query: opts.query, reason: opts.force ? "manual" : "stale" });
      background(async () => {
        await runJob(jobId);
      });
      return { state: "error", error: row.access_error, refreshing: true, jobId };
    }
    return { state: "error", error: row.access_error };
  }

  if (fresh && !opts.force) return { state: "fresh", ...base };
  // A manual-only dataset is never fetched by a plain read, stale or cold: only by an explicit refresh.
  if (!opts.force && kindOf(opts.kind)?.manualOnly) return usable ? { state: "stale", ...base, refreshing: false, error: row!.last_error } : { state: "pending", refreshing: false };
  if (fresh && opts.force && Number(row!.fetched_at ?? 0) > now - MANUAL_COOLDOWN_MS) return { state: "fresh", ...base, cooldown: true };

  const jobId = await enqueue({ kind: opts.kind, userId: opts.userId, projectId: opts.projectId, query: opts.query, reason: opts.force ? "manual" : usable ? "stale" : "cold" });
  if (usable) {
    background(async () => {
      await runJob(jobId);
    });
    return { state: "stale", ...base, refreshing: true, jobId, error: row!.last_error };
  }

  // Cold miss: the row was just created by enqueue, so record this read now (the scheduler refreshes what's read).
  if (!row) await db.prepare("UPDATE report_cache SET misses = misses + 1, last_read_at = ? WHERE scope = ? AND cache_key = ?").run(now, scope, key);
  // Run it here if nobody else holds it; otherwise wait a little for whoever does.
  await runJob(jobId);
  const deadline = Date.now() + (opts.waitMs ?? 20_000);
  for (;;) {
    const r = await readRow(scope, key);
    if (r && r.payload != null && !r.access_error && Number(r.generation) >= jobId) {
      return { state: "fresh", payload: parse(r.payload) as P, fetchedAt: Number(r.fetched_at), dataThrough: r.data_through, jobId };
    }
    const j = (await db.prepare("SELECT status, error, run_after FROM sync_jobs WHERE id = ?").get(jobId)) as { status: string; error: string | null; run_after: number } | undefined;
    if (r?.access_error) return { state: "error", error: r.access_error, jobId };
    if (j?.status === "failed") return { state: "error", error: j.error ?? "The refresh failed.", jobId };
    // Backing off after an error (or waiting for a provider's limit): say so now instead of holding the request.
    if (j?.status === "queued" && j.error && Number(j.run_after) > Date.now()) return { state: "error", error: j.error, refreshing: true, jobId };
    if (j?.status === "done" && r?.payload != null) return { state: "fresh", payload: parse(r.payload) as P, fetchedAt: Number(r.fetched_at), dataThrough: r.data_through, jobId };
    if (Date.now() >= deadline) return { state: "pending", jobId, refreshing: true, error: j?.error ?? null };
    await sleep(POLL_MS);
  }
}

/** Drops cached results for a project (e.g. after its mappings change) so the next read refetches. */
export async function invalidateProject(projectId: number, kinds?: string[]): Promise<void> {
  if (!(await syncReady())) return;
  if (kinds?.length) {
    for (const k of kinds) await db.prepare("UPDATE report_cache SET fresh_until = 0 WHERE project_id = ? AND kind = ?").run(projectId, k);
  } else {
    await db.prepare("UPDATE report_cache SET fresh_until = 0 WHERE project_id = ?").run(projectId);
  }
}

/**
 * The saved result for a query without queuing anything (no provider request, no job): for datasets that must only
 * refresh on an explicit, possibly chargeable action (SE Ranking backlink profile), and for summary panels that
 * show a module's data only when it has already been fetched.
 */
export async function peek<P>(opts: { kind: string; userId: number; query: unknown }): Promise<{ payload: P | null; fetchedAt: number | null; lastError: string | null; accessError: string | null; refreshing: boolean }> {
  const scope = scopeOf(opts.userId);
  const key = cacheKey(opts.kind, opts.query);
  const row = await readRow(scope, key);
  const open = (await db.prepare("SELECT 1 FROM sync_jobs WHERE scope = ? AND cache_key = ? AND status IN ('queued', 'running')").get(scope, key)) as unknown;
  return {
    payload: row && row.payload != null && !row.access_error ? (parse(row.payload) as P) : null,
    fetchedAt: row?.fetched_at == null ? null : Number(row.fetched_at),
    lastError: row?.last_error ?? null,
    accessError: row?.access_error ?? null,
    refreshing: Boolean(open),
  };
}
