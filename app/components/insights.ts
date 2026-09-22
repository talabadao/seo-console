// Shared types for the Weekly Report payload (app/api/weekly-report/route.ts) plus the
// "copy for Asana" text/HTML builder for the Insights sub-tab. Kept out of WeeklyReport.tsx
// so the formatting logic (easy to get subtly wrong — % sign, rounding, wording) has one
// place to read and test independently of the React tree.

export interface GaProperty {
  propertyId: string;
  displayName: string;
  accountName: string;
}

export interface DailyPoint {
  bucket: string;
  label: string;
  organic: number;
  ai: number;
  other: number;
}

export interface TrafficTotals {
  organic: number;
  ai: number;
  other: number;
  total: number;
}

export interface TrafficPair {
  curTotals: TrafficTotals;
  prevTotals: TrafficTotals | null;
  series: DailyPoint[];
  prevSeries: DailyPoint[] | null;
}

export type Pace = "on-track" | "at-risk" | "off-track";

export interface KpiCard {
  actualMtd: number;
  last30Total: number;
  target: number;
  projected: number;
  projectedPct: number;
  expectedByNowPct: number;
  paceDeltaPct: number;
  pace: Pace;
}

export interface ReportWindows {
  mtd: { start: string; end: string };
  mtdPrev: { start: string; end: string };
  mtdYoy: { start: string; end: string };
  last7: { start: string; end: string };
  prev7: { start: string; end: string };
  last30: { start: string; end: string };
  prev30: { start: string; end: string };
  monthLabel: string;
  monthStartLabel: string;
  monthEndLabel: string;
  daysInMonth: number;
  daysElapsed: number;
  yearMonth: string;
}

export interface KpiConfig {
  yearMonth: string;
  trafficOrganicTarget: number;
  trafficAiTarget: number;
  leadOrganicTarget: number;
  leadAiTarget: number;
  leadEvents: string[];
  asanaProjectGid: string;
  asanaStatusTitle: string;
}

export interface Section {
  traffic: TrafficPair;
  leads: TrafficPair;
}

export interface UrlChange {
  url: string;
  cur: number;
  prev: number;
  pct: number | null;
}

export interface ReportData {
  windows: ReportWindows;
  config: KpiConfig;
  availableEvents: { name: string; count: number }[];
  kpis: {
    trafficOrganic: KpiCard;
    trafficAi: KpiCard;
    leadOrganic: KpiCard;
    leadAi: KpiCard;
  };
  sections: {
    last7: Section;
    mtdVsLastPeriod: Section;
    mtdVsLastYear: Section;
    last30VsLastPeriod: Section;
  };
  topUrls: UrlChange[];
  bottomUrls: UrlChange[];
}

const n0 = (v: number) => Math.round(v).toLocaleString();
const pct1 = (v: number) => (isFinite(v) ? Math.abs(v).toFixed(1) : "–");

/** Circle matching a KPI's pace, used to make the run-rate line scannable at a glance. */
const PACE_EMOJI: Record<Pace, string> = { "on-track": "🟢", "at-risk": "🟡", "off-track": "🔴" };
/** Color for the on-screen (HTML) run-rate line — same CSS variables as the Overview tiles. */
const PACE_COLOR: Record<Pace, string> = {
  "on-track": "var(--good)",
  "at-risk": "var(--position)",
  "off-track": "var(--bad)",
};

const SUMMARY_TITLE = "📊 Summary";
const TOP_URLS_TITLE = "🚀 Top-performing URLs for the week";
const BOTTOM_URLS_TITLE = "📉 Underperforming URLs for the week";
const DIVIDER = "─".repeat(28);

function changeLine(cur: number, prev: number, unit: string): string {
  if (!prev) {
    return cur > 0 ? `🆕 New this period → ${n0(cur)} ${unit}` : `No ${unit} recorded`;
  }
  const pct = ((cur - prev) / prev) * 100;
  const arrow = pct >= 0 ? "▲" : "▼";
  return `${arrow} ${pct1(pct)}% → ${n0(cur)} ${unit}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function urlLine(u: UrlChange): string {
  const arrow = (u.pct ?? 0) >= 0 ? "▲" : "▼";
  return `${u.url} — ${arrow} ${pct1(u.pct ?? 0)}% → ${n0(u.cur)} sessions`;
}

interface SectionSpec {
  title: string;
  section: Section;
}

/** The comparison sections + KPI/URL lines, shared by both the browser-paste and Asana-API renderers. */
function summaryParts(data: ReportData) {
  const { windows: w } = data;
  const mtdRange = `${w.monthStartLabel.replace(/, \d{4}$/, "")} – ${w.mtd.end.slice(-2)}`;

  const sectionSpecs: SectionSpec[] = [
    { title: "📆 Last 7 days vs Previous 7 days:", section: data.sections.last7 },
    { title: "📆 MTD vs Last period:", section: data.sections.mtdVsLastPeriod },
    { title: "📆 MTD vs Same period last year:", section: data.sections.mtdVsLastYear },
    { title: "📆 Last 30 days vs Last period:", section: data.sections.last30VsLastPeriod },
  ];

  const sectionLines = (s: Section) => [
    `Organic Traffic: ${changeLine(s.traffic.curTotals.organic, s.traffic.prevTotals?.organic ?? 0, "sessions")}`,
    `AI Traffic: ${changeLine(s.traffic.curTotals.ai, s.traffic.prevTotals?.ai ?? 0, "sessions")}`,
    `Organic Search Lead: ${changeLine(s.leads.curTotals.organic, s.leads.prevTotals?.organic ?? 0, "leads")}`,
    `AI Lead: ${changeLine(s.leads.curTotals.ai, s.leads.prevTotals?.ai ?? 0, "leads")}`,
  ];

  const topLines = data.topUrls.length ? data.topUrls.map(urlLine) : ["No qualifying URLs this week."];
  const bottomLines = data.bottomUrls.length
    ? data.bottomUrls.map(urlLine)
    : ["No qualifying URLs this week."];

  // Actual achieved so far this month, as a % of the monthly target — not a
  // full-month forecast. e.g. 6,327 reached against a 10,570 target is 59.9%,
  // regardless of how many days are left in the month.
  const toDatePct = (actual: number, target: number) =>
    target > 0 ? (actual / target) * 100 : actual > 0 ? Infinity : 0;
  // KPI achievement bands for the run-rate line specifically (distinct from
  // the Overview tiles' expectedByNowPct-relative pace): >=85% reached this
  // month is on track, 65-85% is at risk, below 65% is off track.
  const paceFor = (pct: number): Pace => {
    if (!isFinite(pct)) return "off-track";
    if (pct >= 85) return "on-track";
    if (pct >= 65) return "at-risk";
    return "off-track";
  };
  const organicPct = toDatePct(data.kpis.trafficOrganic.actualMtd, data.kpis.trafficOrganic.target);
  const aiPct = toDatePct(data.kpis.trafficAi.actualMtd, data.kpis.trafficAi.target);
  const runRateLine = `${PACE_EMOJI[paceFor(organicPct)]} Organic run rate: ${pct1(organicPct)}%    ${PACE_EMOJI[paceFor(aiPct)]} AI run rate: ${pct1(aiPct)}%`;
  const runRateHtml = [
    `<span style="color:${PACE_COLOR[paceFor(organicPct)]}">Organic run rate: ${pct1(organicPct)}%</span>`,
    `<span style="color:${PACE_COLOR[paceFor(aiPct)]}">AI run rate: ${pct1(aiPct)}%</span>`,
  ].join("&nbsp;&nbsp;&nbsp;");

  return {
    mtdRange,
    sections: sectionSpecs.map(({ title, section }) => ({ title, lines: sectionLines(section) })),
    topLines,
    bottomLines,
    runRateLine,
    runRateHtml,
  };
}

/**
 * Builds both a rich-HTML version (for Asana's rich-paste — headings/bold
 * render correctly when pasted through the browser, unlike the API's broken
 * html_text) and a plain-text fallback. `tasks` is optional so the panel can
 * still render before the Asana fetch resolves; pass it once loaded so the
 * copied content is a complete, paste-and-done report even if you never open
 * "Post to Asana" at all.
 */
export function buildInsights(data: ReportData, tasks: TaskBuckets | null = null): { html: string; text: string } {
  const { windows: w, config } = data;
  const { mtdRange, sections, topLines, bottomLines, runRateLine, runRateHtml } = summaryParts(data);
  const taskSections = taskSectionsFor(tasks);

  // ---------- HTML ----------
  const ul = (lines: string[]) => `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
  const html = [
    `<h2>${esc(SUMMARY_TITLE)}</h2>`,
    `<p><strong>${esc(w.monthLabel)} KPI:</strong></p>`,
    ul([
      `🎯 Organic Traffic Target: ${n0(config.trafficOrganicTarget)} | AI Traffic Target: ${n0(config.trafficAiTarget)}`,
      `📈 Organic Traffic Reached (${mtdRange}): ${n0(data.kpis.trafficOrganic.actualMtd)} sessions | AI Traffic Reached: ${n0(data.kpis.trafficAi.actualMtd)} sessions`,
    ]),
    `<ul><li>${runRateHtml}</li></ul>`,
    ...sections.flatMap(({ title, lines }) => [
      `<p><strong><u>${esc(title)}</u></strong></p>`,
      ul(lines),
    ]),
    `<h2>${esc(TOP_URLS_TITLE)}</h2>`,
    ul(topLines),
    `<h2>${esc(BOTTOM_URLS_TITLE)}</h2>`,
    ul(bottomLines),
    ...taskSections.flatMap(({ title, lines }) => [`<h2>${esc(title)}</h2>`, ul(lines)]),
  ].join("\n");

  // ---------- plain text ----------
  const bullets = (lines: string[]) => lines.map((l) => `• ${l}`).join("\n");
  const text = [
    SUMMARY_TITLE,
    "",
    `${w.monthLabel} KPI:`,
    bullets([
      `🎯 Organic Traffic Target: ${n0(config.trafficOrganicTarget)} | AI Traffic Target: ${n0(config.trafficAiTarget)}`,
      `📈 Organic Traffic Reached (${mtdRange}): ${n0(data.kpis.trafficOrganic.actualMtd)} sessions | AI Traffic Reached: ${n0(data.kpis.trafficAi.actualMtd)} sessions`,
      runRateLine,
    ]),
    "",
    ...sections.flatMap(({ title, lines }) => [title, bullets(lines), ""]),
    DIVIDER,
    TOP_URLS_TITLE,
    bullets(topLines),
    "",
    BOTTOM_URLS_TITLE,
    bullets(bottomLines),
    ...taskSections.flatMap(({ title, lines }) => ["", DIVIDER, title, bullets(lines)]),
  ].join("\n");

  return { html, text };
}

// ---------- Asana task export ----------

export interface AsanaTask {
  gid: string;
  name: string;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  assignee: { name: string } | null;
  permalink_url: string;
}

export interface TaskBuckets {
  completedRecently: AsanaTask[];
  dueThisWeek: AsanaTask[];
  dueNextWeek: AsanaTask[];
}

function shortDate(iso: string): string {
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

function taskLine(t: AsanaTask, dateLabel: "completed" | "due"): string {
  const date = dateLabel === "completed" ? t.completed_at : t.due_on;
  const dateText = date ? `${dateLabel} ${shortDate(date)}` : `no ${dateLabel === "completed" ? "completion" : "due"} date`;
  const who = t.assignee?.name ? ` (${t.assignee.name})` : "";
  return `${t.name} — ${dateText}${who}`;
}

/** The 3 task buckets as {title, lines} — shared by buildInsights() and buildAsanaBody(). */
function taskSectionsFor(tasks: TaskBuckets | null): { title: string; lines: string[] }[] {
  if (!tasks) return [];
  const lines = (list: AsanaTask[], dateLabel: "completed" | "due", emptyText: string) =>
    list.length ? list.map((t) => taskLine(t, dateLabel)) : [emptyText];
  return [
    { title: "✅ Tasks completed (last 2 weeks)", lines: lines(tasks.completedRecently, "completed", "No tasks completed in the last 2 weeks.") },
    { title: "🗓️ Tasks due this week", lines: lines(tasks.dueThisWeek, "due", "No tasks due this week.") },
    { title: "🔜 Tasks due next week", lines: lines(tasks.dueNextWeek, "due", "No tasks due next week.") },
  ];
}

/**
 * Plain-text body for Asana's create-status-update API. Asana has a long-
 * standing, staff-acknowledged bug where html_text on status updates is
 * stored but never rendered (shows the raw markup instead of formatting —
 * see https://forum.asana.com/t/rich-text-does-not-work-for-status-updates/31311),
 * so this is plain text with spacing/dividers/emoji standing in for
 * headings and bold instead of real markup.
 */
export function buildAsanaBody(data: ReportData, tasks: TaskBuckets | null): { text: string } {
  const { windows: w, config } = data;
  const { mtdRange, sections, topLines, bottomLines, runRateLine } = summaryParts(data);
  const taskSections = taskSectionsFor(tasks);

  const bullets = (lines: string[]) => lines.map((l) => `• ${l}`).join("\n");
  const text = [
    SUMMARY_TITLE,
    "",
    `${w.monthLabel} KPI:`,
    bullets([
      `🎯 Organic Traffic Target: ${n0(config.trafficOrganicTarget)} | AI Traffic Target: ${n0(config.trafficAiTarget)}`,
      `📈 Organic Traffic Reached (${mtdRange}): ${n0(data.kpis.trafficOrganic.actualMtd)} sessions | AI Traffic Reached: ${n0(data.kpis.trafficAi.actualMtd)} sessions`,
      runRateLine,
    ]),
    "",
    ...sections.flatMap(({ title, lines }) => [title, bullets(lines), ""]),
    DIVIDER,
    TOP_URLS_TITLE,
    bullets(topLines),
    "",
    BOTTOM_URLS_TITLE,
    bullets(bottomLines),
    ...taskSections.flatMap(({ title, lines }) => ["", DIVIDER, title, bullets(lines)]),
  ].join("\n");

  return { text };
}
