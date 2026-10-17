import { NextRequest, NextResponse } from "next/server";
import { gscForProperty, isDenied, managementRequired, viewer } from "@/lib/access";
import { autoIndexConfigFor, saveAutoIndexConfig, type AutoIndexConfig } from "@/lib/siteConfig";

/** Scheduled URL-inspection settings of a property mapped by a visible project. */
export async function GET(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const property = req.nextUrl.searchParams.get("property");
  if (!property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const gsc = await gscForProperty(user, property, req.nextUrl.searchParams.get("projectId"));
  const cfg = gsc?.siteId != null ? await autoIndexConfigFor(gsc.siteId) : null;
  if (!gsc || !cfg) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  return NextResponse.json({ ...cfg.config, canManage: gsc.project.canManage });
}

/** Changes the schedule (it spends the shared connection's inspection quota): managers only. */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as {
    property?: string;
    projectId?: number;
    autoIndexEnabled?: boolean;
    autoIndexCap?: number;
    autoIndexHour?: number;
  };
  if (!body.property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const gsc = await gscForProperty(user, body.property, body.projectId);
  if (!gsc || gsc.siteId == null) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  if (!gsc.project.canManage) return managementRequired(gsc.project);

  const patch: Partial<AutoIndexConfig> = {};
  if (typeof body.autoIndexEnabled === "boolean") patch.autoIndexEnabled = body.autoIndexEnabled;
  if (typeof body.autoIndexCap === "number") patch.autoIndexCap = Math.max(1, Math.round(body.autoIndexCap));
  if (typeof body.autoIndexHour === "number") patch.autoIndexHour = Math.max(0, Math.min(23, Math.round(body.autoIndexHour)));

  const merged = await saveAutoIndexConfig(gsc.siteId, patch);
  if (!merged) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  return NextResponse.json(merged);
}
