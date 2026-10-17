import { NextRequest, NextResponse } from "next/server";
import { gscForProperty, isDenied, managementRequired, viewer } from "@/lib/access";
import { syncGoogleSite, syncManagedProjects, type SiteRow } from "@/lib/sync";

export const maxDuration = 300;

/**
 * Explicit Search Console sync (a free reporting refresh): one property, which must be mapped by a project the
 * signed-in User manages, or, without a property, every project they manage. Viewers can't start syncs.
 */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { property?: string; projectId?: number };
  if (!body.property) return NextResponse.json({ results: await syncManagedProjects(user.id) });
  const access = await gscForProperty(user, body.property, body.projectId);
  if (!access || access.siteId == null) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  if (!access.project.canManage) return managementRequired(access.project);
  const site: SiteRow = { id: access.siteId, user_id: 0, source: "google", property: access.property };
  return NextResponse.json({ result: await syncGoogleSite(access, site) });
}
