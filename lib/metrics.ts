import { db } from "@/lib/db";

export interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SeriesPoint extends Totals {
  date: string;
}

export interface BreakdownRow extends Totals {
  key: string;
}

export function siteIdFor(userId: number, property: string): number | null {
  const row = db
    .prepare("SELECT id FROM sites WHERE user_id = ? AND property = ?")
    .get(userId, property) as { id: number } | undefined;
  return row?.id ?? null;
}

/** Impression-weighted position, recomputed CTR. */
function fold(rows: { clicks: number; impressions: number; position: number }[]): Totals {
  let clicks = 0,
    impressions = 0,
    posWeighted = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    posWeighted += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? posWeighted / impressions : 0,
  };
}

export function totalsSeries(siteId: number, start: string, end: string): SeriesPoint[] {
  const rows = db
    .prepare(
      `SELECT data_date AS date, clicks, impressions, ctr, position
         FROM perf_rows
        WHERE site_id = ? AND dimension = 'total' AND data_date BETWEEN ? AND ?
        ORDER BY data_date`,
    )
    .all(siteId, start, end) as unknown as SeriesPoint[];
  return rows;
}

export function rangeTotals(siteId: number, start: string, end: string): Totals {
  const rows = db
    .prepare(
      `SELECT clicks, impressions, position FROM perf_rows
        WHERE site_id = ? AND dimension = 'total' AND data_date BETWEEN ? AND ?`,
    )
    .all(siteId, start, end) as { clicks: number; impressions: number; position: number }[];
  return fold(rows);
}

export function breakdown(
  siteId: number,
  dimension: string,
  start: string,
  end: string,
  limit = 1000,
): BreakdownRow[] {
  const rows = db
    .prepare(
      `SELECT key,
              SUM(clicks)      AS clicks,
              SUM(impressions) AS impressions,
              CASE WHEN SUM(impressions) > 0
                   THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS position
         FROM perf_rows
        WHERE site_id = ? AND dimension = ? AND data_date BETWEEN ? AND ?
        GROUP BY key
        ORDER BY clicks DESC, impressions DESC
        LIMIT ?`,
    )
    .all(siteId, dimension, start, end, limit) as {
    key: string;
    clicks: number;
    impressions: number;
    position: number;
  }[];
  return rows.map((r) => ({
    ...r,
    ctr: r.impressions ? r.clicks / r.impressions : 0,
  }));
}

export function availableDimensions(siteId: number): string[] {
  const rows = db
    .prepare("SELECT DISTINCT dimension FROM perf_rows WHERE site_id = ?")
    .all(siteId) as { dimension: string }[];
  return rows.map((r) => r.dimension);
}

export function lastSync(siteId: number) {
  return db
    .prepare(
      `SELECT started_at, finished_at, status, message, rows_written
         FROM sync_log WHERE site_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(siteId) as
    | {
        started_at: number;
        finished_at: number | null;
        status: string;
        message: string | null;
        rows_written: number;
      }
    | undefined;
}

export function dataDateRange(siteId: number) {
  return db
    .prepare(
      `SELECT MIN(data_date) AS min, MAX(data_date) AS max
         FROM perf_rows WHERE site_id = ? AND dimension = 'total'`,
    )
    .get(siteId) as { min: string | null; max: string | null };
}
