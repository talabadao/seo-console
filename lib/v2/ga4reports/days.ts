// Daily chart alignment for GA4 trends. GA4 omits days without data, so a series can't be paired with its
// comparison by array position: each period is laid out one slot per calendar day, and the comparison's day N
// sits next to the current period's day N. Pure (shared by server tests and the UI).

import { addDaysYmd, daysBetween } from "@/lib/v2/summary/period";

/** Every date of a range, inclusive. */
export function daysOf(r: { start: string; end: string }): string[] {
  const n = Math.max(0, daysBetween(r.start, r.end));
  return Array.from({ length: n }, (_, i) => addDaysYmd(r.start, i));
}

/**
 * Values for each date in `dates`. A date GA4 didn't return gets `fill`: 0 for counts (nothing happened that
 * day), null for rates and averages (undefined without data, drawn as a gap).
 */
export function alignSeries(points: { date: string; value: number }[], dates: string[], fill: number | null): (number | null)[] {
  const by = new Map(points.map((p) => [p.date, p.value]));
  return dates.map((d) => (by.has(d) ? by.get(d)! : fill));
}

/** Counts are zero on a day without data; rates, averages and per-user ratios are undefined. */
export const fillFor = (metric: string, type?: string) =>
  /Rate$|Rate:|^average|PerUser$|PerSession$|Duration$/.test(metric) || (type != null && type !== "TYPE_INTEGER") ? null : 0;
