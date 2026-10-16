import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { usageReport } from "@/lib/providers/usageReport";

/**
 * Usage & Costs for the signed-in account: ?project=<id> narrows recorded usage and limits to one of the
 * account's projects; without it the report is account-wide with a per-project breakdown. ?days=7|30|90
 * (default 30). Free reads only; works before migration 0003 (recorded figures are then empty).
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const days = [7, 30, 90].includes(Number(p.get("days"))) ? Number(p.get("days")) : 30;
  let projectId: number | null = null;
  const raw = p.get("project");
  if (raw && raw !== "all") {
    const id = Number(raw);
    const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
    if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
    projectId = project.id;
  }
  try {
    return NextResponse.json({ days, report: await usageReport(user.id, projectId, Date.now() - days * 86_400_000) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
