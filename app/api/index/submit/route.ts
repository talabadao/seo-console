import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { submitUrls, type SiteRow } from "@/lib/indexer";
import { indexingConfigured } from "@/lib/google/indexingApi";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!indexingConfigured()) {
    return NextResponse.json(
      {
        error:
          "Indexing API not configured. Add a service-account key (GOOGLE_SA_KEY_FILE) and make it an Owner in Search Console — see README.",
      },
      { status: 400 },
    );
  }

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

  const results = await submitUrls(site, urls);
  return NextResponse.json({
    submitted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
