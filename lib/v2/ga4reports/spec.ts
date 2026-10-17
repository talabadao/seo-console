// Saved custom GA4 reports: the report definition, its normalization and its validation. Shared by the server
// (routes, runner) and the builder UI. Pure: no database or network.
//
// A definition is relative: a range preset and a comparison mode, resolved when the report runs, in the GA4
// property's own time zone. Dimension filters only (no metric filters, segments or other Exploration techniques).

import { COMPARE_MODES, RANGE_PRESETS, type CompareMode, type RangePreset } from "@/lib/v2/summary/period";

export const CHART_TYPES = [
  { id: "table", label: "Table" },
  { id: "scorecard", label: "Scorecard" },
  { id: "line", label: "Line (over time)" },
  { id: "bar", label: "Bar" },
  { id: "donut", label: "Donut (share)" },
] as const;
export type ChartType = (typeof CHART_TYPES)[number]["id"];

export const FILTER_OPS = [
  { id: "exact", label: "is exactly" },
  { id: "contains", label: "contains" },
  { id: "begins", label: "begins with" },
  { id: "regex", label: "matches regex" },
  { id: "in", label: "is one of (comma-separated)" },
] as const;
export type FilterOp = (typeof FILTER_OPS)[number]["id"];

export interface ReportFilter {
  field: string;
  op: FilterOp;
  value: string;
  /** Excludes matching rows instead of keeping them. */
  negate: boolean;
}

export interface ReportSpec {
  dimensions: string[];
  metrics: string[];
  preset: RangePreset;
  compare: CompareMode;
  filters: ReportFilter[];
  sort: { field: string; desc: boolean } | null;
  limit: number;
  chart: ChartType;
}

export const LIMITS = { dimensions: 3, metrics: 6, filters: 5, rows: 1000, name: 80 } as const;

/**
 * Metrics whose values can be added across rows. A donut shows each row's share of the total, which is only
 * meaningful for these. Users, rates and averages are not additive: one user can appear in several rows.
 */
export const ADDITIVE_METRICS = new Set([
  "sessions",
  "engagedSessions",
  "eventCount",
  "keyEvents",
  "screenPageViews",
  "totalRevenue",
  "purchaseRevenue",
  "transactions",
  "ecommercePurchases",
  "userEngagementDuration",
  "addToCarts",
  "checkouts",
]);

const NAME = /^[A-Za-z][A-Za-z0-9_]*(:[A-Za-z0-9_]+(\[[A-Za-z0-9_]+\])?)?$/;

export const DEFAULT_SPEC: ReportSpec = {
  dimensions: ["sessionDefaultChannelGroup"],
  metrics: ["sessions", "engagedSessions", "keyEvents"],
  preset: "last28",
  compare: "previous",
  filters: [],
  sort: { field: "sessions", desc: true },
  limit: 50,
  chart: "table",
};

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Turns untrusted input into a definition, or the reasons it can't be one. Structure only (see validateFields). */
export function normalizeSpec(raw: unknown): { spec: ReportSpec } | { errors: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const names = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 120)).filter(Boolean))] : []);
  const dimensions = names(r.dimensions);
  const metrics = names(r.metrics);
  for (const n of [...dimensions, ...metrics]) if (!NAME.test(n)) errors.push(`"${n}" isn't a GA4 API name.`);
  if (dimensions.length > LIMITS.dimensions) errors.push(`Use at most ${LIMITS.dimensions} dimensions.`);
  if (!metrics.length) errors.push("Choose at least one metric.");
  if (metrics.length > LIMITS.metrics) errors.push(`Use at most ${LIMITS.metrics} metrics.`);

  const preset = RANGE_PRESETS.some((p) => p.id === r.preset) ? (r.preset as RangePreset) : "last28";
  const compare = COMPARE_MODES.some((c) => c.id === r.compare) ? (r.compare as CompareMode) : "previous";
  const chart = CHART_TYPES.some((c) => c.id === r.chart) ? (r.chart as ChartType) : "table";

  const filters: ReportFilter[] = [];
  for (const f of Array.isArray(r.filters) ? r.filters : []) {
    const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const field = str(o.field, 120);
    const op = FILTER_OPS.some((x) => x.id === o.op) ? (o.op as FilterOp) : "exact";
    const value = str(o.value, 500);
    if (!field && !value) continue;
    if (!NAME.test(field)) errors.push(`Filter field "${field}" isn't a GA4 API name.`);
    if (!value) errors.push(`The filter on ${field} needs a value.`);
    if (op === "regex") {
      try {
        new RegExp(value);
      } catch {
        errors.push(`The filter on ${field} isn't a valid regular expression.`);
      }
    }
    filters.push({ field, op, value, negate: o.negate === true });
  }
  if (filters.length > LIMITS.filters) errors.push(`Use at most ${LIMITS.filters} filters.`);

  let sort: ReportSpec["sort"] = null;
  const s = (r.sort && typeof r.sort === "object" ? r.sort : null) as Record<string, unknown> | null;
  if (s && str(s.field)) {
    const field = str(s.field, 120);
    if (![...dimensions, ...metrics].includes(field)) errors.push(`Sort by a chosen dimension or metric (${field} isn't one).`);
    sort = { field, desc: s.desc !== false };
  }
  const limit = Math.max(1, Math.min(LIMITS.rows, Math.round(Number(r.limit) || 50)));

  const nonDate = dimensions.filter((d) => d !== "date");
  if (chart === "scorecard" && dimensions.length) errors.push("A scorecard shows totals: remove the dimensions, or choose a table.");
  if (chart === "line") {
    if (!dimensions.includes("date")) errors.push('A line chart needs the "date" dimension.');
    if (nonDate.length > 1) errors.push("A line chart can split by at most one dimension besides date.");
  }
  if (chart === "bar" || chart === "donut") {
    if (nonDate.length !== 1 || dimensions.includes("date")) errors.push(`A ${chart} chart needs exactly one dimension (not date).`);
  }
  if (chart === "donut") {
    if (metrics.length !== 1) errors.push("A donut chart shows one metric.");
    else if (!ADDITIVE_METRICS.has(metrics[0]))
      errors.push(`A donut shows shares of a total, so its metric must add up across rows. ${metrics[0]} doesn't (users, rates and averages can't be split into shares).`);
  }
  if (errors.length) return { errors };
  return { spec: { dimensions, metrics, preset, compare, filters, sort, limit, chart } };
}

/** Field names that the property's metadata doesn't list. */
export function unknownFields(spec: ReportSpec, meta: { dimensions: { apiName: string }[]; metrics: { apiName: string }[] }): string[] {
  const dims = new Set(meta.dimensions.map((d) => d.apiName));
  const mets = new Set(meta.metrics.map((m) => m.apiName));
  const out: string[] = [];
  for (const d of [...spec.dimensions, ...spec.filters.map((f) => f.field)]) if (!dims.has(d) && !out.includes(d)) out.push(d);
  for (const m of spec.metrics) if (!mets.has(m) && !out.includes(m)) out.push(m);
  return out;
}

/** The GA4 FilterExpression for a definition's filters (all must hold), or undefined. */
export function filterExpression(filters: ReportFilter[]): unknown {
  const one = (f: ReportFilter) => {
    const filter =
      f.op === "in"
        ? { fieldName: f.field, inListFilter: { values: f.value.split(",").map((v) => v.trim()).filter(Boolean) } }
        : {
            fieldName: f.field,
            stringFilter: { matchType: { exact: "EXACT", contains: "CONTAINS", begins: "BEGINS_WITH", regex: "FULL_REGEXP" }[f.op], value: f.value, caseSensitive: f.op === "exact" || f.op === "regex" },
          };
    return f.negate ? { notExpression: { filter } } : { filter };
  };
  if (!filters.length) return undefined;
  if (filters.length === 1) return one(filters[0]);
  return { andGroup: { expressions: filters.map(one) } };
}

/** Rates (0–1 fractions in the API) are shown as percentages. */
export const isRateMetric = (name: string) => /Rate$/.test(name) || /Rate:/.test(name);
