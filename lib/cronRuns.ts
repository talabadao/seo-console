// Persistent record of authenticated scheduled runs (migration 0012 cron_runs), so a cron that ran with nothing
// to do is distinguishable from one that never ran. Called only after a route has verified CRON_SECRET; refused
// requests leave no row. Stores counts and a short sanitized error, never secrets or request data. Retention:
// RETAIN_DAYS and at most MAX_ROWS rows. Before the migration runs, every call is a no-op.

import { db, tableExists } from "@/lib/db";

export const RETAIN_DAYS = 60;
export const MAX_ROWS = 2000;

export interface CronOutcome {
  status: "ok" | "error";
  processed?: number;
  queued?: number;
  skipped?: number;
  details?: Record<string, number | string | boolean | null>;
  error?: unknown;
}

/** A short error summary without connection strings, keys, tokens or email addresses. */
export function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return raw
    .replace(/postgres(ql)?:\/\/\S+/gi, "<db-url>")
    .replace(/\b(Bearer|Token)\s+\S+/gi, "$1 <redacted>")
    .replace(/([?&](api_key|key|token|access_token|password)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<redacted>")
    .slice(0, 300);
}

export async function cronStart(job: string): Promise<number | null> {
  if (!(await tableExists("cron_runs"))) return null;
  const row = (await db.prepare("INSERT INTO cron_runs (job, started_at, status) VALUES (?, ?, 'running') RETURNING id").get(job, Date.now())) as { id: number };
  return Number(row.id);
}

export async function cronFinish(id: number | null, o: CronOutcome): Promise<void> {
  if (id == null) return;
  await db
    .prepare("UPDATE cron_runs SET finished_at = ?, status = ?, processed = ?, queued = ?, skipped = ?, details = ?::jsonb, error = ? WHERE id = ?")
    .run(Date.now(), o.status, o.processed ?? 0, o.queued ?? 0, o.skipped ?? 0, o.details ? JSON.stringify(o.details) : null, o.error ? sanitizeError(o.error) : null, id);
  // Bounded retention.
  await db.prepare("DELETE FROM cron_runs WHERE started_at < ?").run(Date.now() - RETAIN_DAYS * 86_400_000);
  await db.prepare("DELETE FROM cron_runs WHERE id <= (SELECT id FROM cron_runs ORDER BY id DESC OFFSET ? LIMIT 1)").run(MAX_ROWS);
}

/** Runs `fn` as a recorded scheduled run; errors are recorded and re-thrown. */
export async function recordCron<T extends CronOutcome>(job: string, fn: () => Promise<T>): Promise<T> {
  const id = await cronStart(job);
  try {
    const out = await fn();
    await cronFinish(id, out);
    return out;
  } catch (e) {
    await cronFinish(id, { status: "error", error: e });
    throw e;
  }
}

export interface CronRunRow {
  id: number;
  job: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  status: string;
  processed: number;
  queued: number;
  skipped: number;
  details: Record<string, unknown> | null;
  error: string | null;
}

export async function recentCronRuns(limit = 30): Promise<CronRunRow[] | null> {
  if (!(await tableExists("cron_runs"))) return null;
  const rows = (await db.prepare("SELECT * FROM cron_runs ORDER BY started_at DESC, id DESC LIMIT ?").all(Math.min(200, limit))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    job: String(r.job),
    startedAt: Number(r.started_at),
    finishedAt: r.finished_at == null ? null : Number(r.finished_at),
    durationMs: r.finished_at == null ? null : Number(r.finished_at) - Number(r.started_at),
    status: String(r.status),
    processed: Number(r.processed),
    queued: Number(r.queued),
    skipped: Number(r.skipped),
    details: (typeof r.details === "string" ? JSON.parse(r.details) : (r.details as Record<string, unknown> | null)) ?? null,
    error: (r.error as string | null) ?? null,
  }));
}
