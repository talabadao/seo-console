import { NextRequest, NextResponse } from "next/server";
import { PREVIEW_WRITES_BLOCKED, externalWritesAllowed } from "@/lib/environment";
import { currentUser } from "@/lib/session";
import { reviewContext } from "@/lib/reviewContext";
import { syncReviews } from "@/lib/reviews";
import { meterSerpSearch } from "@/lib/providers/serpapi";
import { keyFingerprint } from "@/lib/providers/ledger";

export const maxDuration = 300;

/**
 * Fetches reviews through SerpApi — only ever on an explicit request, since
 * each page costs a credit. `mode: "refresh"` picks up new reviews; "older"
 * extends history from where the last run stopped. `max` caps new reviews.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!externalWritesAllowed()) return NextResponse.json({ error: PREVIEW_WRITES_BLOCKED }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: number; mode?: string; max?: number };
  const ctx = await reviewContext(user.id, Number(body.projectId), { manage: true });
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const max = Math.min(5000, Math.max(8, Math.round(Number(body.max)) || 200));
  try {
    return NextResponse.json(
      await syncReviews(ctx.project, ctx.key!, {
        mode: body.mode === "older" ? "older" : "refresh",
        max,
        budgetMs: 230_000,
        // Same SerpApi limits and ledger as the AI Area: one budget per project and account.
        meter: (operation) => meterSerpSearch({ userId: user.id, projectId: ctx.project.id, fingerprint: keyFingerprint(ctx.key!) }, operation),
      }),
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
