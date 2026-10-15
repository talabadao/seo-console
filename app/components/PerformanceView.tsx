"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Chart, type SeriesPoint } from "./Chart";
import { BreakdownTable, type BreakdownRow } from "./BreakdownTable";
import { DateRangePicker, type RangeValue } from "./DateRangePicker";
import { FilterMenu } from "./FilterMenu";
import { METRICS, METRIC_META, type MetricKey, delta, deltaLabel, fmt } from "./format";
import {
  DEFAULT_FILTER_CONFIG,
  EMPTY_FILTER,
  applyFilters,
  filterActive,
  type FilterState,
} from "@/lib/queryFilters";
import { resolveComparison, resolveRange } from "@/lib/dateRanges";

// The Search Console Performance view (metric cards, chart, breakdown table),
// moved unchanged out of Dashboard.tsx so the legacy dashboard and the v2
// shell render the same component.

interface PerfResponse {
  range: { start: string; end: string };
  compareRange: { start: string; end: string } | null;
  grain: string;
  dimension: string;
  totals: Record<MetricKey, number>;
  prevTotals: Record<MetricKey, number> | null;
  series: SeriesPoint[];
  prevSeries: SeriesPoint[] | null;
  breakdown: BreakdownRow[];
  breakdownCount: number;
  truncated: boolean;
  brandTerms?: string[];
  longtailMinWords?: number;
}

type Totals = Record<MetricKey, number>;

/** Impression-weighted roll-up of a set of rows — matches the server's `fold`, kept here so
 * the metric cards can reflect client-side filters without a refetch. */
function foldTotals(rows: BreakdownRow[]): Totals {
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

function foldPrevTotals(rows: BreakdownRow[]): Totals {
  let clicks = 0,
    impressions = 0,
    posWeighted = 0;
  for (const r of rows) {
    clicks += r.prevClicks;
    impressions += r.prevImpressions;
    posWeighted += r.prevPosition * r.prevImpressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? posWeighted / impressions : 0,
  };
}

const DIMENSIONS = [
  { id: "query", label: "Queries" },
  { id: "page", label: "Pages" },
  { id: "country", label: "Countries" },
  { id: "device", label: "Devices" },
];

export const SEARCH_TYPES = [
  { id: "web", label: "Web" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "news", label: "News" },
  { id: "discover", label: "Discover" },
];

// Computed once at module load. Only used as the seed for the "custom" preset —
// every other preset is resolved from `preset` on each request, server-side.
const INITIAL_RANGE: RangeValue = {
  preset: "28d",
  start: format(new Date(Date.now() - 28 * 86400000), "yyyy-MM-dd"),
  end: format(new Date(Date.now() - 86400000), "yyyy-MM-dd"),
  grain: "day",
  compareMode: "none",
  matchWeekdays: false,
};

export function PerformanceView({
  property,
  searchType,
  onNeedsReconnect,
  onNotice,
}: {
  property: string;
  searchType: string;
  onNeedsReconnect: () => void;
  onNotice: (message: string) => void;
}) {
  const [range, setRange] = useState<RangeValue>(INITIAL_RANGE);
  const [dimension, setDimension] = useState("query");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(["clicks", "impressions"]);
  const [data, setData] = useState<PerfResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const resolved = useMemo(() => {
    const r = resolveRange(range.preset, {
      customStart: range.start,
      customEnd: range.end,
    });
    const c = resolveComparison(r, range.compareMode, {
      matchWeekdays: range.matchWeekdays,
      customStart: range.compareStart,
      customEnd: range.compareEnd,
    });
    return { r, c };
  }, [range]);

  const coreQuery = useMemo(() => {
    const p = new URLSearchParams({
      preset: range.preset,
      start: resolved.r.start,
      end: resolved.r.end,
      grain: range.grain,
      searchType,
      compare: range.compareMode,
      matchWeekdays: range.matchWeekdays ? "1" : "0",
    });
    if (range.compareStart) p.set("compareStart", range.compareStart);
    if (range.compareEnd) p.set("compareEnd", range.compareEnd);
    return p.toString();
  }, [range, resolved, searchType]);

  // Only the "view" identity is sent to the server — property, date range,
  // search type, dimension, and the cross-dimension page/query scoping (a real
  // GSC dimensionFilter). The quick filters (Winning/Losing/New, position,
  // branded, long-tail, AI, …) are applied locally against the returned rows
  // in `visibleRows` below, so toggling them is instant with no GSC round trip.
  const filterPage = dimension === "query" ? filters.filterPage : "";
  const filterQuery = dimension === "page" ? filters.filterQuery : "";
  const loadPerf = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    try {
      const p = new URLSearchParams(coreQuery);
      p.set("property", property);
      p.set("dimension", dimension);
      if (filterPage) p.set("filterPage", filterPage);
      if (filterQuery) p.set("filterQuery", filterQuery);
      const res = await fetch(`/api/performance?${p}`);
      const json = await res.json();
      if (json.needsReconnect) onNeedsReconnect();
      else if (res.ok) setData(json);
      else onNotice(json.error ?? "Failed to load");
    } finally {
      setLoading(false);
    }
    // The callbacks come from the parent and only report outcomes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property, dimension, coreQuery, filterPage, filterQuery]);

  useEffect(() => {
    loadPerf();
  }, [loadPerf]);

  // Client-side application of the quick filters (no refetch). `applyFilters`
  // is the exact same logic the server used to run — position, branded,
  // long-tail, questions, AI, Winning/Losing/New — over the rows already in
  // hand. The metric cards reflect the filtered set too.
  const filterCfg = useMemo(
    () => ({
      ...DEFAULT_FILTER_CONFIG,
      brandTerms: data?.brandTerms ?? [],
      longtailMinWords: data?.longtailMinWords ?? DEFAULT_FILTER_CONFIG.longtailMinWords,
    }),
    [data?.brandTerms, data?.longtailMinWords],
  );
  const visibleRows = useMemo(
    () => applyFilters(data?.breakdown ?? [], filters, filterCfg, dimension),
    [data?.breakdown, filters, filterCfg, dimension],
  );
  const cheapFilterActive =
    filters.branded !== "all" ||
    filters.position !== 0 ||
    filters.question ||
    filters.longtail ||
    filters.ai ||
    filters.trend !== "all" ||
    filters.contains.trim().length > 0;
  const cardTotals = cheapFilterActive ? foldTotals(visibleRows) : data?.totals;
  const cardPrevTotals = cheapFilterActive ? foldPrevTotals(visibleRows) : data?.prevTotals;

  /** For the Queries export: the URL that ranks for each query in the current view. */
  const loadQueryPages = useCallback(async (): Promise<Record<string, string>> => {
    const p = new URLSearchParams({
      property,
      start: resolved.r.start,
      end: resolved.r.end,
      searchType,
    });
    if (filterPage) p.set("filterPage", filterPage);
    const res = await fetch(`/api/performance/query-pages?${p}`);
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error ?? "Couldn't load URLs");
    return j.pages ?? {};
  }, [property, resolved, searchType, filterPage]);

  const toggleMetric = (m: MetricKey) =>
    setActiveMetrics((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const activeCount = filterActive(filters)
    ? Object.values({
        b: filters.branded !== "all",
        p: filters.position !== 0,
        q: filters.question,
        l: filters.longtail,
        a: filters.ai,
        t: filters.trend !== "all",
        c: filters.contains.trim().length > 0,
        fp: filters.filterPage.trim().length > 0,
        fq: filters.filterQuery.trim().length > 0,
      }).filter(Boolean).length
    : 0;
  const compareOn = range.compareMode !== "none";
  // Growing/Decaying/New implicitly compare to the previous period, so show the
  // per-row change column then too.
  const showRowDeltas = compareOn || filters.trend !== "all";

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <DateRangePicker
          value={range}
          resolvedRange={resolved.r}
          resolvedCompare={resolved.c}
          onChange={setRange}
        />
        <FilterMenu
          value={filters}
          onChange={setFilters}
          dimension={dimension}
          activeCount={activeCount}
        />
        {loading && <span className="text-xs text-muted">Loading…</span>}
        <span className="ml-auto text-xs text-muted">
          {data ? `${data.range.start} → ${data.range.end}` : ""}
          {compareOn && data?.compareRange
            ? `  vs  ${data.compareRange.start} → ${data.compareRange.end}`
            : ""}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((m) => {
          const meta = METRIC_META[m];
          const val = cardTotals?.[m] ?? 0;
          const prevVal = showRowDeltas ? cardPrevTotals?.[m] : undefined;
          const d = prevVal != null ? delta(val, prevVal, meta.kind) : null;
          const on = activeMetrics.includes(m);
          return (
            <button
              key={m}
              onClick={() => toggleMetric(m)}
              className={`rounded-xl border p-4 text-left transition ${
                on ? "bg-surface shadow-sm" : "bg-background opacity-70 hover:opacity-100"
              }`}
              style={on ? { borderColor: meta.color } : undefined}
            >
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                {meta.label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {fmt(val, meta.kind)}
              </div>
              {d && (
                <div
                  className="mt-0.5 text-xs font-medium"
                  style={{ color: d.good ? "var(--good)" : "var(--bad)" }}
                >
                  {deltaLabel(d)} vs {range.compareMode === "yoy" ? "last year" : "previous"}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border bg-surface p-4">
        <Chart
          series={data?.series ?? []}
          prevSeries={compareOn ? data?.prevSeries : null}
          active={activeMetrics}
          grain={range.grain}
        />
      </div>

      <div className="mt-6 rounded-xl border bg-surface">
        <div className="flex flex-wrap items-center gap-1 border-b px-2 pt-2">
          {DIMENSIONS.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                setFilters((f) => ({ ...f, filterPage: "", filterQuery: "" }));
                setDimension(d.id);
              }}
              className={`rounded-t-md px-3 py-2 text-sm font-medium ${
                dimension === d.id
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {d.label}
            </button>
          ))}
          {data?.truncated && (
            <span className="ml-auto px-2 text-xs text-muted">
              showing first {data.breakdown.length.toLocaleString()} — refine with filters
            </span>
          )}
        </div>
        <BreakdownTable
          dimension={dimension}
          rows={visibleRows}
          totalCount={visibleRows.length}
          active={activeMetrics}
          compareOn={showRowDeltas}
          trend={filters.trend}
          onTrend={(t) => setFilters((f) => ({ ...f, trend: t }))}
          aiPromptMode={dimension === "query" && filters.ai}
          loadQueryPages={dimension === "query" ? loadQueryPages : undefined}
          onDrill={
            dimension === "page"
              ? (key) => {
                  setFilters((f) => ({ ...f, filterQuery: "", filterPage: key }));
                  setDimension("query");
                }
              : dimension === "query"
                ? (key) => {
                    setFilters((f) => ({ ...f, filterPage: "", filterQuery: key }));
                    setDimension("page");
                  }
                : undefined
          }
        />
      </div>
    </>
  );
}
