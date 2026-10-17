import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { siteConfigFor } from "@/lib/siteConfig";
import { indexDashboard } from "@/lib/indexer";
import { INDEXING_SCOPE } from "@/lib/google/oauth";
import { connectionHasScope, gscForProperty } from "@/lib/access";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const property = req.nextUrl.searchParams.get("property");
  if (!property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const gsc = await gscForProperty(user, property, req.nextUrl.searchParams.get("projectId"));
  const sc = gsc?.siteId != null ? await siteConfigFor(gsc.siteId) : null;
  if (!gsc || !sc) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  const data = await indexDashboard(sc.siteId);
  return NextResponse.json({
    ...data,
    canManage: gsc.project.canManage,
    indexing: { ...data.indexing, hasScope: await connectionHasScope(gsc.connectionId, INDEXING_SCOPE) },
  });
}
