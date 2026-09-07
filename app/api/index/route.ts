import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { siteConfigFor } from "@/lib/siteConfig";
import { indexDashboard } from "@/lib/indexer";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const property = req.nextUrl.searchParams.get("property");
  if (!property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const sc = siteConfigFor(user.id, property);
  if (!sc) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  return NextResponse.json(indexDashboard(sc.siteId));
}
