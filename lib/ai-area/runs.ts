// AI Area runs (table ai_runs, migration 0003). At most one running run per project and kind, enforced by a
// partial unique index, so two clicks or two tabs can't start parallel runs (and can't double-spend a cap).
// A run that hasn't been touched for STALE_MS is treated as abandoned and released.

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

export const STALE_MS = 20 * 60_000;

export class RunInProgress extends Error {
  constructor() {
    super("A run is already in progress for this project. Wait for it to finish.");
    this.name = "RunInProgress";
  }
}

export interface RunRecord<E = unknown, A = unknown> {
  id: string;
  kind: string;
  status: "running" | "done" | "stopped" | "error";
  trigger: string;
  estimate: E | null;
  actual: A | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

function row<E, A>(r: Record<string, unknown>): RunRecord<E, A> {
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : null);
  return {
    id: String(r.id),
    kind: String(r.kind),
    status: r.status as RunRecord["status"],
    trigger: String(r.trigger),
    estimate: parse(r.estimate),
    actual: parse(r.actual),
    error: (r.error as string | null) ?? null,
    startedAt: Number(r.started_at),
    finishedAt: r.finished_at == null ? null : Number(r.finished_at),
  };
}

/** Starts a run, or throws RunInProgress. Releases abandoned runs first. */
export async function startRun<E>(userId: number, projectId: number, kind: string, trigger: string, estimate: E): Promise<string> {
  const now = Date.now();
  await db
    .prepare("UPDATE ai_runs SET status = 'error', error = 'Abandoned (no progress for 20 minutes)', finished_at = ? WHERE project_id = ? AND kind = ? AND status = 'running' AND COALESCE(finished_at, started_at) < ?")
    .run(now, projectId, kind, now - STALE_MS);
  const id = randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO ai_runs (id, user_id, project_id, kind, trigger, status, estimate, started_at, payer_user_id, origin_user_id, authorization_version)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, (SELECT spending_version FROM projects WHERE id = ?))`,
      )
      .run(id, userId, projectId, kind, trigger, JSON.stringify(estimate), now, userId, userId, projectId);
  } catch (e) {
    if (/ai_runs_one_running|duplicate key/i.test(e instanceof Error ? e.message : String(e))) throw new RunInProgress();
    throw e;
  }
  return id;
}

export async function getRun<E, A>(projectId: number, id: string): Promise<RunRecord<E, A> | null> {
  const r = (await db.prepare("SELECT * FROM ai_runs WHERE project_id = ? AND id = ?").get(projectId, id)) as Record<string, unknown> | undefined;
  return r ? row<E, A>(r) : null;
}

export async function latestRuns<E, A>(projectId: number, kind: string, limit = 10): Promise<RunRecord<E, A>[]> {
  const rows = (await db.prepare("SELECT * FROM ai_runs WHERE project_id = ? AND kind = ? ORDER BY started_at DESC LIMIT ?").all(projectId, kind, limit)) as Record<string, unknown>[];
  return rows.map((r) => row<E, A>(r));
}

/**
 * Claims a running run for one chunk of work, so two requests can't work on the same run at once (which
 * would send duplicate requests). Returns false when another request holds it.
 */
export async function claimRun(id: string, leaseMs: number): Promise<boolean> {
  const now = Date.now();
  const r = await db
    .prepare("UPDATE ai_runs SET lease_until = ? WHERE id = ? AND status = 'running' AND (lease_until IS NULL OR lease_until < ?) RETURNING id")
    .get(now + leaseMs, id, now);
  return Boolean(r);
}

export async function releaseRun(id: string): Promise<void> {
  await db.prepare("UPDATE ai_runs SET lease_until = NULL WHERE id = ?").run(id);
}

/** Saves progress. `finished_at` doubles as "last touched" while running, for the stale check. */
export async function progressRun(id: string, actual: unknown): Promise<void> {
  await db.prepare("UPDATE ai_runs SET actual = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(JSON.stringify(actual), Date.now(), id);
}

export async function finishRun(id: string, status: "done" | "stopped" | "error", actual: unknown, error?: string | null): Promise<void> {
  await db
    .prepare("UPDATE ai_runs SET status = ?, actual = ?, error = ?, finished_at = ? WHERE id = ?")
    .run(status, JSON.stringify(actual), error ?? null, Date.now(), id);
}
