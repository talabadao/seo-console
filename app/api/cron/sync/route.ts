import { NextRequest, NextResponse } from "next/server";
import { schedulesAllowed } from "@/lib/environment";
import { enqueueDueRefreshes, runDueJobs, syncReady } from "@/lib/sync/cache";
import "@/lib/sync/kinds";
import { recordCron, type CronOutcome } from "@/lib/cronRuns";
import { db } from "@/lib/db";
import { runRules } from "@/lib/notifications/store";

export const maxDuration = 300;

/**
 * Scheduled synchronization tick (Vercel Cron, see vercel.json). On the Hobby plan each cron entry runs once a
 * day within its hour, so several daily entries spread through the day give a refresh roughly every four hours.
 * Each tick:
 * 1. queues one refresh for every cached result that is past its refresh time and was read in the last 7 days
 *    (projects nobody opens aren't refreshed), then
 * 2. runs due jobs — including any whose worker stopped — until the time budget is used, then
 * 3. runs the in-app notification rules for accounts with recent reads (from saved results only).
 * Production only, never on Preview; requires Authorization: Bearer $CRON_SECRET (Vercel sends it).
 */
export async function GET(req: NextRequest) {
  if (!schedulesAllowed()) return NextResponse.json({ skipped: "schedules run in production only" });
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Authenticated from here on: recorded in cron_runs (a refused request above leaves no record).
  const result = await recordCron("sync", async (): Promise<CronOutcome> => {
    if (!(await syncReady())) return { status: "ok", details: { note: "migration 0008 has not run" } };
    const queued = await enqueueDueRefreshes({ activeSinceMs: 7 * 24 * 3600_000, limit: 500 });
    const run = await runDueJobs({ limit: 400, budgetMs: 240_000 });
    const users = (await db.prepare("SELECT DISTINCT user_id FROM report_cache WHERE last_read_at >= ?").all(Date.now() - 7 * 24 * 3600_000)) as Array<{ user_id: number }>;
    let notified = 0;
    for (const u of users) notified += (await runRules(Number(u.user_id), { force: true }).catch(() => ({ created: 0 }))).created;
    return {
      status: "ok" as const,
      queued,
      processed: run.ran,
      skipped: run.outcomes.skipped ?? 0,
      details: { done: run.outcomes.done ?? 0, failed: run.outcomes.failed ?? 0, requeued: run.outcomes.requeued ?? 0, notified },
    };
  });
  return NextResponse.json(result);
}
