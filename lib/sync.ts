import { db, rawSql } from "@/lib/db";
import { accessTokenFor } from "@/lib/google/oauth";
import { searchAnalytics } from "@/lib/google/searchconsole";
import { discoverSitemapUrls, runIndexCheck } from "@/lib/indexer";
import type { UserRow } from "@/lib/session";

// dashboard dimension -> GSC API dimensions (always prefixed with "date" so we
// keep a daily grain and can aggregate over any range later).
const DIMENSION_MAP: Record<string, string[]> = {
  total: ["date"],
  query: ["date", "query"],
  page: ["date", "page"],
  country: ["date", "country"],
  device: ["date", "device"],
};

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export interface SiteRow {
  id: number;
  user_id: number;
  source: string;
  property: string;
}

interface PerfRowValue {
  site_id: number;
  data_date: string;
  dimension: string;
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

const UPSERT_CHUNK = 500;

/** Bulk upsert into perf_rows — a handful of round trips instead of one per row. */
async function upsertPerfRows(values: PerfRowValue[]): Promise<number> {
  if (!values.length) return 0;
  const sql = await rawSql();
  let written = 0;
  for (let i = 0; i < values.length; i += UPSERT_CHUNK) {
    const chunk = values.slice(i, i + UPSERT_CHUNK);
    await sql`
      INSERT INTO perf_rows (site_id, data_date, dimension, key, clicks, impressions, ctr, position)
      VALUES ${sql(chunk, "site_id", "data_date", "dimension", "key", "clicks", "impressions", "ctr", "position")}
      ON CONFLICT (site_id, data_date, dimension, key) DO UPDATE SET
        clicks = EXCLUDED.clicks,
        impressions = EXCLUDED.impressions,
        ctr = EXCLUDED.ctr,
        position = EXCLUDED.position
    `;
    written += chunk.length;
  }
  return written;
}

export async function syncGoogleSite(user: UserRow, site: SiteRow) {
  const started = Date.now();
  const logId = (
    (await db
      .prepare(
        "INSERT INTO sync_log (site_id, source, started_at, status) VALUES (?, 'google', ?, 'running') RETURNING id",
      )
      .get(site.id, started)) as { id: number }
  ).id;

  const DAILY_ROW_LIMIT = Number(process.env.SYNC_DAILY_ROW_LIMIT || 2000);
  // Incremental syncs re-pull a short window (GSC keeps refining recent days).
  // The very first sync of a property backfills as far as GSC allows (~16 months).
  const hasData = (
    (await db.prepare("SELECT COUNT(*) AS n FROM perf_rows WHERE site_id = ?").get(site.id)) as {
      n: number;
    }
  ).n;
  const LOOKBACK_DAYS = hasData
    ? Number(process.env.SYNC_LOOKBACK_DAYS || 40)
    : Number(process.env.SYNC_BACKFILL_DAYS || 480);

  let written = 0;
  try {
    const token = await accessTokenFor(user);
    const end = new Date();
    const start = new Date(end.getTime() - LOOKBACK_DAYS * 86_400_000);
    const startDate = ymd(start);
    const endDate = ymd(end);

    for (const [dimension, apiDims] of Object.entries(DIMENSION_MAP)) {
      const rowLimit = dimension === "total" ? 1000 : DAILY_ROW_LIMIT;
      try {
        const rows = await searchAnalytics(token, site.property, {
          startDate,
          endDate,
          dimensions: apiDims,
          rowLimit,
          dataState: "all",
        });
        const values: PerfRowValue[] = [];
        for (const r of rows) {
          const dataDate = r.keys?.[0] ?? "";
          const key = dimension === "total" ? "" : (r.keys?.[1] ?? "");
          if (!dataDate) continue;
          values.push({
            site_id: site.id,
            data_date: dataDate,
            dimension,
            key,
            clicks: r.clicks ?? 0,
            impressions: r.impressions ?? 0,
            ctr: r.ctr ?? 0,
            position: r.position ?? 0,
          });
        }
        written += await upsertPerfRows(values);
      } catch (e) {
        // A single dimension failing (e.g. a permissions quirk) shouldn't abort
        // the whole sync — record and move on.
        console.warn(`sync ${site.property} ${dimension}: ${e instanceof Error ? e.message : e}`);
      }
    }

    await db
      .prepare("UPDATE sync_log SET finished_at = ?, status = 'ok', rows_written = ? WHERE id = ?")
      .run(Date.now(), written, logId);
    return { ok: true as const, rowsWritten: written, startDate, endDate };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .prepare(
        "UPDATE sync_log SET finished_at = ?, status = 'error', message = ?, rows_written = ? WHERE id = ?",
      )
      .run(Date.now(), message, written, logId);
    return { ok: false as const, error: message, rowsWritten: written };
  }
}

export async function syncAllForUser(user: UserRow, opts: { index?: boolean } = {}) {
  const sites = (await db
    .prepare("SELECT id, user_id, source, property FROM sites WHERE user_id = ? AND source = 'google'")
    .all(user.id)) as unknown as SiteRow[];
  const results = [];
  for (const site of sites) {
    const perf = await syncGoogleSite(user, site);
    let index: { discovered?: number; checked?: number; error?: string } | undefined;
    if (opts.index !== false) {
      try {
        const d = await discoverSitemapUrls(user, site);
        const c = await runIndexCheck(user, site);
        index = { discovered: d.found, checked: c.checked };
      } catch (e) {
        index = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    results.push({ property: site.property, ...perf, index });
  }
  return results;
}
