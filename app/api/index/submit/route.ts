import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { accessTokenFor } from "@/lib/google/oauth";
import { submitUrls, type SiteRow } from "@/lib/indexer";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    property?: string;
    urls?: string[];
    url?: string;
  };
  const urls = (body.urls ?? (body.url ? [body.url] : [])).filter(Boolean);
  if (!body.property || !urls.length) {
    return NextResponse.json({ error: "property and url(s) required" }, { status: 400 });
  }
  if (urls.length > 100) {
    return NextResponse.json({ error: "max 100 URLs per request" }, { status: 400 });
  }

  const site = db
    .prepare("SELECT id, user_id, source, property FROM sites WHERE user_id = ? AND property = ?")
    .get(user.id, body.property) as SiteRow | undefined;
  if (!site) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  const results = await submitUrls(site, urls, token);
  const failed = results.filter((r) => !r.ok);

  // A 403 with "insufficient authentication scopes" means the user connected
  // before the indexing scope was added — tell them to reconnect.
  const needsReconnect = failed.some((r) => /insufficient|scope|403/i.test(r.message));

  return NextResponse.json({
    submitted: results.filter((r) => r.ok).length,
    failed: failed.length,
    needsReconnect,
    results,
  });
}
