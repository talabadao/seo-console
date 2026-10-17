"use client";

// The project dashboard: performance and work at a glance. Connection setup
// lives in Project settings; this page only reads summaries.

import { useMemo, useState } from "react";
import { useThumbnails } from "./useThumbnails";
import type { Project } from "../ProjectManager";
import { Favicon } from "../ProjectManager";
import { hostOf } from "@/lib/projectMatch";
import { alertsFor, type Alert } from "@/lib/v2/summary/alerts";
import { ALL_PARTS, CONTENT_STAGES, CONTENT_STAGE_LABEL, type GscData, type InsightLists, type TaskData, type TaskRef } from "@/lib/v2/summary/types";
import { readableUrl } from "@/lib/v2/summary/insights";
import { PROJECTION_LABEL } from "@/lib/v2/summary/kpi";
import { taskMonth } from "@/lib/v2/summary/period";
import type { ShellLocation } from "@/lib/v2/nav";
import { useSummary, usePeriodChoice } from "./summaryClient";
import {
  AttainmentPill,
  Delta,
  KPI_DEFINITION,
  PeriodPicker,
  Sparkline,
  fmtCompact,
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
import { useCanManage } from "./Workspace";

export function ProjectDashboard({ project, onNavigate }: { project: Project; onNavigate: (l: ShellLocation) => void }) {
  const canManage = useCanManage();
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
          {canManage && (
            <button className={buttonClass} onClick={() => setNonce((n) => n + 1)} disabled={loading} title="Fetch fresh numbers from the sources">
              Refresh
            </button>
          )}
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
          title="Search Console insights"
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
          {(d) => <GscInsights d={d} projectId={project.id} onMore={(sub) => go("search-console", "performance", sub)} />}
        </SectionCard>

        <AttentionCard alerts={alerts} loading={loading} tasks={summary?.tasks?.data} tasksDemo={summary?.tasks?.state === "demo"} onGo={go} />

        <SectionCard
          title="Traffic (GA4)"
          section={summary?.ga4}
          loading={loading}
          action={settingsLink("integrations", "Link GA4")}
          headerExtra={
            <span className="flex gap-3">
              <button className="text-xs text-accent hover:underline" onClick={() => go("analytics", "llm-traffic")}>
                LLMs Traffic
              </button>
              <button className="text-xs text-accent hover:underline" onClick={() => go("analytics", "overview")}>
                Full report
              </button>
            </span>
          }
        >
          {(d) => (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Organic sessions" scope="Organic Search channel" value={fmtInt(d.sessions.current)} pair={d.sessions} />
                <Stat label="AI sessions" scope="Sources on your AI list" value={fmtInt(d.aiSessions.current)} pair={d.aiSessions} />
                {d.revenue ? (
                  <Stat label={`Revenue (${d.currency})`} scope="Organic Search sessions" value={fmtMoney(d.revenue.current, d.currency)} pair={d.revenue} />
                ) : (
                  <div>
                    <div className="text-xs text-muted">Revenue</div>
                    <div className="text-[11px] text-muted">Organic Search sessions</div>
                    <div className="mt-1 text-sm text-muted">Not tracked in this property</div>
                  </div>
                )}
                <Stat label="Key events" scope="All key events, Organic Search" value={fmtInt(d.keyEvents.current)} pair={d.keyEvents} />
              </div>
              <p className="mt-3 text-xs text-muted">
                AI sessions use the AI search sources list in Settings, the same list as LLMs Traffic. Key events are every GA4 key event; lead KPIs use only the
                project&apos;s selected lead events.
              </p>
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Keyword rankings (SE Ranking)"
          section={summary?.rankings}
          loading={loading}
          action={settingsLink("integrations", "Choose SE Ranking project")}
          headerExtra={
            <button className="text-xs text-accent hover:underline" onClick={() => go("organic-serp", "se-ranking")}>
              Rank tracking
            </button>
          }
        >
          {(d) => {
            const p = d.previous;
            const pair = (k: "top3" | "top5" | "top10" | "avgPosition") => ({ current: d.current[k], previous: p ? p[k] : null });
            const c = d.context;
            return (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Top 3" value={fmtInt(d.current.top3)} pair={pair("top3")} absolute integer hint="Keywords at positions 1–3" />
                  <Stat label="Top 5" value={fmtInt(d.current.top5)} pair={pair("top5")} absolute integer hint="Keywords at positions 1–5 (includes the top 3)" />
                  <Stat label="Top 10" value={fmtInt(d.current.top10)} pair={pair("top10")} absolute integer hint="Keywords at positions 1–10 (includes the top 5)" />
                  <Stat
                    label="Avg. position"
                    value={fmtPos(d.current.avgPosition)}
                    pair={pair("avgPosition")}
                    lowerIsBetter
                    absolute
                    hint="SE Ranking's average: every checked keyword, with keywords outside the top 100 counted as 100. Not the Search Console average."
                  />
                </div>
                <p className="mt-3 text-xs text-muted">
                  Cumulative counts of {fmtInt(c.trackedKeywords)} tracked keywords ({fmtInt(d.current.ranked)} in the top 100; average of ranked
                  keywords only {fmtPos(d.current.rankedAvgPosition)}). {c.engine}
                  {c.region ? ` · ${c.region}` : ""}
                  {c.language ? ` · ${c.language}` : ""}
                  {c.device ? ` · ${c.device}` : ""} · {c.keywordGroup}. Checked {c.latestDate}
                  {c.comparisonDate ? ` vs ${c.comparisonDate}` : " (no earlier check to compare)"}
                  {c.otherEngines > 0 ? `; ${c.otherEngines} other search engine${c.otherEngines === 1 ? "" : "s"} not included` : ""}.
                </p>
              </>
            );
          }}
        </SectionCard>

        <SectionCard title="Monthly KPIs" section={summary?.kpi} loading={loading} action={settingsLink("kpi", "Plan KPI targets")}>
          {(d) => (
            <>
              <p className="mb-3 text-xs text-muted">
                {d.monthLabel}: day {d.daysElapsed} of {d.daysInMonth}, month to date against the full-month target.
              </p>
              <ul className="space-y-3">
                {d.items.map((k) => (
                  <li key={k.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{k.label}</span>
                      <AttainmentPill attainment={k.attainment} />
                    </div>
                    <ProgressBar
                      pct={k.attainmentPct}
                      tone={k.attainment === "achieved" ? "good" : k.attainment === "below" || k.attainment === "above" ? "bad" : "neutral"}
                    />
                    <div className="mt-1 flex flex-wrap justify-between gap-x-2 text-xs text-muted tabular-nums">
                      <span>
                        {fmtInt(k.actual)} of {fmtInt(k.target)} ({Math.round(k.attainmentPct)}% of target)
                      </span>
                      <span style={{ color: k.projection === "achieved" ? "var(--good)" : undefined }}>
                        {PROJECTION_LABEL[k.projection]} ({Math.round(k.projectedPct)}%)
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {d.notes.map((n) => (
                <p key={n} className="mt-3 text-xs" style={{ color: "var(--bad)" }}>
                  {n}
                </p>
              ))}
              <p className="mt-3 text-xs text-muted">
                Leads = {d.leadEvents.length ? d.leadEvents.join(", ") : "no lead events chosen"}.{" "}
                <button className="text-accent hover:underline" onClick={() => go("settings", "project", "analytics")}>
                  Change
                </button>
              </p>
              <p className="mt-2 text-xs text-muted">{KPI_DEFINITION}</p>
            </>
          )}
        </SectionCard>

        <SectionCard title="Asana work" section={summary?.tasks} loading={loading} className="xl:col-span-2" action={settingsLink("integrations", "Link Asana")}>
          {(d) => <TasksBody d={d} />}
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
                      <ProgressBar pct={total ? (d.counts[s] / total) * 100 : 0} tone="demo" />
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
      </div>
    </div>
  );
}

const INSIGHT_TABS = [
  ["top", "Top"],
  ["up", "Trending up"],
  ["down", "Trending down"],
] as const;

function GscInsights({ d, projectId, onMore }: { d: GscData; projectId: number; onMore: (sub: string) => void }) {
  const clicks = d.series?.map((p) => p.clicks) ?? [];
  const impressions = d.series?.map((p) => p.impressions) ?? [];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-end justify-between gap-3 rounded-lg border p-3">
          <Stat label="Clicks" value={fmtCompact(d.clicks.current)} pair={d.clicks} />
          <Sparkline values={clicks} color="var(--clicks)" />
        </div>
        <div className="flex items-end justify-between gap-3 rounded-lg border p-3">
          <Stat label="Impressions" value={fmtCompact(d.impressions.current)} pair={d.impressions} />
          <Sparkline values={impressions} color="var(--impressions)" />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        CTR {fmtPct(d.ctr.current)} · Avg. position {fmtPos(d.position.current)} (Search Console)
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <InsightList title="Your content" lists={d.pages} kind="page" projectId={projectId} onMore={() => onMore("pages")} />
        <InsightList title="Queries leading to your site" lists={d.queries} kind="query" onMore={() => onMore("queries")} />
      </div>
    </>
  );
}

function InsightList({
  title,
  lists,
  kind,
  projectId,
  onMore,
}: {
  title: string;
  lists: InsightLists | undefined;
  kind: "page" | "query";
  projectId?: number;
  onMore: () => void;
}) {
  const [tab, setTab] = useState<"top" | "up" | "down">("top");
  const rows = lists?.[tab] ?? [];
  const { setNode: thumbRef, images: thumbImages, busy: thumbBusy, broken: thumbBroken, refresh: thumbRefresh } = useThumbnails(kind === "page" ? projectId : undefined, rows.map((r) => r.key));
  return (
    <div className="min-w-0 rounded-lg border" ref={thumbRef}>
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="flex items-center gap-3">
          {kind === "page" && projectId && (
            <button className="text-xs text-muted hover:text-foreground hover:underline" onClick={thumbRefresh} disabled={thumbBusy} title="Reads these pages again for their og:image or article image (saved for 7 days)">
              {thumbBusy ? "Refreshing…" : "Refresh thumbnails"}
            </button>
          )}
          <button className="text-xs text-accent hover:underline" onClick={onMore}>
            View more ›
          </button>
        </span>
      </div>
      <div role="tablist" aria-label={title} className="mt-2 flex gap-1 border-b px-2 text-xs">
        {INSIGHT_TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-2 py-1.5 ${tab === id ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center pr-1 text-muted">Clicks</span>
      </div>
      {rows.length ? (
        <ul className="divide-y">
          {rows.map((r) => {
            const url = kind === "page" ? readableUrl(r.key) : null;
            return (
              <li key={r.key} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                {kind === "page" && thumbImages[r.key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbImages[r.key]!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    width={40}
                    height={28}
                    className="h-7 w-10 shrink-0 rounded-md border object-cover"
                    onError={() => thumbBroken(r.key)}
                  />
                ) : (
                  <span className={`flex h-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent ${kind === "page" && projectId ? "w-10" : "w-7"}`} aria-hidden="true">
                    <Icon name={kind === "page" ? "doc" : "search"} className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  {url ? (
                    <a href={r.key} target="_blank" rel="noreferrer" className="block truncate hover:underline" title={r.key}>
                      {url.path}
                    </a>
                  ) : (
                    <span className="block truncate" title={r.key}>
                      {r.key}
                    </span>
                  )}
                  {url?.host && <span className="block truncate text-[11px] text-muted">{url.host}</span>}
                </span>
                <Delta pair={{ current: r.clicks, previous: r.previousClicks }} />
                <span className="w-12 shrink-0 text-right tabular-nums">{fmtCompact(r.clicks)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-3 py-4 text-xs text-muted">{tab === "top" ? "No clicks in this period." : "No rows with a known comparison value moved this way."}</p>
      )}
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
