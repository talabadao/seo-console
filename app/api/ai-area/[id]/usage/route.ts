import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { usageReport } from "@/lib/providers/usageReport";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Usage & Costs for one project: provider-reported (account-wide), app-recorded and estimated figures, caps
 * and recent runs. ?days=7|30|90 (default 30). Free reads only; works before migration 0003 (recorded
 * figures are then empty).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  const days = [7, 30, 90].includes(Number(req.nextUrl.searchParams.get("days"))) ? Number(req.nextUrl.searchParams.get("days")) : 30;
  try {
    return NextResponse.json({ days, report: await usageReport(user.id, project.id, Date.now() - days * 86_400_000) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
