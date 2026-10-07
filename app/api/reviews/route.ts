import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { reviewContext } from "@/lib/reviewContext";
import { reviewsData } from "@/lib/reviews";

/** Saved reviews plus the SerpApi balance. Reads storage only — spends no credits. */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ctx = await reviewContext(user.id, Number(req.nextUrl.searchParams.get("projectId")));
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  return NextResponse.json(await reviewsData(ctx.project, ctx.key));
}
