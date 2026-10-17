// Notification rules: from persisted sync results (the shared cache's saved sections) to candidate notifications.
// Pure — the store (./store.ts) reads the cache, applies the account's settings and inserts with dedupe.
//
// Never from demo, failed, partial or incomplete data:
// - only sections in the "live" state, with no access error;
// - a period whose data doesn't reach its last day yet (dataThrough < period end) is incomplete and skipped;
// - performance changes need a minimum volume in the comparison period, so small numbers don't trigger;
// - rankings need a minimum number of checked keywords and a comparison check.
// Dedupe keys are rule + project + period (+ item), so a change, task or digest is notified once.

import type { Ga4Data, GscData, PeriodInfo, RankingsData, Section, TaskData, TaskRef } from "@/lib/v2/summary/types";

export interface NotificationSettings {
  performance: { enabled: boolean; minChangePct: number; minClicks: number; minSessions: number };
  rankings: { enabled: boolean; minTop10Change: number; minAvgPositionChange: number; minKeywords: number };
  tasks: { enabled: boolean; upcomingDays: number; overdue: boolean; completed: boolean };
  docs: { enabled: boolean };
  digest: { enabled: boolean };
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  performance: { enabled: true, minChangePct: 20, minClicks: 100, minSessions: 100 },
  rankings: { enabled: true, minTop10Change: 3, minAvgPositionChange: 3, minKeywords: 10 },
  tasks: { enabled: true, upcomingDays: 3, overdue: true, completed: true },
  docs: { enabled: true },
  digest: { enabled: true },
};

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Merges stored (possibly partial or older) settings over the defaults, clamping every number. */
export function normalizeSettings(raw: unknown): NotificationSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const d = DEFAULT_SETTINGS;
  return {
    performance: {
      enabled: bool(r.performance?.enabled, d.performance.enabled),
      minChangePct: num(r.performance?.minChangePct, 1, 1000, d.performance.minChangePct),
      minClicks: num(r.performance?.minClicks, 0, 1e9, d.performance.minClicks),
      minSessions: num(r.performance?.minSessions, 0, 1e9, d.performance.minSessions),
    },
    rankings: {
      enabled: bool(r.rankings?.enabled, d.rankings.enabled),
      minTop10Change: num(r.rankings?.minTop10Change, 1, 10000, d.rankings.minTop10Change),
      minAvgPositionChange: num(r.rankings?.minAvgPositionChange, 0.1, 100, d.rankings.minAvgPositionChange),
      minKeywords: num(r.rankings?.minKeywords, 1, 100000, d.rankings.minKeywords),
    },
    tasks: {
      enabled: bool(r.tasks?.enabled, d.tasks.enabled),
      upcomingDays: num(r.tasks?.upcomingDays, 0, 30, d.tasks.upcomingDays),
      overdue: bool(r.tasks?.overdue, d.tasks.overdue),
      completed: bool(r.tasks?.completed, d.tasks.completed),
    },
    docs: { enabled: bool(r.docs?.enabled, d.docs.enabled) },
    digest: { enabled: bool(r.digest?.enabled, d.digest.enabled) },
  };
}

export type Severity = "info" | "warning" | "critical";

export interface Candidate {
  rule: "performance" | "rankings" | "tasks" | "content" | "docs" | "digest";
  dedupeKey: string;
  projectId: number | null;
  severity: Severity;
  title: string;
  body: string;
  href: string | null;
  sourceAt: number;
}

/** One saved section from the shared cache. */
export interface CachedSection {
  kind: string;
  projectId: number;
  projectName: string;
  query: { period?: PeriodInfo };
  payload: Section<unknown>;
  fetchedAt: number;
}

/** ISO week of a date (YYYY-Www), used so a performance or ranking change is notified at most once a week. */
export function isoWeek(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const dayMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const pct = (cur: number, prev: number) => ((cur - prev) / prev) * 100;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Live, complete data only (see the header). */
export function usable(s: CachedSection): boolean {
  const p = s.payload;
  if (!p || p.state !== "live" || !p.data) return false;
  const end = s.query.period?.current?.end;
  if (end && p.dataThrough && p.dataThrough < end) return false;
  return true;
}

function performance(s: CachedSection, cfg: NotificationSettings["performance"]): Candidate[] {
  // The dashboard's default comparison only (last 28 days vs the previous 28), to avoid one alert per preset.
  const period = s.query.period;
  if (!period?.previous || period.preset !== "last28" || period.compare !== "previous") return [];
  const out: Candidate[] = [];
  const week = isoWeek(period.current.end);
  const check = (metric: string, label: string, pair: { current: number | null; previous: number | null } | undefined, min: number, href: string, source: string) => {
    if (!pair || pair.current == null || pair.previous == null || pair.previous < Math.max(1, min)) return;
    const change = pct(pair.current, pair.previous);
    if (Math.abs(change) < cfg.minChangePct) return;
    const up = change > 0;
    out.push({
      rule: "performance",
      dedupeKey: `performance:${metric}:${s.projectId}:${week}`,
      projectId: s.projectId,
      severity: up ? "info" : Math.abs(change) >= cfg.minChangePct * 2 ? "critical" : "warning",
      title: `${s.projectName}: ${label} ${up ? "up" : "down"} ${Math.abs(change).toFixed(0)}%`,
      body: `${fmt(pair.current)} in ${period.current.start} – ${period.current.end} vs ${fmt(pair.previous)} in the previous 28 days (${source}).`,
      href,
      sourceAt: dayMs(period.current.end),
    });
  };
  if (s.kind === "summary:gsc") {
    const d = s.payload.data as GscData;
    check("gsc-clicks", "Search Console clicks", d.clicks, cfg.minClicks, `/p/${s.projectId}/search-console/performance`, "Google Search Console");
  }
  if (s.kind === "summary:ga4") {
    const d = s.payload.data as Ga4Data;
    check("ga4-organic-sessions", "organic sessions", d.sessions, cfg.minSessions, `/p/${s.projectId}/analytics/overview`, "GA4, Organic Search");
  }
  return out;
}

function rankings(s: CachedSection, cfg: NotificationSettings["rankings"]): Candidate[] {
  const d = s.payload.data as RankingsData;
  if (!d.previous || !d.context.comparisonDate || d.current.checked < cfg.minKeywords || d.previous.checked < cfg.minKeywords) return [];
  const top10 = d.current.top10 - d.previous.top10;
  const avg = d.current.avgPosition != null && d.previous.avgPosition != null ? d.current.avgPosition - d.previous.avgPosition : 0;
  const bigTop10 = Math.abs(top10) >= cfg.minTop10Change;
  const bigAvg = Math.abs(avg) >= cfg.minAvgPositionChange;
  if (!bigTop10 && !bigAvg) return [];
  const better = bigTop10 ? top10 > 0 : avg < 0;
  const parts = [
    `Top 10: ${d.previous.top10} → ${d.current.top10}`,
    d.current.avgPosition != null && d.previous.avgPosition != null ? `average position ${d.previous.avgPosition} → ${d.current.avgPosition}` : null,
  ].filter(Boolean);
  return [
    {
      rule: "rankings",
      dedupeKey: `rankings:${s.projectId}:${isoWeek(d.context.latestDate)}`,
      projectId: s.projectId,
      severity: better ? "info" : "warning",
      title: `${s.projectName}: rankings ${better ? "improved" : "dropped"}`,
      body: `${parts.join("; ")} (${d.context.comparisonDate} → ${d.context.latestDate}, ${d.context.engine}, SE Ranking).`,
      href: `/p/${s.projectId}/organic-serp/se-ranking`,
      sourceAt: dayMs(d.context.latestDate),
    },
  ];
}

const MAX_PER_KIND = 5;

function tasks(s: CachedSection, cfg: NotificationSettings["tasks"], now: number): Candidate[] {
  const d = s.payload.data as TaskData;
  const out: Candidate[] = [];
  const href = `/p/${s.projectId}/dashboard/overview`;
  const add = (list: TaskRef[], make: (t: TaskRef) => Candidate, summaryKey: string, summaryTitle: (n: number) => string) => {
    list.slice(0, MAX_PER_KIND).forEach((t) => out.push(make(t)));
    if (list.length > MAX_PER_KIND) {
      const n = list.length - MAX_PER_KIND;
      out.push({ ...make(list[MAX_PER_KIND]), dedupeKey: `${summaryKey}:${s.projectId}:${d.today}`, title: summaryTitle(n), body: `${n} more in ${s.projectName}'s Asana project.` });
    }
  };
  if (cfg.overdue) {
    add(
      d.overdueTasks,
      (t) => ({
        rule: "tasks",
        dedupeKey: `tasks-overdue:${s.projectId}:${t.gid}:${t.dueOn}`,
        projectId: s.projectId,
        severity: "warning",
        title: `${s.projectName}: overdue task`,
        body: `“${t.name}” was due ${t.dueOn}${t.assignee ? ` (${t.assignee})` : ""}.`,
        href,
        sourceAt: t.dueOn ? dayMs(t.dueOn) : now,
      }),
      "tasks-overdue-more",
      (n) => `${s.projectName}: ${n} more overdue tasks`,
    );
  }
  const horizon = d.today && dayMs(d.today) + cfg.upcomingDays * 86_400_000;
  add(
    d.upcoming.filter((t) => t.dueOn && horizon && dayMs(t.dueOn) <= horizon && dayMs(t.dueOn) >= dayMs(d.today)),
    (t) => ({
      rule: "tasks",
      dedupeKey: `tasks-upcoming:${s.projectId}:${t.gid}:${t.dueOn}`,
      projectId: s.projectId,
      severity: "info",
      title: `${s.projectName}: task due ${t.dueOn === d.today ? "today" : t.dueOn}`,
      body: `“${t.name}”${t.assignee ? ` (${t.assignee})` : ""}.`,
      href,
      sourceAt: t.dueOn ? dayMs(t.dueOn) : now,
    }),
    "tasks-upcoming-more",
    (n) => `${s.projectName}: ${n} more tasks due soon`,
  );
  if (cfg.completed) {
    // Real content progress = tasks completed in the project's Asana project (the content workflow itself is
    // still demo-only and never notifies). Only the last 7 days, so connecting a project doesn't flood.
    add(
      d.recentlyCompleted.filter((t) => t.completedAt && Date.parse(t.completedAt) >= now - 7 * 86_400_000),
      (t) => ({
        rule: "content",
        dedupeKey: `tasks-done:${s.projectId}:${t.gid}`,
        projectId: s.projectId,
        severity: "info",
        title: `${s.projectName}: task completed`,
        body: `“${t.name}”${t.assignee ? ` by ${t.assignee}` : ""}.`,
        href,
        sourceAt: Date.parse(t.completedAt!),
      }),
      "tasks-done-more",
      (n) => `${s.projectName}: ${n} more tasks completed`,
    );
  }
  return out;
}

/** Candidates from the account's saved sections, by its settings. */
export function candidatesFrom(sections: CachedSection[], settings: NotificationSettings, now = Date.now()): Candidate[] {
  const out: Candidate[] = [];
  for (const s of sections) {
    if (!usable(s)) continue;
    if ((s.kind === "summary:gsc" || s.kind === "summary:ga4") && settings.performance.enabled) out.push(...performance(s, settings.performance));
    if (s.kind === "summary:rankings" && settings.rankings.enabled) out.push(...rankings(s, settings.rankings));
    if (s.kind === "summary:tasks" && settings.tasks.enabled) out.push(...tasks(s, settings.tasks, now));
  }
  // The same key can come from several cached periods: keep the first.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.dedupeKey) ? false : (seen.add(c.dedupeKey), true)));
}

/** The weekly digest for the week before `now` (one per account per ISO week), from that week's notifications. */
export function digestCandidate(counts: Record<string, number>, projects: number, now = Date.now()): Candidate {
  const today = new Date(now).toISOString().slice(0, 10);
  const week = isoWeek(today);
  const n = (k: string) => counts[k] ?? 0;
  const lines = [
    `${n("performance")} performance change${n("performance") === 1 ? "" : "s"}`,
    `${n("rankings")} ranking change${n("rankings") === 1 ? "" : "s"}`,
    `${n("tasks")} task alert${n("tasks") === 1 ? "" : "s"}`,
    `${n("content")} completed task${n("content") === 1 ? "" : "s"}`,
    `${n("docs")} new Docs article${n("docs") === 1 ? "" : "s"}`,
  ];
  return {
    rule: "digest",
    dedupeKey: `digest:${week}`,
    projectId: null,
    severity: "info",
    title: `Weekly digest (${week})`,
    body: `Across ${projects} project${projects === 1 ? "" : "s"} in the last 7 days: ${lines.join(", ")}.`,
    href: "/portfolio",
    sourceAt: now,
  };
}
