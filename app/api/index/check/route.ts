import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { gscForProperty, managementRequired } from "@/lib/access";
import { discoverSitemapUrls, runIndexCheck, type SiteRow } from "@/lib/indexer";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    property?: string;
    sitemapUrl?: string;
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

  // An explicit run on the shared connection's quota: managers of a project that maps this property.
  const gsc = await gscForProperty(user, body.property, (body as { projectId?: number }).projectId);
  if (!gsc || gsc.siteId == null) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  if (!gsc.project.canManage) return managementRequired(gsc.project);
  const site: SiteRow = { id: gsc.siteId, user_id: 0, source: "google", property: gsc.property };

  let discovered: number | undefined;
  if (body.discover || body.sitemapUrl) {
    const d = await discoverSitemapUrls(gsc, site, body.sitemapUrl);
    discovered = d.found;
  }
  if (body.discoverOnly) {
    return NextResponse.json({ discovered, checked: 0 });
  }

  const result = await runIndexCheck(gsc, site, { max: body.max, interactive: true });
  return NextResponse.json({ discovered, ...result });
}
