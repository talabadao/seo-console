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
    sitemapXml?: string;
    discover?: boolean;
    // When set, only run sitemap discovery and skip inspection this call —
    // discovery (up to 50 sitemap fetches) plus a full inspection batch in
    // the same request pushed this close to the platform's time limit; the
    // Indexing tab now sends discovery as its own first round and inspects
    // in the rounds after.
    discoverOnly?: boolean;
    max?: number;
  };
  if (!body.property) return NextResponse.json({ error: "property required" }, { status: 400 });

  const site = (await db
    .prepare("SELECT id, user_id, source, property FROM sites WHERE user_id = ? AND property = ? AND source = 'google'")
    .get(user.id, body.property)) as SiteRow | undefined;
  if (!site) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  let discovered: number | undefined;
  if (body.discover || body.sitemapUrl || body.sitemapXml) {
    const d = await discoverSitemapUrls(user, site, body.sitemapUrl, body.sitemapXml);
    discovered = d.found;
  }
  if (body.discoverOnly) {
    return NextResponse.json({ discovered, checked: 0 });
  }

  const result = await runIndexCheck(user, site, { max: body.max, interactive: true });
  return NextResponse.json({ discovered, ...result });
}
