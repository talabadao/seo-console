// Incremental Search Console daily totals. For each Search Console site of an account (sites.id, which is
// per user), perf_rows dimension 'total' holds one row per day and gsc_daily_coverage (migration 0012) records the
// contiguous date range those rows cover. A refresh asks Google only for:
//   - days outside the covered range that the request needs (extended so the range stays contiguous), and
//   - the revisable tail: the last OVERLAP_DAYS days as of the previous refresh, which Google may still revise
//     (dataState "all" includes fresh, not-yet-final data). Refetched at most once per REVISE_AFTER_MS.
// Every fetched window is replaced atomically (delete then insert in one transaction), so a revised or
// withdrawn day overwrites the stored value and nothing is counted twice. Concurrent refreshes of the same site
// converge: inserts upsert, and coverage only grows.
//
// Period totals are derived from the stored days: clicks and impressions are sums, CTR is clicks / impressions,
// position is impression-weighted. For a property-level query grouped by date only, this matches Google's own
// period totals (each search impression belongs to one day; anonymized queries are included without a query
// dimension).
//
// Returns null when the table isn't migrated yet or the account has no stored site row for the property: the
// caller then queries Google directly, as before.

import { db, tableExists, withTransaction } from "@/lib/db";
import type { SearchAnalyticsRow } from "@/lib/google/searchconsole";
import { siteIdFor } from "@/lib/metrics";
import { addDaysYmd, ymdUTC } from "@/lib/v2/summary/period";

/** Days before the previous refresh that are refetched, because Google may still revise them. */
export const OVERLAP_DAYS = 4;
/** The revisable tail is refetched at most this often (summaries are also cached by lib/sync). */
export const REVISE_AFTER_MS = 3 * 3600_000;

export interface DailyTotal {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface DateWindow {
  start: string;
  end: string;
}

/** Fetches Google's daily rows (dimension "date") for one window. */
export type FetchDaily = (w: DateWindow) => Promise<SearchAnalyticsRow[]>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const minYmd = (a: string, b: string) => (a < b ? a : b);
const maxYmd = (a: string, b: string) => (a > b ? a : b);

interface Coverage {
  from: string;
  to: string;
  refreshedAt: number;
}

/** The windows to request from Google so that `want` is covered and the revisable tail is current. */
export function plan(want: DateWindow, cov: Coverage | null, now: number): { windows: DateWindow[]; refreshesTail: boolean } {
  if (!cov) return { windows: [want], refreshesTail: true };
  const windows: DateWindow[] = [];
  if (want.start < cov.from) windows.push({ start: want.start, end: addDaysYmd(cov.from, -1) });
  const tailStart = maxYmd(cov.from, addDaysYmd(ymdUTC(new Date(cov.refreshedAt)), -(OVERLAP_DAYS - 1)));
  const touchesTail = want.end >= tailStart && tailStart <= cov.to;
  const tailDue = touchesTail && now - cov.refreshedAt >= REVISE_AFTER_MS;
  if (want.end > cov.to || tailDue) {
    // Forward: from the revisable tail (or just past coverage, when coverage ends before it) to the requested end.
    windows.push({ start: tailStart <= cov.to ? tailStart : addDaysYmd(cov.to, 1), end: maxYmd(want.end, cov.to) });
    return { windows, refreshesTail: true };
  }
  return { windows, refreshesTail: false };
}

/** Advisory-lock namespace for coverage updates (second key: the site id). */
const COVERAGE_LOCK = 73162542;

/**
 * The coverage after storing `fetched` (a contiguous range): the union when it overlaps or touches the current
 * coverage, otherwise the current coverage unchanged (null: nothing to write). `tailAt` is set when the fetch
 * included the revisable tail.
 */
export function mergeCoverage(current: Coverage | null, fetched: { from: string; to: string }, tailAt: number | null): Coverage | null {
  if (!current) return { from: fetched.from, to: fetched.to, refreshedAt: tailAt ?? 0 };
  const touches = fetched.from <= addDaysYmd(current.to, 1) && fetched.to >= addDaysYmd(current.from, -1);
  if (!touches) return null;
  return {
    from: minYmd(current.from, fetched.from),
    to: maxYmd(current.to, fetched.to),
    refreshedAt: tailAt == null ? current.refreshedAt : Math.max(current.refreshedAt, tailAt),
  };
}

/** Daily totals for `want`, fetching only missing and revisable days. Null: not available, query directly. */
export async function gscDailyTotals(
  userId: number,
  property: string,
  want: DateWindow,
  fetchDaily: FetchDaily,
  now = Date.now(),
): Promise<{ days: DailyTotal[]; fetched: DateWindow[] } | null> {
  if (!YMD.test(want.start) || !YMD.test(want.end) || want.start > want.end) return null;
  if (!(await tableExists("gsc_daily_coverage"))) return null;
  const siteId = await siteIdFor(userId, property);
  if (siteId == null) return null;

  // Google has no data after today.
  const range = { start: want.start, end: minYmd(want.end, ymdUTC(new Date(now))) };
  if (range.start > range.end) return { days: [], fetched: [] };

  const row = (await db.prepare("SELECT covered_from, covered_to, refreshed_at FROM gsc_daily_coverage WHERE site_id = ?").get(siteId)) as
    | { covered_from: string; covered_to: string; refreshed_at: number | string }
    | undefined;
  const cov = row ? { from: row.covered_from, to: row.covered_to, refreshedAt: Number(row.refreshed_at) } : null;
  const { windows, refreshesTail } = plan(range, cov, now);

  if (windows.length) {
    const results = await Promise.all(windows.map((w) => fetchDaily(w)));
    const from = windows.reduce((f, w) => minYmd(f, w.start), cov?.from ?? range.start);
    const to = windows.reduce((t, w) => maxYmd(t, w.end), cov?.to ?? range.end);
    await withTransaction(async (q) => {
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        await q("DELETE FROM perf_rows WHERE site_id = ? AND dimension = 'total' AND data_date BETWEEN ? AND ?", siteId, w.start, w.end);
        const rows = results[i].filter((r) => {
          const d = r.keys?.[0] ?? "";
          return YMD.test(d) && d >= w.start && d <= w.end;
        });
        for (let j = 0; j < rows.length; j += 200) {
          const chunk = rows.slice(j, j + 200);
          await q(
            `INSERT INTO perf_rows (site_id, data_date, dimension, key, clicks, impressions, ctr, position)
             VALUES ${chunk.map(() => "(?, ?, 'total', '', ?, ?, ?, ?)").join(", ")}
             ON CONFLICT (site_id, data_date, dimension, key) DO UPDATE SET
               clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position`,
            ...chunk.flatMap((r) => [siteId, r.keys![0], r.clicks ?? 0, r.impressions ?? 0, r.ctr ?? 0, r.position ?? 0]),
          );
        }
      }
      // Coverage is one contiguous range. Another refresh of this site may have committed since we read it, so
      // re-read it under a per-site lock and only merge ranges that touch: two first refreshes for distant periods
      // must not claim the days between them.
      await q("SELECT pg_advisory_xact_lock(?, ?)", COVERAGE_LOCK, siteId);
      const [now2] = (await q("SELECT covered_from, covered_to, refreshed_at FROM gsc_daily_coverage WHERE site_id = ?", siteId)) as Array<{
        covered_from: string;
        covered_to: string;
        refreshed_at: number | string;
      }>;
      const merged = mergeCoverage(now2 ? { from: now2.covered_from, to: now2.covered_to, refreshedAt: Number(now2.refreshed_at) } : null, { from, to }, refreshesTail ? now : null);
      if (merged) {
        await q(
          `INSERT INTO gsc_daily_coverage (site_id, covered_from, covered_to, refreshed_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (site_id) DO UPDATE SET covered_from = EXCLUDED.covered_from, covered_to = EXCLUDED.covered_to, refreshed_at = EXCLUDED.refreshed_at`,
          siteId,
          merged.from,
          merged.to,
          merged.refreshedAt,
        );
      }
    });
  }

  const days = (await db
    .prepare(
      `SELECT data_date, clicks, impressions, ctr, position FROM perf_rows
       WHERE site_id = ? AND dimension = 'total' AND data_date BETWEEN ? AND ? ORDER BY data_date`,
    )
    .all(siteId, range.start, range.end)) as Array<Record<string, unknown>>;
  return {
    days: days.map((d) => ({
      date: String(d.data_date),
      clicks: Number(d.clicks),
      impressions: Number(d.impressions),
      ctr: Number(d.ctr),
      position: Number(d.position),
    })),
    fetched: windows,
  };
}

/** Period totals from daily rows: summed clicks and impressions, CTR = clicks / impressions, impression-weighted position. */
export function foldDays(days: DailyTotal[], range: DateWindow): { clicks: number; impressions: number; ctr: number | null; position: number | null; rows: number } {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  let rows = 0;
  for (const d of days) {
    if (d.date < range.start || d.date > range.end) continue;
    rows++;
    clicks += d.clicks;
    impressions += d.impressions;
    weighted += d.position * d.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : rows ? 0 : null,
    position: impressions > 0 ? weighted / impressions : null,
    rows,
  };
}
