import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { accessTokenFor } from "@/lib/google/oauth";
import { inspectUrl } from "@/lib/google/searchconsole";
import { db } from "@/lib/db";
import { siteIdFor } from "@/lib/metrics";

// Cache window: avoid re-spending the 2,000/day URL Inspection quota on repeats.
const CACHE_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { property, url, force } = (await req.json().catch(() => ({}))) as {
    property?: string;
    url?: string;
    force?: boolean;
  };
  if (!property || !url) {
    return NextResponse.json({ error: "property and url required" }, { status: 400 });
  }
  const siteId = await siteIdFor(user.id, property);
  if (!siteId) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  const cached = (await db
    .prepare("SELECT * FROM url_inspections WHERE site_id = ? AND url = ?")
    .get(siteId, url)) as (Record<string, unknown> & { inspected_at: number }) | undefined;

  if (!force && cached && Date.now() - cached.inspected_at < CACHE_MS) {
    return NextResponse.json({ cached: true, result: cached });
  }

  try {
    const token = await accessTokenFor(user);
    const r = await inspectUrl(token, property, url);
    const idx = r.indexStatusResult ?? {};
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO url_inspections
         (site_id, url, inspected_at, verdict, coverage_state, robots_txt_state, indexing_state,
          page_fetch_state, last_crawl_time, google_canonical, user_canonical, crawled_as, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id, url) DO UPDATE SET
         inspected_at = excluded.inspected_at, verdict = excluded.verdict,
         coverage_state = excluded.coverage_state, robots_txt_state = excluded.robots_txt_state,
         indexing_state = excluded.indexing_state, page_fetch_state = excluded.page_fetch_state,
         last_crawl_time = excluded.last_crawl_time, google_canonical = excluded.google_canonical,
         user_canonical = excluded.user_canonical, crawled_as = excluded.crawled_as,
         raw_json = excluded.raw_json`,
      )
      .run(
        siteId,
        url,
        now,
        idx.verdict ?? null,
        idx.coverageState ?? null,
        idx.robotsTxtState ?? null,
        idx.indexingState ?? null,
        idx.pageFetchState ?? null,
        idx.lastCrawlTime ?? null,
        idx.googleCanonical ?? null,
        idx.userCanonical ?? null,
        idx.crawledAs ?? null,
        JSON.stringify(r),
      );

    const saved = await db
      .prepare("SELECT * FROM url_inspections WHERE site_id = ? AND url = ?")
      .get(siteId, url);
    return NextResponse.json({ cached: false, result: saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
