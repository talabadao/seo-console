import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { autoIndexConfigFor, saveAutoIndexConfig, type AutoIndexConfig } from "@/lib/siteConfig";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const property = req.nextUrl.searchParams.get("property");
  if (!property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const cfg = await autoIndexConfigFor(user.id, property);
  if (!cfg) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  return NextResponse.json(cfg.config);
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    property?: string;
    autoIndexEnabled?: boolean;
    autoIndexCap?: number;
    autoIndexHour?: number;
  };
  if (!body.property) return NextResponse.json({ error: "property required" }, { status: 400 });

  const patch: Partial<AutoIndexConfig> = {};
  if (typeof body.autoIndexEnabled === "boolean") patch.autoIndexEnabled = body.autoIndexEnabled;
  if (typeof body.autoIndexCap === "number")
    patch.autoIndexCap = Math.max(1, Math.round(body.autoIndexCap));
  if (typeof body.autoIndexHour === "number")
    patch.autoIndexHour = Math.max(0, Math.min(23, Math.round(body.autoIndexHour)));

  const merged = await saveAutoIndexConfig(user.id, body.property, patch);
  if (!merged) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  return NextResponse.json(merged);
}
