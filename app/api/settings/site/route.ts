import { NextRequest, NextResponse } from "next/server";
import { gscForProperty, isDenied, managementRequired, viewer } from "@/lib/access";
import { saveSiteConfig, siteConfigFor } from "@/lib/siteConfig";

/** Search filter settings (brand terms, long-tail, AI-prompt rules) of a property mapped by a visible project. */
export async function GET(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const property = req.nextUrl.searchParams.get("property");
  if (!property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const gsc = await gscForProperty(user, property, req.nextUrl.searchParams.get("projectId"));
  const sc = gsc?.siteId != null ? await siteConfigFor(gsc.siteId) : null;
  if (!gsc || !sc) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  return NextResponse.json({ ...sc.config, canManage: gsc.project.canManage });
}

/** Saves them: a management action on a project that maps the property (shared by every viewer of it). */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as {
    property?: string;
    projectId?: number;
    brandTerms?: string[];
    longtailMinWords?: number;
    aiPosOp?: "=" | "<=" | ">=";
    aiPosValue?: number;
    aiImprMax?: number;
  };
  if (!body.property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const gsc = await gscForProperty(user, body.property, body.projectId);
  if (!gsc || gsc.siteId == null) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  if (!gsc.project.canManage) return managementRequired(gsc.project);

  const patch: Record<string, unknown> = {};
  if (Array.isArray(body.brandTerms)) patch.brandTerms = body.brandTerms.map((s) => String(s).trim()).filter(Boolean);
  if (typeof body.longtailMinWords === "number") patch.longtailMinWords = Math.max(1, Math.round(body.longtailMinWords));
  if (body.aiPosOp) patch.aiPosOp = body.aiPosOp;
  if (typeof body.aiPosValue === "number") patch.aiPosValue = body.aiPosValue;
  if (typeof body.aiImprMax === "number") patch.aiImprMax = Math.max(1, Math.round(body.aiImprMax));

  const merged = await saveSiteConfig(gsc.siteId, patch);
  if (!merged) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  return NextResponse.json(merged);
}
