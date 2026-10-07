import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { reviewContext } from "@/lib/reviewContext";
import { classifyPending } from "@/lib/reviews";

export const maxDuration = 300;

/**
 * Analyses not-yet-classified reviews for up to ~3 minutes and reports how
 * many are left; the Reviews tab calls it again until none remain.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: number };
  const ctx = await reviewContext(user.id, Number(body.projectId));
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  return NextResponse.json(await classifyPending(ctx.project, 170_000));
}
