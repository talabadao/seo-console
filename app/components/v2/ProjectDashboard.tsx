"use client";

// The project dashboard: performance and work at a glance. Connection setup
// lives in Project settings; this page only reads summaries.

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Project } from "../ProjectManager";
import { Favicon } from "../ProjectManager";
import { hostOf } from "@/lib/projectMatch";
import { alertsFor, type Alert } from "@/lib/v2/summary/alerts";
import { ALL_PARTS, CONTENT_STAGES, CONTENT_STAGE_LABEL, type TaskData, type TaskRef } from "@/lib/v2/summary/types";
import { taskMonth } from "@/lib/v2/summary/period";
import type { ShellLocation } from "@/lib/v2/nav";
import { useSummary, usePeriodChoice } from "./summaryClient";
import {
  KPI_STATUS_DEFINITION,
  KpiStatusPill,
  PeriodPicker,
  ProgressBar,
  SectionCard,
  StateBadge,
  Stat,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtPos,
  fmtTime,
} from "./summaryUi";
import { buttonClass } from "./ui";
import { Icon } from "./icons";

export function ProjectDashboard({ project, onNavigate }: { project: Project; onNavigate: (l: ShellLocation) => void }) {
  const [period, setPeriod] = usePeriodChoice();
  const [nonce, setNonce] = useState(0);
  const loaded = useSummary({ projectId: project.id, preset: period.preset, compare: period.compare, parts: ALL_PARTS, detail: true }, nonce);
  const summary = loaded.status === "ready" ? loaded.summary : undefined;
  const loading = loaded.status === "loading";
  const go = (group: string, item: string, sub = "") => onNavigate({ kind: "project", projectId: project.id, group, item, sub });
  const settingsLink = (section: string, label = "Open settings") => (
    <button className={buttonClass} onClick={() => go("settings", "project", section)}>
      {label}
    </button>
  );
  const alerts = useMemo(() => (summary ? alertsFor(summary) : []), [summary]);
  const month = taskMonth();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Favicon src={project.faviconUrl} name={project.name} size={40} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
            {project.websiteUrl ? (
              <a href={project.websiteUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                {hostOf(project.websiteUrl)}
              </a>
            ) : (
              <span className="text-sm text-muted">No website set</span>
            )}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PeriodPicker value={period} onChange={setPeriod} />
          <button className={buttonClass} onClick={() => setNonce((n) => n + 1)} disabled={loading} title="Fetch fresh numbers from the sources">
            Refresh
          </button>
          <button className={buttonClass} onClick={() => go("settings", "project")} aria-label="Project settings">
            <Icon name="gear" className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border bg-surface px-4 py-2 text-xs text-muted">
        <span>
          <strong className="font-medium text-foreground">Performance:</strong> {summary?.period.label ?? "…"}
          {summary?.period.compareLabel ? ` vs ${summary.period.compareLabel}` : ""}
        </span>
        <span>
          <strong className="font-medium text-foreground">KPIs and tasks:</strong> calendar month{" "}
          {new Date(`${month.monthStart}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })} (UTC)
        </span>
        {summary && (
          <span>
            <strong className="font-medium text-foreground">Updated:</strong> {fmtTime(summary.generatedAt)}
            {summary.cached ? " (cached, refreshes every 15 min)" : ""}
          </span>
        )}
      </div>

      {summary?.demo && (
        <div role="note" className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm" style={{ borderColor: "var(--position)" }}>
          <StateBadge state="demo" />
          <p className="text-muted">
            <strong className="text-foreground">Demo project.</strong> Every number on this page is invented for illustration. No provider is called.
          </p>
        </div>
      )}
      {loaded.status === "error" && (
        <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          Couldn&apos;t load this project&apos;s summary: {loaded.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Search performance"
          section={summary?.gsc}
          loading={loading}
          className="xl:col-span-2"
          action={settingsLink("integrations", "Link Search Console")}
          headerExtra={
            <button className="text-xs text-accent hover:underline" onClick={() => go("search-console", "performance")}>
              Full report
            </button>
          }
        >
          {(d) => (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Clicks" value={fmtInt(d.clicks.current)} pair={d.clicks} />
                <Stat label="Impressions" value={fmtInt(d.impressions.current)} pair={d.impressions} />
                <Stat label="CTR" value={fmtPct(d.ctr.current)} pair={d.ctr} hint="Clicks ÷ impressions for the whole period, as Google reports it" />
                <Stat label="Avg. position" value={fmtPos(d.position.current)} pair={d.position} lowerIsBetter absolute hint="Google's impression-weighted average; lower is better" />
              </div>
              {d.series && d.series.length > 1 ? (
                <div className="mt-4 h-48" aria-label="Daily clicks and impressions">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={d.series} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                      <YAxis yAxisId="c" tick={{ fontSize: 11, fill: "var(--muted)" }} width={44} />
                      <YAxis yAxisId="i" orientation="right" tick={{ fontSize: 11, fill: "var(--muted)" }} width={52} />
                      <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }} />
                      <Line yAxisId="c" type="monotone" dataKey="clicks" name="Clicks" stroke="var(--clicks)" dot={false} strokeWidth={2} isAnimationActive={false} />
                      <Line yAxisId="i" type="monotone" dataKey="impressions" name="Impressions" stroke="var(--impressions)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted">No daily data in this period.</p>
              )}
            </>
          )}
        </SectionCard>

        <AttentionCard alerts={alerts} loading={loading} tasks={summary?.tasks?.data} tasksDemo={summary?.tasks?.state === "demo"} onGo={go} />

        <SectionCard
          title="Organic traffic (GA4)"
          section={summary?.ga4}
          loading={loading}
          action={settingsLink("integrations", "Link GA4")}
          headerExtra={
            <button className="text-xs text-accent hover:underline" onClick={() => go("analytics", "overview")}>
              Full report
            </button>
          }
        >
          {(d) => (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Sessions" value={fmtInt(d.sessions.current)} pair={d.sessions} hint="Organic Search channel; AI-search sources are excluded" />
                <Stat label="Engaged sessions" value={fmtInt(d.engagedSessions.current)} pair={d.engagedSessions} />
                <Stat label="Key events" value={fmtInt(d.keyEvents.current)} pair={d.keyEvents} />
                {d.revenue ? (
                  <Stat label={`Revenue (${d.currency})`} value={fmtMoney(d.revenue.current, d.currency)} pair={d.revenue} />
                ) : (
                  <div>
                    <div className="text-xs text-muted">Revenue</div>
                    <div className="mt-1 text-sm text-muted">Not tracked in this property</div>
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs text-muted">Organic Search channel only. Sources on the AI list are counted separately.</p>
            </>
          )}
        </SectionCard>

        <SectionCard title="Monthly KPIs" section={summary?.kpi} loading={loading} action={settingsLink("kpi", "Set KPI targets")}>
          {(d) => (
            <>
              <p className="mb-3 text-xs text-muted">
                {d.monthLabel}: day {d.daysElapsed} of {d.daysInMonth}
              </p>
              <ul className="space-y-3">
                {d.items.map((k) => (
                  <li key={k.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{k.label}</span>
                      <KpiStatusPill status={k.status} />
                    </div>
                    <ProgressBar pct={k.progressPct} status={k.status} />
                    <div className="mt-1 flex justify-between text-xs text-muted tabular-nums">
                      <span>
                        {fmtInt(k.actual)} of {fmtInt(k.target)} ({Math.round(k.progressPct)}%)
                      </span>
                      <span>Projected {Math.round(k.projectedPct)}%</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">{KPI_STATUS_DEFINITION}</p>
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Content progress"
          section={summary?.content}
          loading={loading}
          headerExtra={
            <button className="text-xs text-accent hover:underline" onClick={() => go("content", "board")}>
              Editorial board
            </button>
          }
        >
          {(d) => {
            const total = CONTENT_STAGES.reduce((a, s) => a + d.counts[s], 0);
            return (
              <>
                <ul className="space-y-2">
                  {CONTENT_STAGES.map((s) => (
                    <li key={s} className="grid grid-cols-[8rem_1fr_2rem] items-center gap-2 text-sm">
                      <span className="text-muted">{CONTENT_STAGE_LABEL[s]}</span>
                      <ProgressBar pct={total ? (d.counts[s] / total) * 100 : 0} />
                      <span className="text-right tabular-nums">{d.counts[s]}</span>
                    </li>
                  ))}
                </ul>
                {d.awaitingApproval.length > 0 && (
                  <div className="mt-3 text-xs">
                    <p className="font-medium">Awaiting client approval</p>
                    <ul className="mt-1 space-y-0.5 text-muted">
                      {d.awaitingApproval.map((a) => (
                        <li key={a.title}>
                          {a.title} · {a.since}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            );
          }}
        </SectionCard>

        <SectionCard title="Asana work" section={summary?.tasks} loading={loading} className="xl:col-span-3" action={settingsLink("integrations", "Link Asana")}>
          {(d) => <TasksBody d={d} />}
        </SectionCard>
      </div>
    </div>
  );
}

function AttentionCard({
  alerts,
  loading,
  tasks,
  tasksDemo,
  onGo,
}: {
  alerts: Alert[];
  loading: boolean;
  tasks: TaskData | undefined;
  tasksDemo: boolean;
  onGo: (group: string, item: string) => void;
}) {
  const color = { critical: "var(--bad)", warning: "var(--position)", info: "var(--accent)" } as const;
  return (
    <section className="flex flex-col rounded-xl border bg-surface">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Needs attention</h2>
      </div>
      <div className="flex-1 p-4 text-sm">
        {loading ? (
          <div className="space-y-3" role="status" aria-label="Loading alerts">
            {[70, 55].map((w) => (
              <div key={w} className="h-4 animate-pulse rounded bg-border/70" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : alerts.length ? (
          <ul className="space-y-2.5">
            {alerts.map((a) => (
              <li key={a.id} className="flex gap-2.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color[a.level] }} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-medium">
                    {a.title} {a.demo && <StateBadge state="demo" small />}
                  </p>
                  {a.detail && <p className="break-words text-xs text-muted">{a.detail}</p>}
                  {a.target && (
                    <button className="text-xs text-accent hover:underline" onClick={() => onGo(a.target!.group, a.target!.item)}>
                      Open
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Nothing needs attention in the data that&apos;s connected.</p>
        )}
        {!loading && tasks && tasks.recentlyCompleted.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              Recent activity {tasksDemo && <StateBadge state="demo" small />}
            </h3>
            <ul className="space-y-1 text-xs">
              {tasks.recentlyCompleted.slice(0, 4).map((t) => (
                <li key={t.gid} className="flex justify-between gap-2">
                  <span className="truncate">Completed: {t.name}</span>
                  <span className="shrink-0 text-muted">{t.completedAt?.slice(5, 10)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function TasksBody({ d }: { d: TaskData }) {
  const [tab, setTab] = useState<"overdue" | "upcoming" | "completed">(d.overdue ? "overdue" : "upcoming");
  const lists: Record<typeof tab, TaskRef[]> = { overdue: d.overdueTasks, upcoming: d.upcoming, completed: d.recentlyCompleted };
  const rows = lists[tab];
  return (
    <>
      <div className="flex flex-wrap items-end gap-6">
        <Stat label="Due this month" value={fmtInt(d.dueThisMonth)} hint="Tasks with a due date this month, done or not" />
        <Stat label="Completed this month" value={fmtInt(d.completedThisMonth)} hint="Counted by completion date" />
        <div>
          <div className="text-xs text-muted">Overdue</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums" style={d.overdue ? { color: "var(--bad)" } : undefined}>
            {fmtInt(d.overdue)}
          </div>
        </div>
        {d.projectUrl && (
          <a href={d.projectUrl} target="_blank" rel="noreferrer" className="ml-auto text-sm text-accent hover:underline">
            Open in Asana ↗
          </a>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        Month {d.monthStart} – {d.monthEnd} (UTC). Read-only: nothing is changed in Asana.
      </p>
      <div role="tablist" aria-label="Task lists" className="mt-4 flex gap-1 border-b text-sm">
        {(
          [
            ["overdue", `Overdue (${d.overdue})`],
            ["upcoming", "Upcoming deadlines"],
            ["completed", "Recently completed"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-1.5 ${tab === id ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {rows.length ? (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-2 py-2 font-medium">Task</th>
                <th className="px-2 py-2 font-medium">Assignee</th>
                <th className="px-2 py-2 font-medium">{tab === "completed" ? "Completed" : "Due"}</th>
                <th className="px-2 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.gid} className="border-t border-border/60">
                  <td className="max-w-[28rem] px-2 py-2">
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {t.name} <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      t.name
                    )}
                  </td>
                  <td className="px-2 py-2 text-muted">{t.assignee ?? "Unassigned"}</td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">{(tab === "completed" ? t.completedAt?.slice(0, 10) : t.dueOn) ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span className="text-xs" style={t.status === "overdue" ? { color: "var(--bad)" } : undefined}>
                      {t.status === "completed" ? "Completed" : t.status === "overdue" ? "Overdue" : "Open"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-4 text-sm text-muted">No tasks in this list.</p>
      )}
    </>
  );
}
