"use client";

// All projects: one compact performance row per project the signed-in account
// owns (the project list comes from /api/projects, which is already limited
// to this account). Summaries load lazily for the rows on screen, a few at a
// time, and are cached; "Load all" fetches the rest on request.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../ProjectManager";
import { Favicon } from "../ProjectManager";
import { hostOf } from "@/lib/projectMatch";
import { DEFAULT_ITEM, buildShellPath, type ShellLocation } from "@/lib/v2/nav";
import { meetsKpi, needsAttention } from "@/lib/v2/summary/alerts";
import { CONTENT_STAGES, type ProjectSummary, type Section, type SummaryPart } from "@/lib/v2/summary/types";
import { fetchSummary, usePeriodChoice, useStored, writeStored, type Loaded } from "./summaryClient";
import { Delta, KpiStatusPill, PeriodPicker, StateBadge, fmtInt, fmtMoney, fmtPct, fmtPos } from "./summaryUi";
import { DataTable, MetricCard, buttonClass, type Column } from "./ui";

const PARTS: SummaryPart[] = ["gsc", "ga4", "kpi", "tasks", "content"];
const COLS_KEY = "seo-v2-portfolio-columns";

type ColId =
  | "clicks"
  | "sessions"
  | "keyEvents"
  | "kpi"
  | "overdue"
  | "completed"
  | "content"
  | "impressions"
  | "ctr"
  | "position"
  | "engaged"
  | "revenue";

const COLS: { id: ColId; label: string; default: boolean }[] = [
  { id: "clicks", label: "GSC clicks", default: true },
  { id: "sessions", label: "Organic sessions", default: true },
  { id: "keyEvents", label: "Organic key events", default: true },
  { id: "kpi", label: "KPI progress", default: true },
  { id: "overdue", label: "Overdue tasks", default: true },
  { id: "completed", label: "Done this month", default: true },
  { id: "content", label: "Content (demo)", default: true },
  { id: "impressions", label: "Impressions", default: false },
  { id: "ctr", label: "CTR", default: false },
  { id: "position", label: "Avg. position", default: false },
  { id: "engaged", label: "Engaged sessions", default: false },
  { id: "revenue", label: "Revenue", default: false },
];

const DEFAULT_COLS = COLS.filter((c) => c.default).map((c) => c.id);
const parseCols = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => COLS.some((c) => c.id === x)) as ColId[]) : null);

export function PortfolioDashboard({
  projects,
  onNavigate,
  onNewProject,
  emptyExtra,
}: {
  projects: Project[];
  onNavigate: (l: ShellLocation) => void;
  onNewProject: () => void;
  emptyExtra?: React.ReactNode;
}) {
  const [period, setPeriod] = usePeriodChoice();
  const [loaded, setLoaded] = useState<Map<number, Loaded>>(new Map());
  const colList = useStored<ColId[]>(COLS_KEY, DEFAULT_COLS, parseCols);
  const cols = useMemo(() => new Set(colList), [colList]);
  const [picker, setPicker] = useState(false);
  const periodKey = `${period.preset}|${period.compare}`;
  const generation = useRef(0);

  const toggleCol = (id: ColId) => writeStored(COLS_KEY, cols.has(id) ? colList.filter((c) => c !== id) : [...colList, id]);

  const requested = useRef(new Set<number>());
  const visible = useRef<number[]>([]);

  const load = useCallback(
    (ids: number[]) => {
      const gen = generation.current;
      const todo = ids.filter((id) => !requested.current.has(id));
      if (!todo.length) return;
      for (const id of todo) requested.current.add(id);
      setLoaded((prev) => {
        const next = new Map(prev);
        for (const id of todo) next.set(id, { status: "loading" });
        return next;
      });
      for (const id of todo) {
        fetchSummary({ projectId: id, preset: period.preset, compare: period.compare, parts: PARTS })
          .then((summary) => gen === generation.current && setLoaded((m) => new Map(m).set(id, { status: "ready", summary })))
          .catch((e) => gen === generation.current && setLoaded((m) => new Map(m).set(id, { status: "error", message: e instanceof Error ? e.message : String(e) })));
      }
    },
    [period.preset, period.compare],
  );

  // A new period starts a fresh set of summaries for the rows on screen.
  const firstPeriod = useRef(periodKey);
  useEffect(() => {
    if (firstPeriod.current === periodKey) return;
    firstPeriod.current = periodKey;
    generation.current++;
    requested.current = new Set();
    setLoaded(new Map());
    load(visible.current);
  }, [periodKey, load]);

  const summaryOf = (p: Project): ProjectSummary | undefined => {
    const l = loaded.get(p.id);
    return l?.status === "ready" ? l.summary : undefined;
  };
  const ready = projects.map(summaryOf).filter((s): s is ProjectSummary => Boolean(s));
  const sharedGsc = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of projects) if (p.gscProperty) count.set(p.gscProperty, (count.get(p.gscProperty) ?? 0) + 1);
    return count;
  }, [projects]);

  // Portfolio summaries. Counts, never sums of metrics across projects, so a
  // property mapped to two projects isn't counted twice; overdue tasks are
  // de-duplicated by Asana project.
  const active = projects.filter((p) => p.gscProperty || p.gaPropertyId).length;
  const kpiKnown = ready.map(meetsKpi).filter((v) => v != null);
  const meeting = kpiKnown.filter(Boolean).length;
  const attention = ready.filter(needsAttention).length;
  const overdueByAsana = new Map<string, number>();
  for (const p of projects) {
    const s = summaryOf(p);
    const t = s?.tasks;
    if (t?.data && (t.state === "live" || t.state === "demo")) overdueByAsana.set(p.asanaProjectGid || `project-${p.id}`, t.data.overdue);
  }
  const overdue = [...overdueByAsana.values()].reduce((a, b) => a + b, 0);
  const of = `from ${ready.length} of ${projects.length} loaded`;
  const anyDemo = ready.some((s) => s.demo || Object.values(s).some((v) => (v as Section<unknown>)?.state === "demo"));

  const open = (p: Project) => onNavigate({ kind: "project", projectId: p.id, ...DEFAULT_ITEM, sub: "" });

  const cell = (p: Project, part: "gsc" | "ga4" | "kpi" | "tasks" | "content", render: (s: ProjectSummary) => React.ReactNode) => {
    const l = loaded.get(p.id);
    if (!l || l.status === "loading") return <span className="inline-block h-3 w-12 animate-pulse rounded bg-border/70" aria-label="Loading" />;
    if (l.status === "error") return <span className="text-xs" style={{ color: "var(--bad)" }} title={l.message}>Error</span>;
    const sec = l.summary[part];
    if (!sec) return <span className="text-muted">—</span>;
    if (sec.state === "not-connected") return <span className="whitespace-nowrap text-xs text-muted" title={sec.message}>Not linked</span>;
    if (sec.state === "unavailable") return <span className="whitespace-nowrap text-xs text-muted" title={sec.message}>Unavailable</span>;
    if (sec.state === "error") return <span className="text-xs" style={{ color: "var(--bad)" }} title={sec.message}>Error</span>;
    return render(l.summary);
  };
  const num = (p: Project, get: (s: ProjectSummary) => number | null | undefined) => {
    const s = summaryOf(p);
    return s ? (get(s) ?? null) : null;
  };

  const metricCol = (
    id: ColId,
    part: "gsc" | "ga4",
    get: (s: ProjectSummary) => { current: number | null; previous: number | null } | null | undefined,
    format: (n: number | null) => string,
    opts: { lowerIsBetter?: boolean; absolute?: boolean } = {},
  ): Column<Project> => ({
    key: id,
    label: COLS.find((c) => c.id === id)!.label,
    numeric: true,
    value: (p) => num(p, (s) => get(s)?.current),
    render: (p) =>
      cell(p, part, (s) => {
        const pair = get(s);
        return (
          <span className="flex flex-col items-end leading-tight">
            <span>{format(pair?.current ?? null)}</span>
            <Delta pair={pair} lowerIsBetter={opts.lowerIsBetter} absolute={opts.absolute} />
          </span>
        );
      }),
  });

  const all: Record<ColId, Column<Project>> = {
    clicks: {
      ...metricCol("clicks", "gsc", (s) => s.gsc?.data?.clicks, fmtInt),
      render: (p) =>
        cell(p, "gsc", (s) => (
          <span className="flex flex-col items-end leading-tight">
            <span>
              {fmtInt(s.gsc?.data?.clicks.current)}
              {(sharedGsc.get(p.gscProperty ?? "") ?? 0) > 1 && (
                <span className="ml-1 text-[10px] text-muted" title="This Search Console property is linked to more than one project">
                  shared
                </span>
              )}
            </span>
            <Delta pair={s.gsc?.data?.clicks} />
          </span>
        )),
    },
    impressions: metricCol("impressions", "gsc", (s) => s.gsc?.data?.impressions, fmtInt),
    ctr: metricCol("ctr", "gsc", (s) => s.gsc?.data?.ctr, (n) => fmtPct(n)),
    position: metricCol("position", "gsc", (s) => s.gsc?.data?.position, fmtPos, { lowerIsBetter: true, absolute: true }),
    sessions: metricCol("sessions", "ga4", (s) => s.ga4?.data?.sessions, fmtInt),
    engaged: metricCol("engaged", "ga4", (s) => s.ga4?.data?.engagedSessions, fmtInt),
    keyEvents: metricCol("keyEvents", "ga4", (s) => s.ga4?.data?.keyEvents, fmtInt),
    revenue: {
      key: "revenue",
      label: "Revenue",
      numeric: true,
      // Not sortable across currencies: sorting uses the number within each currency only.
      value: (p) => num(p, (s) => s.ga4?.data?.revenue?.current),
      render: (p) =>
        cell(p, "ga4", (s) =>
          s.ga4?.data?.revenue ? (
            <span className="flex flex-col items-end leading-tight">
              <span>{fmtMoney(s.ga4.data.revenue.current, s.ga4.data.currency)}</span>
              <Delta pair={s.ga4.data.revenue} />
            </span>
          ) : (
            <span className="text-xs text-muted">Not tracked</span>
          ),
        ),
    },
    kpi: {
      key: "kpi",
      label: "KPI progress",
      value: (p) => {
        const items = summaryOf(p)?.kpi?.data?.items;
        return items?.length ? Math.min(...items.map((k) => k.projectedPct)) : null;
      },
      render: (p) =>
        cell(p, "kpi", (s) => {
          const items = s.kpi?.data?.items ?? [];
          const worst = items.reduce<"on-track" | "at-risk" | "off-track">(
            (w, k) => (k.status === "off-track" || (k.status === "at-risk" && w === "on-track") ? k.status : w),
            "on-track",
          );
          const onTrack = items.filter((k) => k.status === "on-track").length;
          return (
            <span className="flex items-center gap-2" title={items.map((k) => `${k.label}: projected ${Math.round(k.projectedPct)}%`).join("\n")}>
              <KpiStatusPill status={worst} />
              <span className="text-xs text-muted tabular-nums">
                {onTrack}/{items.length}
              </span>
            </span>
          );
        }),
    },
    overdue: {
      key: "overdue",
      label: "Overdue tasks",
      numeric: true,
      value: (p) => num(p, (s) => s.tasks?.data?.overdue),
      render: (p) =>
        cell(p, "tasks", (s) => (
          <span style={s.tasks?.data?.overdue ? { color: "var(--bad)", fontWeight: 600 } : undefined}>{fmtInt(s.tasks?.data?.overdue)}</span>
        )),
    },
    completed: {
      key: "completed",
      label: "Done this month",
      numeric: true,
      value: (p) => num(p, (s) => s.tasks?.data?.completedThisMonth),
      render: (p) => cell(p, "tasks", (s) => fmtInt(s.tasks?.data?.completedThisMonth)),
    },
    content: {
      key: "content",
      label: "Content (demo)",
      value: (p) => num(p, (s) => s.content?.data?.counts.published),
      render: (p) =>
        cell(p, "content", (s) => {
          const c = s.content!.data!.counts;
          const total = CONTENT_STAGES.reduce((a, k) => a + c[k], 0);
          return (
            <span className="flex items-center gap-2" title="Demo data: the content workflow isn't built yet">
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-border/70">
                <span className="block h-full rounded-full" style={{ width: `${total ? (c.published / total) * 100 : 0}%`, background: "var(--position)" }} />
              </span>
              <span className="text-xs tabular-nums text-muted">
                {c.published}/{total}
              </span>
            </span>
          );
        }),
    },
  };

  const columns: Column<Project>[] = [
    {
      key: "name",
      label: "Project",
      width: "24%",
      value: (p) => p.name,
      render: (p) => (
        <a
          href={buildShellPath({ kind: "project", projectId: p.id, ...DEFAULT_ITEM, sub: "" })}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            open(p);
          }}
          className="flex items-center gap-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Favicon src={p.faviconUrl} name={p.name} size={24} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium hover:underline">{p.name}</span>
              {summaryOf(p)?.demo && <StateBadge state="demo" small />}
            </span>
            <span className="block truncate text-xs text-muted">{p.websiteUrl ? hostOf(p.websiteUrl) : "No website"}</span>
          </span>
        </a>
      ),
    },
    ...COLS.filter((c) => cols.has(c.id)).map((c) => all[c.id]),
  ];

  const missing = projects.filter((p) => !loaded.has(p.id)).length;

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Active projects" value={`${active} of ${projects.length}`} hint="Search Console or GA4 linked" />
        <MetricCard label="Meeting KPIs" value={kpiKnown.length ? `${meeting} of ${kpiKnown.length}` : "—"} hint={kpiKnown.length ? `Projects with targets, ${of}` : `No KPI targets ${of}`} />
        <MetricCard label="Needing attention" value={ready.length ? String(attention) : "—"} hint={`Drops, off-track KPIs, overdue work or errors, ${of}`} />
        <MetricCard label="Overdue tasks" value={overdueByAsana.size ? String(overdue) : "—"} hint={`Asana, ${of}`} />
      </div>
      {anyDemo && (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted">
          <StateBadge state="demo" small /> Rows and cells marked Demo show invented sample data, not measurements.
        </p>
      )}
      <DataTable
        rows={projects}
        rowKey={(p) => String(p.id)}
        columns={columns}
        exportName="all-projects"
        searchPlaceholder="Search projects…"
        emptyText="No projects match."
        onVisibleRows={(rows) => {
          visible.current = rows.map((r) => r.id);
          load(visible.current);
        }}
        toolbar={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            <div className="relative">
              <button className={buttonClass} onClick={() => setPicker((v) => !v)} aria-expanded={picker}>
                Columns
              </button>
              {picker && (
                <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border bg-surface p-2 shadow-xl">
                  {COLS.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent-soft">
                      <input type="checkbox" checked={cols.has(c.id)} onChange={() => toggleCol(c.id)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {missing > 0 && (
              <button className={buttonClass} onClick={() => load(projects.map((p) => p.id))} title="Fetches summaries for every project, three at a time">
                Load all {projects.length}
              </button>
            )}
          </>
        }
        note={
          missing > 0
            ? `Numbers load for the projects on this page (${projects.length - missing} of ${projects.length} loaded). Sorting by a metric uses loaded rows; unloaded rows sort last.`
            : `All ${projects.length} projects loaded. Summaries are cached for 10 minutes.`
        }
      />
      {!projects.length && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={buttonClass} onClick={onNewProject}>
            New project
          </button>
          {emptyExtra}
        </div>
      )}
    </>
  );
}
