// "Needs attention" items, derived only from a summary's own data. Nothing
// here is invented: no data, no alert. Alerts from demo sections carry
// demo: true and are labelled as such.

import { pctChange } from "./period";
import type { ProjectSummary, Section } from "./types";

export type AlertLevel = "critical" | "warning" | "info";

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  detail?: string;
  demo: boolean;
  /** Where to act on it: a nav target inside the project. */
  target?: { group: string; item: string };
}

/** A drop at least this large, on a base at least MIN_BASE, is worth flagging. */
export const DROP_PCT = -20;
const MIN_BASE = { clicks: 50, sessions: 50 };

const isDemo = (s?: Section<unknown>) => s?.state === "demo";

export function alertsFor(s: ProjectSummary): Alert[] {
  const out: Alert[] = [];

  const gsc = s.gsc;
  if (gsc?.data && (gsc.state === "live" || gsc.state === "demo")) {
    const { current, previous } = gsc.data.clicks;
    const ch = pctChange(current, previous);
    if (ch != null && ch <= DROP_PCT && (previous ?? 0) >= MIN_BASE.clicks) {
      out.push({
        id: "gsc-clicks-drop",
        level: ch <= -40 ? "critical" : "warning",
        title: `Organic clicks down ${Math.abs(Math.round(ch))}%`,
        detail: `${fmt(current)} vs ${fmt(previous)} in the comparison period (Search Console).`,
        demo: isDemo(gsc),
        target: { group: "search-console", item: "performance" },
      });
    }
    if (gsc.stale) {
      out.push({
        id: "gsc-stale",
        level: "info",
        title: "Search Console data is behind",
        detail: gsc.dataThrough ? `Latest data is from ${gsc.dataThrough}.` : undefined,
        demo: isDemo(gsc),
      });
    }
  }

  const ga4 = s.ga4;
  if (ga4?.data && (ga4.state === "live" || ga4.state === "demo")) {
    const { current, previous } = ga4.data.sessions;
    const ch = pctChange(current, previous);
    if (ch != null && ch <= DROP_PCT && (previous ?? 0) >= MIN_BASE.sessions) {
      out.push({
        id: "ga4-sessions-drop",
        level: ch <= -40 ? "critical" : "warning",
        title: `Organic sessions down ${Math.abs(Math.round(ch))}%`,
        detail: `${fmt(current)} vs ${fmt(previous)} in the comparison period (GA4).`,
        demo: isDemo(ga4),
        target: { group: "analytics", item: "overview" },
      });
    }
  }

  const kpi = s.kpi;
  if (kpi?.data && (kpi.state === "live" || kpi.state === "demo")) {
    for (const k of kpi.data.items) {
      // A pacing signal, not a delivery status: the month isn't over, so the target can still be reached.
      if (k.projection === "below" && k.attainment !== "achieved") {
        out.push({
          id: `kpi-${k.id}`,
          level: k.projectedPct < 85 ? "warning" : "info",
          title: `${k.label}: projected below the ${kpi.data.monthLabel} target`,
          detail: `${Math.round(k.attainmentPct)}% of the full-month target so far; at the last 30 days' rate the month ends at about ${Math.round(k.projectedPct)}%.`,
          demo: isDemo(kpi),
          target: { group: "reports", item: "weekly" },
        });
      }
    }
  }

  const tasks = s.tasks;
  if (tasks?.data && (tasks.state === "live" || tasks.state === "demo") && tasks.data.overdue > 0) {
    const n = tasks.data.overdue;
    out.push({
      id: "tasks-overdue",
      level: n >= 5 ? "critical" : "warning",
      title: `${n} overdue task${n === 1 ? "" : "s"}`,
      detail: "Open Asana tasks past their due date.",
      demo: isDemo(tasks),
    });
  }

  const content = s.content;
  if (content?.data && content.data.awaitingApproval.length) {
    out.push({
      id: "content-approvals",
      level: "info",
      title: `${content.data.awaitingApproval.length} content item${content.data.awaitingApproval.length === 1 ? "" : "s"} awaiting client approval`,
      demo: isDemo(content),
      target: { group: "content", item: "board" },
    });
  }

  for (const [key, label] of [
    ["gsc", "Search Console"],
    ["ga4", "GA4"],
    ["kpi", "Monthly KPIs"],
    ["tasks", "Asana"],
  ] as const) {
    const sec = s[key];
    if (sec?.state === "error") {
      out.push({
        id: `${key}-error`,
        level: "warning",
        title: `${label} data couldn't be loaded`,
        detail: sec.message,
        demo: false,
      });
    }
  }

  const health = s.health;
  if (health?.data && (health.state === "live" || health.state === "demo")) {
    const h = health.data;
    if (h.lastSync && h.lastSync.status === "error") {
      out.push({ id: "sync-failed", level: "warning", title: "Last Search Console sync failed", detail: h.lastSync.message ?? undefined, demo: isDemo(health) });
    }
    if (h.pageSpeedErrors > 0) {
      out.push({
        id: "psi-errors",
        level: "info",
        title: `${h.pageSpeedErrors} PageSpeed check${h.pageSpeedErrors === 1 ? "" : "s"} failed in the last 7 days`,
        demo: isDemo(health),
        target: { group: "technical-seo", item: "pagespeed" },
      });
    }
    if (h.reviewsSyncError) {
      out.push({
        id: "reviews-error",
        level: "info",
        title: "Last Maps reviews fetch failed",
        detail: h.reviewsSyncError,
        demo: isDemo(health),
        target: { group: "local-seo", item: "reviews" },
      });
    }
  }

  const rank: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

function fmt(n: number | null): string {
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

/** A project needs attention when it has any critical or warning alert. */
export function needsAttention(s: ProjectSummary): boolean {
  return alertsFor(s).some((a) => a.level !== "info");
}

/** Projected to meet its KPIs: has at least one target and every KPI is projected to achieve it. Null without targets. */
export function meetsKpi(s: ProjectSummary): boolean | null {
  const items = s.kpi?.data?.items;
  if (!items?.length || (s.kpi?.state !== "live" && s.kpi?.state !== "demo")) return null;
  return items.every((k) => k.projection === "achieved" || k.attainment === "achieved");
}
