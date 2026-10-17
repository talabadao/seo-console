import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guard, type Ctx } from "@/lib/ai-area/api";
import { beginBrandRun, continueBrandRun } from "@/lib/ai-area/brand/run";
import { RunInProgress } from "@/lib/ai-area/runs";

export const maxDuration = 300;

/**
 * Starts a Brand Mentions run ({}) — continuing the unfinished cycle if there is one — or continues a run
 * ({ runId }). Each call runs one time-boxed chunk; the page calls again until `finished`. Signed-in project
 * owners only; there's no cron path (scheduled runs are off in this phase).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx, { manage: true });
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown };
  try {
    let runId = typeof body.runId === "string" ? body.runId : null;
    let estimate = null;
    if (!runId) ({ runId, estimate } = await beginBrandRun(g.user, g.project));
    const step = await continueBrandRun(g.user, g.project, runId);
    return NextResponse.json({ runId, estimate, ...step });
  } catch (e) {
    if (e instanceof RunInProgress) return errorResponse(e, 409);
    return errorResponse(e, 400);
  }
}
