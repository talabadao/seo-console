import { NextRequest, NextResponse } from "next/server";
import { schedulesAllowed } from "@/lib/environment";
import { db } from "@/lib/db";
import { discoverSitemapUrls, runIndexCheck, type SiteRow } from "@/lib/indexer";
import { connectionAccessToken } from "@/lib/google/connections";
import { cronFinish, cronStart } from "@/lib/cronRuns";

export const maxDuration = 300;

interface AutoIndexSiteRow {
  siteId: number;
  property: string;
  autoIndexCap: number;
  connectionId: number;
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
 * nothing runs for it today. Sites are the shared ones of the workspace's Google connections, inspected through
 * that connection, and only while a live workspace project maps them.
 */
export async function GET(req: NextRequest) {
  // Scheduled work runs in production only, never from a Preview deployment.
  if (!schedulesAllowed()) return NextResponse.json({ skipped: "schedules run in production only" });
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hour = Number(req.nextUrl.searchParams.get("hour"));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return NextResponse.json({ error: "hour required" }, { status: 400 });
  }

  // Authenticated from here on: recorded in cron_runs, one row per hourly entry.
  const runId = await cronStart(`index-check:${hour}`);
  const rows = (await db
    .prepare(`
      SELECT s.id AS "siteId", s.property AS "property", s.auto_index_cap AS "autoIndexCap", s.connection_id AS "connectionId"
        FROM sites s
        JOIN google_connections c ON c.id = s.connection_id AND c.status = 'ok'
       WHERE s.source = 'google' AND s.auto_index_enabled = true AND s.auto_index_hour = ?
         AND EXISTS (SELECT 1 FROM projects p WHERE p.gsc_connection_id = s.connection_id AND p.gsc_property = s.property
                       AND p.workspace_id IS NOT NULL AND p.deleted_at IS NULL)
    `)
    .all(hour)) as unknown as AutoIndexSiteRow[];

  const results: { property: string; discovered?: number; checked?: number; error?: string }[] = [];
  for (const row of rows) {
    const site: SiteRow = { id: Number(row.siteId), user_id: 0, source: "google", property: row.property };
    const google = { token: () => connectionAccessToken(Number(row.connectionId)) };
    try {
      const d = await discoverSitemapUrls(google, site);
      const c = await runIndexCheck(google, site, { max: row.autoIndexCap });
      results.push({ property: site.property, discovered: d.found, checked: c.checked });
    } catch (e) {
      results.push({ property: site.property, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const errors = results.filter((r) => r.error).length;
  await cronFinish(runId, {
    status: "ok",
    processed: results.length - errors,
    skipped: rows.length - results.length,
    details: { sites: rows.length, errors, checked: results.reduce((n, r) => n + (r.checked ?? 0), 0) },
    error: errors ? results.find((r) => r.error)?.error : undefined,
  });
  return NextResponse.json({ ran: results.length, results });
}
