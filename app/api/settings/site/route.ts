import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { saveSiteConfig, siteConfigFor } from "@/lib/siteConfig";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const property = req.nextUrl.searchParams.get("property");
  if (!property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const sc = await siteConfigFor(user.id, property);
  if (!sc) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  return NextResponse.json(sc.config);
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    property?: string;
    brandTerms?: string[];
    longtailMinWords?: number;
    aiPosOp?: "=" | "<=" | ">=";
    aiPosValue?: number;
    aiImprMax?: number;
  };
  if (!body.property) return NextResponse.json({ error: "property required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (Array.isArray(body.brandTerms))
    patch.brandTerms = body.brandTerms.map((s) => String(s).trim()).filter(Boolean);
  if (typeof body.longtailMinWords === "number")
    patch.longtailMinWords = Math.max(1, Math.round(body.longtailMinWords));
  if (body.aiPosOp) patch.aiPosOp = body.aiPosOp;
  if (typeof body.aiPosValue === "number") patch.aiPosValue = body.aiPosValue;
  if (typeof body.aiImprMax === "number") patch.aiImprMax = Math.max(1, Math.round(body.aiImprMax));

  const merged = await saveSiteConfig(user.id, body.property, patch);
  if (!merged) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  return NextResponse.json(merged);
}
