import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { GoogleReauthRequiredError, accessTokenFor } from "@/lib/google/oauth";
import { searchAnalyticsAll, type SearchType } from "@/lib/google/searchconsole";
import { siteConfigFor } from "@/lib/siteConfig";

export const maxDuration = 120;

const SEARCH_TYPES: SearchType[] = ["web", "image", "video", "news", "discover"];

/**
 * For the Queries CSV export: the URL that ranks for each query in a date
 * range — the page with the most clicks for that query (impressions break
 * ties). Search Console returns query+page pairs ordered by clicks, capped at
 * 50,000 pairs, so very long-tail queries on large sites can come back without
 * a URL.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const property = p.get("property");
  const start = p.get("start");
  const end = p.get("end");
  if (!property || !start || !end) {
    return NextResponse.json({ error: "property, start and end required" }, { status: 400 });
  }
  if (!(await siteConfigFor(user.id, property))) {
    return NextResponse.json({ error: "unknown property" }, { status: 404 });
  }
  const type = (SEARCH_TYPES.includes((p.get("searchType") || "web") as SearchType)
    ? p.get("searchType")
    : "web") as SearchType;
  const filterPage = p.get("filterPage") || "";

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    if (e instanceof GoogleReauthRequiredError) return NextResponse.json({ needsReconnect: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  try {
    const rows = await searchAnalyticsAll(
      token,
      property,
      {
        startDate: start,
        endDate: end,
        type,
        dimensions: ["query", "page"],
        dataState: "all",
        dimensionFilterGroups: filterPage
          ? [{ filters: [{ dimension: "page", operator: "contains", expression: filterPage }] }]
          : undefined,
      },
      50000,
    );
    const best = new Map<string, { page: string; clicks: number; impressions: number }>();
    for (const r of rows) {
      const [query, page] = r.keys ?? [];
      if (!query || !page) continue;
      const cur = best.get(query);
      if (!cur || r.clicks > cur.clicks || (r.clicks === cur.clicks && r.impressions > cur.impressions)) {
        best.set(query, { page, clicks: r.clicks, impressions: r.impressions });
      }
    }
    const pages: Record<string, string> = {};
    for (const [query, v] of best) pages[query] = v.page;
    return NextResponse.json({ pages, truncated: rows.length >= 50000 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
