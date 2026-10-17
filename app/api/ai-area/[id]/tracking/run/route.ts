import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guard, type Ctx } from "@/lib/ai-area/api";
import { beginTracking, continueTracking } from "@/lib/ai-area/tracking/job";
import { RunInProgress } from "@/lib/ai-area/runs";

export const maxDuration = 300;

/**
 * Starts a tracking run ({}), or continues one ({ runId }). Each call runs one time-boxed chunk; the page calls
 * again until `finished`. Only a signed-in owner of the project can run it; there is no unauthenticated
 * cron path here (scheduled runs are off in this phase).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown; keywordIds?: unknown };
  try {
    let runId = typeof body.runId === "string" ? body.runId : null;
    let estimate = null;
    if (!runId) {
      const keywordIds = Array.isArray(body.keywordIds) ? body.keywordIds.map(String) : undefined;
      ({ runId, estimate } = await beginTracking(g.user, g.project, keywordIds));
    }
    const result = await continueTracking(g.user, g.project, runId);
    return NextResponse.json({ runId, estimate, ...result });
  } catch (e) {
    if (e instanceof RunInProgress) return errorResponse(e, 409);
    return errorResponse(e, 400);
  }
}
