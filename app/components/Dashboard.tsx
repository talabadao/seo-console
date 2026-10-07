"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Chart, type SeriesPoint } from "./Chart";
import { BreakdownTable, type BreakdownRow } from "./BreakdownTable";
import { DateRangePicker, type RangeValue } from "./DateRangePicker";
import { FilterMenu } from "./FilterMenu";
import { Indexing } from "./Indexing";
import { Opportunities } from "./Opportunities";
import { Analytics } from "./Analytics";
import { WeeklyReport } from "./WeeklyReport";
import { PageSpeed } from "./PageSpeed";
import { SettingsPanel } from "./SettingsPanel";
import { GoogleReconnectBanner } from "./GoogleReconnect";
import { ProjectManager, ProjectPicker, type Project, type ProjectView } from "./ProjectManager";
import { METRICS, METRIC_META, type MetricKey, delta, deltaLabel, fmt } from "./format";
import {
  DEFAULT_FILTER_CONFIG,
  EMPTY_FILTER,
  applyFilters,
  filterActive,
  type FilterState,
} from "@/lib/queryFilters";
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

const SEARCH_TYPES = [
  { id: "web", label: "Web" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "news", label: "News" },
  { id: "discover", label: "Discover" },
];

// Computed once at module load. Only used as the seed for the "custom" preset —
// every other preset is resolved from `preset` on each request, server-side.
const PROJECT_KEY = "seo-project";

const INITIAL_RANGE: RangeValue = {
  preset: "28d",
  start: format(new Date(Date.now() - 28 * 86400000), "yyyy-MM-dd"),
  end: format(new Date(Date.now() - 86400000), "yyyy-MM-dd"),
  grain: "day",
  compareMode: "none",
  matchWeekdays: false,
};

type Tab =
  | "performance"
  | "opportunities"
  | "analytics"
  | "indexing"
  | "weekly-report"
  | "pagespeed";

// Tabs fed by the project's Search Console property, and by its GA4 property.
const GSC_TABS: Tab[] = ["performance", "opportunities", "indexing"];
const GA_TABS: Tab[] = ["analytics", "weekly-report"];

function MissingAsset({
  asset,
  project,
  onEdit,
}: {
  asset: string;
  project: string;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-xl border bg-surface p-6 text-sm">
      <p className="font-medium">
        {project} has no {asset} linked.
      </p>
      <p className="mt-1 text-muted">Link one in the project settings to see this tab.</p>
      <button
        onClick={onEdit}
        className="mt-3 rounded-md bg-accent px-3 py-1.5 font-medium text-white"
      >
        Edit project
      </button>
    </div>
  );
}

export function Dashboard({
  user,
  bingConnected,
}: {
  user: { email: string; name: string | null; picture: string | null };
  bingConnected: boolean;
}) {
  const [sites, setSites] = useState<SiteMeta[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectView, setProjectView] = useState<ProjectView | null>(null);
  const [range, setRange] = useState<RangeValue>(INITIAL_RANGE);
  const [searchType, setSearchType] = useState("web");
  const [dimension, setDimension] = useState("query");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(["clicks", "impressions"]);
  const [data, setData] = useState<PerfResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<Tab>("performance");
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

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
    if (json.needsReconnect) setNeedsReconnect(true);
    setSites(json.sites ?? []);
  }, []);

  // `selectId` switches to that project (after creating/editing one); otherwise
  // the current selection is kept, falling back to the one used last time.
  const loadProjects = useCallback(async (selectId?: number) => {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const list: Project[] = (await res.json()).projects ?? [];
    setProjects(list);
    setProjectsLoaded(true);
    setProjectId((cur) => {
      let stored: number | null = null;
      try {
        stored = Number(localStorage.getItem(PROJECT_KEY)) || null;
      } catch {}
      const pick = [selectId, cur, stored].find((id) => id != null && list.some((p) => p.id === id));
      return pick ?? list[0]?.id ?? null;
    });
  }, []);

  // Sites first: the one-time project seeding on the server pairs projects
  // with the Search Console properties that request has just refreshed.
  useEffect(() => {
    (async () => {
      await loadSites();
      await loadProjects();
    })();
  }, [loadSites, loadProjects]);

  useEffect(() => {
    if (projectId == null) return;
    try {
      localStorage.setItem(PROJECT_KEY, String(projectId));
    } catch {}
  }, [projectId]);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const property = project?.gscProperty ?? "";
  const gaPropertyId = project?.gaPropertyId ?? "";

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
      if (json.needsReconnect) setNeedsReconnect(true);
      else if (res.ok) setData(json);
      else setNotice(json.error ?? "Failed to load");
    } finally {
      setLoading(false);
    }
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
        fp: filters.filterPage.trim().length > 0,
        fq: filters.filterQuery.trim().length > 0,
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

          <ProjectPicker
            projects={projects}
            value={projectId}
            onChange={setProjectId}
            onManage={() => setProjectView("list")}
            onNew={() => setProjectView("new")}
          />

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
              ["analytics", "Analytics"],
              ["weekly-report", "Weekly Report"],
              ["indexing", "Indexing"],
              ["pagespeed", "Page Speed"],
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

        {needsReconnect ? (
          <GoogleReconnectBanner detail="Google stopped accepting this app's Search Console access — sign in again to reconnect Performance, Opportunities, and Indexing." />
        ) : !project ? (
          projectsLoaded && (
            <div className="mx-auto max-w-lg rounded-2xl border bg-surface p-8 text-center">
              <h2 className="text-lg font-semibold">Create your first project</h2>
              <p className="mt-2 text-sm text-muted">
                A project groups one brand&apos;s website with its Search Console and Google
                Analytics properties, so every tab shows that brand&apos;s data together.
              </p>
              <button
                onClick={() => setProjectView("new")}
                className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
              >
                New project
              </button>
            </div>
          )
        ) : GSC_TABS.includes(tab) && !property ? (
          <MissingAsset
            asset="Search Console property"
            project={project.name}
            onEdit={() => setProjectView(project.id)}
          />
        ) : GA_TABS.includes(tab) && !gaPropertyId ? (
          <MissingAsset
            asset="Google Analytics (GA4) property"
            project={project.name}
            onEdit={() => setProjectView(project.id)}
          />
        ) : (
          <>
            {tab === "indexing" && (
              <Indexing property={property} neverSynced={!currentSite?.lastSync?.finished_at} />
            )}
            {tab === "analytics" && <Analytics key={gaPropertyId} fixedPropertyId={gaPropertyId} />}
            {tab === "weekly-report" && <WeeklyReport key={gaPropertyId} fixedPropertyId={gaPropertyId} />}
            {tab === "opportunities" && (
              <Opportunities property={property} searchType={searchType} />
            )}
            {tab === "pagespeed" && (
              <PageSpeed key={project.id} projectId={project.id} websiteUrl={project.websiteUrl} />
            )}
          </>
        )}

        {!needsReconnect && property && tab === "performance" && (
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
        )}
      </main>

      {projectView != null && (
        <ProjectManager
          projects={projects}
          gscProperties={sites.filter((s) => s.source === "google").map((s) => s.property)}
          initialView={projectView}
          onClose={() => setProjectView(null)}
          onChanged={loadProjects}
        />
      )}

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
