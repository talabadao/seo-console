import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { ownsGaProperty } from "@/lib/gaConfig";
import { configFor, reportWindows } from "@/lib/weeklyReport";
import { getProject, projectTaskBuckets } from "@/lib/asana";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.asana_api_token) {
    return NextResponse.json({ needsAsanaConnect: true }, { status: 200 });
  }

  const p = req.nextUrl.searchParams;
  const propertyId = p.get("propertyId");
  if (!propertyId || !(await ownsGaProperty(user.id, propertyId))) {
    return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  }

  const w = reportWindows();
  const config = await configFor(user.id, propertyId, w.yearMonth);
  const projectGid = config.asanaProjectGid.trim();
  if (!projectGid) {
    return NextResponse.json({ needsProject: true }, { status: 200 });
  }

  try {
    const [project, buckets] = await Promise.all([
      getProject(user.asana_api_token, projectGid),
      projectTaskBuckets(user.asana_api_token, projectGid),
    ]);
    return NextResponse.json({ project, ...buckets });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
