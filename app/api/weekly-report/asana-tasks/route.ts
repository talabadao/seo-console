import { NextRequest, NextResponse } from "next/server";
import { gaForProperty, isDenied, viewer } from "@/lib/access";
import { configFor, reportWindows } from "@/lib/weeklyReport";
import { getProject, projectTaskBuckets } from "@/lib/asana";
import { AsanaUnavailableError, asanaToken } from "@/lib/asanaConnections";

export const maxDuration = 60;

/** Asana tasks for the Weekly report, read through the project's Asana reporting connection (any team member). */
export async function GET(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const p = req.nextUrl.searchParams;
  const propertyId = p.get("propertyId");
  const ga = propertyId ? await gaForProperty(user, propertyId) : null;
  if (!ga || !propertyId) return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  if (ga.project.asanaConnectionId == null) return NextResponse.json({ needsAsanaConnect: true }, { status: 200 });

  const w = reportWindows();
  const config = await configFor(user.id, propertyId, w.yearMonth);
  const projectGid = config.asanaProjectGid.trim();
  if (!projectGid) {
    return NextResponse.json({ needsProject: true }, { status: 200 });
  }

  try {
    const token = await asanaToken(ga.project.asanaConnectionId);
    const [project, buckets] = await Promise.all([getProject(token, projectGid), projectTaskBuckets(token, projectGid)]);
    return NextResponse.json({ project, ...buckets });
  } catch (e) {
    if (e instanceof AsanaUnavailableError) return NextResponse.json({ needsAsanaConnect: true, error: e.message }, { status: 200 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
