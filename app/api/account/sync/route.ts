import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { runDueJobs, syncReady } from "@/lib/sync/cache";
import { syncStatus } from "@/lib/sync/status";
import "@/lib/sync/kinds";
import { runRules } from "@/lib/notifications/store";

export const maxDuration = 60;

/** Sync & cache status for the signed-in account, from local records only (no provider requests). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await syncReady())) return NextResponse.json({ error: "This database hasn't run migration 0008 (shared cache) yet.", state: "unavailable" }, { status: 503 });
  return NextResponse.json(await syncStatus(user.id), { headers: { "Cache-Control": "no-store" } });
}

/**
 * Runs this account's due jobs now — at most 10, for at most 45 seconds — for when no schedule runs (Preview,
 * or between Hobby-plan cron ticks). Only this account's jobs; the same leases, limits and cool-downs apply.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await syncReady())) return NextResponse.json({ error: "This database hasn't run migration 0008 (shared cache) yet." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
  const limit = Math.max(1, Math.min(10, Math.round(Number(body.limit) || 10)));
  const result = await runDueJobs({ limit, budgetMs: 45_000, userId: user.id });
  // New results may meet a notification rule (saved results only; throttled per account).
  const notified = (await runRules(user.id).catch(() => ({ created: 0 }))).created;
  return NextResponse.json({ ...result, notified, status: await syncStatus(user.id) });
}
