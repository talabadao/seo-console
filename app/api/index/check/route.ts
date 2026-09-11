import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { discoverSitemapUrls, runIndexCheck, type SiteRow } from "@/lib/indexer";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    property?: string;
    sitemapUrl?: string;
    discover?: boolean;
    max?: number;
  };
  if (!body.property) return NextResponse.json({ error: "property required" }, { status: 400 });

  const site = (await db
    .prepare("SELECT id, user_id, source, property FROM sites WHERE user_id = ? AND property = ? AND source = 'google'")
    .get(user.id, body.property)) as SiteRow | undefined;
  if (!site) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  let discovered: number | undefined;
  if (body.discover || body.sitemapUrl) {
    const d = await discoverSitemapUrls(user, site, body.sitemapUrl);
    discovered = d.found;
  }

  const result = await runIndexCheck(user, site, { max: body.max, interactive: true });
  return NextResponse.json({ discovered, ...result });
}
