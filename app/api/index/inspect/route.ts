import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { inspectUrlsLive, type SiteRow } from "@/lib/indexer";

export const maxDuration = 300;

// Live, on-demand URL Inspection: each URL is inspected against Google's API in
// real time (not read from the stored snapshot) and the fresh result returned.
// Capped per request so one HTTP round trip finishes inside the function budget;
// the Indexing tab sends larger pasted lists in several batches.
const MAX_PER_REQUEST = 25;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { property?: string; urls?: string[] };
  if (!body.property) return NextResponse.json({ error: "property required" }, { status: 400 });

  const urls = (Array.isArray(body.urls) ? body.urls : []).map(String).filter((u) => u.trim());
  if (!urls.length) return NextResponse.json({ error: "no URLs provided" }, { status: 400 });

  const site = (await db
    .prepare(
      "SELECT id, user_id, source, property FROM sites WHERE user_id = ? AND property = ? AND source = 'google'",
    )
    .get(user.id, body.property)) as SiteRow | undefined;
  if (!site) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  const batch = urls.slice(0, MAX_PER_REQUEST);
  const result = await inspectUrlsLive(user, site, batch);
  return NextResponse.json({ ...result, truncated: urls.length > MAX_PER_REQUEST });
}
