"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Chart, type SeriesPoint } from "./Chart";
import { BreakdownTable, type BreakdownRow } from "./BreakdownTable";
import { DateRangePicker, type RangeValue } from "./DateRangePicker";
import { FilterMenu } from "./FilterMenu";
import { Indexing } from "./Indexing";
import { Opportunities } from "./Opportunities";
import { UrlInspector } from "./UrlInspector";
import { SettingsPanel } from "./SettingsPanel";
import { METRICS, METRIC_META, type MetricKey, delta, deltaLabel, fmt } from "./format";
import { EMPTY_FILTER, filterActive, type FilterState } from "@/lib/queryFilters";
import { resolveComparison, resolveRange } from "@/lib/dateRanges";

interface SiteMeta {
  id: number;
  source: string;
  property: string;
  lastSync: { status: string; finished_at: number | null } | null;
}

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
  filterActive: boolean;
}

const DIMENSIONS = [
  { id: "query", label: "Queries" },
  { id: "page", label: "Pages" },
  { id: "country", label: "Countries" },
  { id: "device", label: "Devices" },
];

const SEARCH_TYPES = [
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

export function Dashboard({
  user,
  bingConnected,
}: {
  user: { email: string; name: string | null; picture: string | null };
  bingConnected: boolean;
}) {
  const [sites, setSites] = useState<SiteMeta[]>([]);
  const [property, setProperty] = useState("");
  const [range, setRange] = useState<RangeValue>(INITIAL_RANGE);
  const [searchType, setSearchType] = useState("web");
  const [dimension, setDimension] = useState("query");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(["clicks", "impressions"]);
  const [data, setData] = useState<PerfResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<
    "performance" | "opportunities" | "indexing" | "inspect"
  >("performance");
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/sites");
    if (!res.ok) return;
    const json = await res.json();
    setSites(json.sites);
    setProperty((cur) => cur || json.sites[0]?.property || "");
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  const loadPerf = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    try {
      const p = new URLSearchParams(coreQuery);
      p.set("property", property);
      p.set("dimension", dimension);
      p.set("limit", "0"); // 0 = all rows (bounded server-side by LIVE_MAX_ROWS)
      if (filters.contains) p.set("contains", filters.contains);
      if (filters.branded !== "all") p.set("branded", filters.branded);
      if (filters.position) p.set("position", String(filters.position));
      if (filters.question) p.set("question", "1");
      if (filters.longtail) p.set("longtail", "1");
      if (filters.ai) p.set("ai", "1");
      if (filters.trend !== "all") p.set("trend", filters.trend);
      const res = await fetch(`/api/performance?${p}`);
      const json = await res.json();
      if (res.ok) setData(json);
      else setNotice(json.error ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [property, dimension, coreQuery, filters]);

  useEffect(() => {
    loadPerf();
  }, [loadPerf]);

  async function runSync() {
    if (!property) return;
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property }),
      });
      const json = await res.json();
      if (json.result?.ok) {
        setNotice(`Synced ${json.result.rowsWritten.toLocaleString()} history rows.`);
        await loadSites();
      } else {
        setNotice(`Sync failed: ${json.result?.error ?? json.error ?? "unknown"}`);
      }
    } finally {
      setSyncing(false);
    }
  }

  const toggleMetric = (m: MetricKey) =>
    setActiveMetrics((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const currentSite = sites.find((s) => s.property === property);
  const lastSyncText = currentSite?.lastSync?.finished_at
    ? `history synced ${format(currentSite.lastSync.finished_at, "MMM d, HH:mm")}`
    : "history not synced";
  const activeCount = filterActive(filters)
    ? Object.values({
        b: filters.branded !== "all",
        p: filters.position !== 0,
        q: filters.question,
        l: filters.longtail,
        a: filters.ai,
        t: filters.trend !== "all",
        c: filters.contains.trim().length > 0,
      }).filter(Boolean).length
    : 0;
  const compareOn = range.compareMode !== "none";
  // Growing/Decaying/New implicitly compare to the previous period, so show the
  // per-row change column then too.
  const showRowDeltas = compareOn || filters.trend !== "all";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-5 py-3">
          <span className="text-base font-semibold">SEO Console</span>

          <select
            value={property}
            onChange={(e) => setProperty(e.target.value)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
          >
            {!sites.length && <option value="">No properties</option>}
            {sites.map((s) => (
              <option key={s.id} value={s.property}>
                {s.source === "bing" ? "Bing · " : ""}
                {s.property}
              </option>
            ))}
          </select>

          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {SEARCH_TYPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            onClick={runSync}
            disabled={syncing || !property}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent-soft disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync history"}
          </button>
          <span className="text-xs text-muted">{lastSyncText}</span>

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent-soft"
            >
              Settings
            </button>
            {user.picture && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.picture} alt="" className="h-7 w-7 rounded-full" />
            )}
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                location.reload();
              }}
              className="text-sm text-muted hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="mx-auto flex max-w-[1500px] gap-1 px-5">
          {(
            [
              ["performance", "Performance"],
              ["opportunities", "Opportunities"],
              ["indexing", "Indexing"],
              ["inspect", "URL Inspection"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-6">
        {notice && (
          <div className="mb-4 flex items-center justify-between rounded-lg border bg-surface p-3 text-sm">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-muted">
              ✕
            </button>
          </div>
        )}

        {tab === "inspect" && <UrlInspector property={property} />}
        {tab === "indexing" && <Indexing property={property} />}
        {tab === "opportunities" && (
          <Opportunities property={property} searchType={searchType} />
        )}

        {tab === "performance" && (
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
                {data?.compareRange
                  ? `  vs  ${data.compareRange.start} → ${data.compareRange.end}`
                  : ""}
              </span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {METRICS.map((m) => {
                const meta = METRIC_META[m];
                const val = data?.totals?.[m] ?? 0;
                const prevVal = data?.prevTotals?.[m];
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
                    onClick={() => setDimension(d.id)}
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
                rows={data?.breakdown ?? []}
                totalCount={data?.breakdownCount ?? 0}
                active={activeMetrics}
                compareOn={showRowDeltas}
                trend={filters.trend}
                onTrend={(t) => setFilters((f) => ({ ...f, trend: t }))}
              />
            </div>
          </>
        )}
      </main>

      {showSettings && (
        <SettingsPanel
          property={property}
          bingConnected={bingConnected}
          onClose={() => setShowSettings(false)}
          onChanged={loadSites}
        />
      )}
    </div>
  );
}
