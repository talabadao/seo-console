// Runs a custom GA4 report definition (spec.ts) against the Data API. Server only.
//
// Number rules:
// - Totals come from their own query without dimensions, so GA4 de-duplicates users and computes rates and
//   averages itself. Rows are never added up and row percentages are never averaged.
// - The comparison period runs as its own query, so the current period's row limit doesn't push comparison
//   rows out. A row missing from the comparison shows no comparison value (not zero).
// - Dates are the GA4 property's calendar dates; the period is resolved in the property's time zone.

import { runReport, Semaphore, type ReportFlags } from "@/lib/ga4";
import type { PeriodInfo } from "@/lib/v2/summary/types";
import { filterExpression, type ReportSpec } from "./spec";

export interface ColumnInfo {
  name: string;
  label: string;
  /** Metrics: GA4 metric type (TYPE_INTEGER, TYPE_FLOAT, TYPE_SECONDS, TYPE_CURRENCY, …). */
  type?: string;
}

export interface ResultRow {
  key: string[];
  cur: (number | null)[];
  /** Null without a comparison; a null value means the row isn't in the comparison period's results. */
  prev: (number | null)[] | null;
}

export interface SeriesPoint {
  date: string;
  /** The value of the split dimension (line charts with a second dimension), else null. */
  split: string | null;
  values: number[];
}

export interface ReportNotes {
  thresholded: boolean;
  sampled: boolean;
  otherRow: boolean;
  /** More rows matched than were returned (the row limit). */
  truncated: boolean;
}

export interface CustomResult {
  dimensions: ColumnInfo[];
  metrics: ColumnInfo[];
  /** Reports without the date dimension: one row per dimension combination, with the comparison alongside. */
  rows: ResultRow[];
  /** Reports with the date dimension: points for the current and comparison periods. */
  series: SeriesPoint[] | null;
  prevSeries: SeriesPoint[] | null;
  totals: { cur: (number | null)[]; prev: (number | null)[] | null };
  rowCount: number;
  notes: ReportNotes;
  currency: string | null;
  timeZone: string | null;
  period: PeriodInfo;
  propertyId: string;
  fetchedAt: number;
}

export const gaDate = (raw: string) => (/^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw);
export const rangeOf = (r: { start: string; end: string }) => ({ startDate: r.start, endDate: r.end });

function orderBys(spec: ReportSpec): unknown[] | undefined {
  if (spec.dimensions.includes("date")) return [{ dimension: { dimensionName: "date" }, desc: false }];
  if (!spec.sort) return [{ metric: { metricName: spec.metrics[0] }, desc: true }];
  return spec.metrics.includes(spec.sort.field)
    ? [{ metric: { metricName: spec.sort.field }, desc: spec.sort.desc }]
    : [{ dimension: { dimensionName: spec.sort.field }, desc: spec.sort.desc }];
}

/** Totals for one or two periods from a query without dimensions. Null values: no data in that period. */
export async function totalsFor(
  token: string,
  propertyId: string,
  metrics: string[],
  period: PeriodInfo,
  dimensionFilter?: unknown,
): Promise<{ cur: (number | null)[]; prev: (number | null)[] | null; flags: ReportFlags; sampled: boolean }> {
  const ranges = [rangeOf(period.current), ...(period.previous ? [rangeOf(period.previous)] : [])];
  const r = await runReport(token, propertyId, { dimensions: [], metrics, dateRanges: ranges, dimensionFilter, limit: 10 });
  const pick = (range: number) => r.rows.find((x) => x.range === range)?.metrics ?? metrics.map(() => null);
  return { cur: pick(0), prev: period.previous ? pick(1) : null, flags: r.flags, sampled: r.sampled };
}

export async function runCustomReport(opts: {
  token: string;
  propertyId: string;
  spec: ReportSpec;
  period: PeriodInfo;
  labels?: Record<string, string>;
}): Promise<CustomResult> {
  const { token, propertyId, spec, period } = opts;
  const label = (n: string) => opts.labels?.[n] ?? n;
  const sem = new Semaphore(3);
  const dimensionFilter = filterExpression(spec.filters);
  const hasDate = spec.dimensions.includes("date");
  // Date first, so a line chart's split dimension is the second column.
  const dims = hasDate ? ["date", ...spec.dimensions.filter((d) => d !== "date")] : spec.dimensions;
  const rowsQuery = (range: { start: string; end: string }, limit: number) =>
    sem.run(() => runReport(token, propertyId, { dimensions: dims, metrics: spec.metrics, dateRanges: [rangeOf(range)], dimensionFilter, orderBys: orderBys(spec), limit }));

  const [totals, cur, prev] = await Promise.all([
    sem.run(() => totalsFor(token, propertyId, spec.metrics, period, dimensionFilter)),
    dims.length ? rowsQuery(period.current, hasDate ? 10000 : spec.limit) : Promise.resolve(null),
    dims.length && period.previous ? rowsQuery(period.previous, hasDate ? 10000 : Math.min(10000, Math.max(spec.limit * 5, 1000))) : Promise.resolve(null),
  ]);

  let rows: ResultRow[] = [];
  let series: SeriesPoint[] | null = null;
  let prevSeries: SeriesPoint[] | null = null;
  if (cur && hasDate) {
    const toPoints = (rs: { dims: string[]; metrics: number[] }[]) => rs.map((r) => ({ date: gaDate(r.dims[0]), split: dims.length > 1 ? r.dims[1] : null, values: r.metrics }));
    series = toPoints(cur.rows);
    prevSeries = prev ? toPoints(prev.rows) : null;
  } else if (cur) {
    const prevBy = new Map((prev?.rows ?? []).map((r) => [r.dims.join("\u0001"), r.metrics]));
    rows = cur.rows.map((r) => ({
      key: r.dims,
      cur: r.metrics,
      prev: period.previous ? (prevBy.get(r.dims.join("\u0001")) ?? spec.metrics.map(() => null)) : null,
    }));
  }
  const types = cur?.flags.metricTypes ?? totals.flags.metricTypes;
  return {
    dimensions: dims.map((d) => ({ name: d, label: label(d) })),
    metrics: spec.metrics.map((m, i) => ({ name: m, label: label(m), type: types[i] })),
    rows,
    series,
    prevSeries,
    totals: { cur: totals.cur, prev: totals.prev },
    rowCount: cur?.rowCount ?? 0,
    notes: {
      thresholded: Boolean(totals.flags.thresholded || cur?.flags.thresholded || prev?.flags.thresholded),
      sampled: Boolean(totals.sampled || cur?.sampled || prev?.sampled),
      otherRow: Boolean(cur?.flags.otherRow || prev?.flags.otherRow),
      truncated: Boolean(cur && !hasDate && cur.rowCount > cur.rows.length),
    },
    currency: totals.flags.currency,
    timeZone: totals.flags.timeZone,
    period,
    propertyId,
    fetchedAt: Date.now(),
  };
}
