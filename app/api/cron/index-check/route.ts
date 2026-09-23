import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { discoverSitemapUrls, runIndexCheck, type SiteRow } from "@/lib/indexer";
import type { UserRow } from "@/lib/session";

export const maxDuration = 300;

interface AutoIndexSiteRow {
  siteId: number;
  userId: number;
  source: string;
  property: string;
  autoIndexCap: number;
  uId: number;
  email: string;
  name: string | null;
  picture: string | null;
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  googleTokenExpiry: number | null;
  googleScopes: string | null;
  gaAiDomains: string | null;
  bingApiKey: string | null;
}

/**
 * Vercel Cron target — one entry per UTC hour (see vercel.json; Hobby-plan
 * cron jobs can each only run once a day, so a per-project "run at hour N"
 * schedule is implemented as 24 separate once-daily entries, each passing
 * its own hour via `?hour=`, rather than one cron polling every hour).
 * Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on
 * scheduled invocations when that env var is set; require it here so this
 * can't be triggered by anyone else. A site with auto-inspect off, or whose
 * chosen hour doesn't match this invocation, is simply not selected below —
 * nothing runs for it today.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hour = Number(req.nextUrl.searchParams.get("hour"));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return NextResponse.json({ error: "hour required" }, { status: 400 });
  }

  const rows = (await db
    .prepare(`
      SELECT s.id AS "siteId", s.user_id AS "userId", s.source AS "source", s.property AS "property",
             s.auto_index_cap AS "autoIndexCap",
             u.id AS "uId", u.email AS "email", u.name AS "name", u.picture AS "picture",
             u.google_access_token AS "googleAccessToken", u.google_refresh_token AS "googleRefreshToken",
             u.google_token_expiry AS "googleTokenExpiry", u.google_scopes AS "googleScopes",
             u.ga_ai_domains AS "gaAiDomains", u.bing_api_key AS "bingApiKey"
        FROM sites s
        JOIN users u ON u.id = s.user_id
       WHERE s.source = 'google' AND s.auto_index_enabled = true AND s.auto_index_hour = ?
         AND u.google_refresh_token IS NOT NULL
    `)
    .all(hour)) as unknown as AutoIndexSiteRow[];

  const results: { property: string; discovered?: number; checked?: number; error?: string }[] = [];
  for (const row of rows) {
    const site: SiteRow = { id: row.siteId, user_id: row.userId, source: row.source, property: row.property };
    const user: UserRow = {
      id: row.uId,
      email: row.email,
      name: row.name,
      picture: row.picture,
      google_access_token: row.googleAccessToken,
      google_refresh_token: row.googleRefreshToken,
      google_token_expiry: row.googleTokenExpiry,
      google_scopes: row.googleScopes,
      ga_ai_domains: row.gaAiDomains,
      bing_api_key: row.bingApiKey,
      asana_api_token: null,
    };
    try {
      const d = await discoverSitemapUrls(user, site);
      const c = await runIndexCheck(user, site, { max: row.autoIndexCap });
      results.push({ property: site.property, discovered: d.found, checked: c.checked });
    } catch (e) {
      results.push({ property: site.property, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ran: results.length, results });
}
