import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { siteConfigFor } from "@/lib/siteConfig";
import { indexDashboard } from "@/lib/indexer";
import { hasIndexingScope } from "@/lib/google/oauth";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const property = req.nextUrl.searchParams.get("property");
  if (!property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const sc = await siteConfigFor(user.id, property);
  if (!sc) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  const data = await indexDashboard(sc.siteId);
  return NextResponse.json({
    ...data,
    indexing: { ...data.indexing, hasScope: hasIndexingScope(user.google_scopes) },
  });
}
