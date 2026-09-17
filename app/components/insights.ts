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

function changeLine(cur: number, prev: number, unit: string): string {
  if (!prev) {
    return cur > 0 ? `New this period — reached ${n0(cur)} ${unit}` : `No ${unit} recorded`;
  }
  const pct = ((cur - prev) / prev) * 100;
  const dir = pct >= 0 ? "Increased" : "Decreased";
  return `${dir} ${pct1(pct)}% (reached ${n0(cur)} ${unit})`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function urlLine(u: UrlChange): string {
  const sign = (u.pct ?? 0) >= 0 ? "+" : "-";
  return `${u.url}: ${sign}${pct1(u.pct ?? 0)}% (accounting for ${n0(u.cur)} sessions)`;
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
    { title: "Last 7 days vs Previous 7 days:", section: data.sections.last7 },
    { title: "MTD vs Last period:", section: data.sections.mtdVsLastPeriod },
    { title: "MTD vs Same period last year:", section: data.sections.mtdVsLastYear },
    { title: "Last 30 days vs Last period:", section: data.sections.last30VsLastPeriod },
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

  return {
    mtdRange,
    sections: sectionSpecs.map(({ title, section }) => ({ title, lines: sectionLines(section) })),
    topLines,
    bottomLines,
  };
}

/** Builds both a rich-HTML version (for Asana's rich-paste) and a plain-text fallback. */
export function buildInsights(data: ReportData): { html: string; text: string } {
  const { windows: w, config, kpis } = data;
  const { mtdRange, sections, topLines, bottomLines } = summaryParts(data);

  // ---------- HTML ----------
  const ul = (lines: string[]) => `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
  const html = [
    `<h2>Summary</h2>`,
    `<p><strong>${esc(w.monthLabel)} KPI:</strong></p>`,
    ul([
      `Organic Traffic Target: ${n0(config.trafficOrganicTarget)} | AI Traffic Target: ${n0(config.trafficAiTarget)}`,
      `Organic Traffic Reached (${mtdRange}): ${n0(kpis.trafficOrganic.actualMtd)} sessions | AI Traffic Reached: ${n0(kpis.trafficAi.actualMtd)} sessions`,
    ]),
    `<ul><li><code>KPI run rate: ${pct1(kpis.trafficOrganic.projectedPct)}% | KPI run rate: ${pct1(kpis.trafficAi.projectedPct)}%</code></li></ul>`,
    ...sections.flatMap(({ title, lines }) => [
      `<p><strong><u>${esc(title)}</u></strong></p>`,
      ul(lines),
    ]),
    `<h2>Top-performing URLs for the week</h2>`,
    ul(topLines),
    `<h2>Underperforming URLs for the week</h2>`,
    ul(bottomLines),
  ].join("\n");

  // ---------- plain text ----------
  const bullets = (lines: string[]) => lines.map((l) => `• ${l}`).join("\n");
  const text = [
    "Summary",
    "",
    `${w.monthLabel} KPI:`,
    bullets([
      `Organic Traffic Target: ${n0(config.trafficOrganicTarget)} | AI Traffic Target: ${n0(config.trafficAiTarget)}`,
      `Organic Traffic Reached (${mtdRange}): ${n0(kpis.trafficOrganic.actualMtd)} sessions | AI Traffic Reached: ${n0(kpis.trafficAi.actualMtd)} sessions`,
      `KPI run rate: ${pct1(kpis.trafficOrganic.projectedPct)}% | KPI run rate: ${pct1(kpis.trafficAi.projectedPct)}%`,
    ]),
    "",
    ...sections.flatMap(({ title, lines }) => [title, bullets(lines), ""]),
    "Top-performing URLs for the week",
    bullets(topLines),
    "",
    "Underperforming URLs for the week",
    bullets(bottomLines),
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

/**
 * Body content for Asana's create-status-update API. Asana's html_text does
 * NOT support <h1>/<h2> for stories or status updates (only strong / em / u /
 * s / code / a / ol / ul / li / blockquote / pre), so section titles here are
 * bold text rather than the headings buildInsights() uses for the browser
 * copy-paste flow. Wrapped in <body> per Asana's rich-text requirement.
 */
export function buildAsanaBody(
  data: ReportData,
  tasks: TaskBuckets | null,
): { html: string; text: string } {
  const { windows: w, config, kpis } = data;
  const { mtdRange, sections, topLines, bottomLines } = summaryParts(data);

  const taskLines = (list: AsanaTask[], dateLabel: "completed" | "due", emptyText: string) =>
    list.length ? list.map((t) => taskLine(t, dateLabel)) : [emptyText];

  const taskSections = tasks
    ? [
        { title: "Tasks completed (last 2 weeks)", lines: taskLines(tasks.completedRecently, "completed", "No tasks completed in the last 2 weeks.") },
        { title: "Tasks due this week", lines: taskLines(tasks.dueThisWeek, "due", "No tasks due this week.") },
        { title: "Tasks due next week", lines: taskLines(tasks.dueNextWeek, "due", "No tasks due next week.") },
      ]
    : [];

  const ul = (lines: string[]) => `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
  const html = `<body>${[
    `<p><strong>Summary</strong></p>`,
    `<p><strong>${esc(w.monthLabel)} KPI:</strong></p>`,
    ul([
      `Organic Traffic Target: ${n0(config.trafficOrganicTarget)} | AI Traffic Target: ${n0(config.trafficAiTarget)}`,
      `Organic Traffic Reached (${mtdRange}): ${n0(kpis.trafficOrganic.actualMtd)} sessions | AI Traffic Reached: ${n0(kpis.trafficAi.actualMtd)} sessions`,
    ]),
    `<ul><li><code>KPI run rate: ${pct1(kpis.trafficOrganic.projectedPct)}% | KPI run rate: ${pct1(kpis.trafficAi.projectedPct)}%</code></li></ul>`,
    ...sections.flatMap(({ title, lines }) => [`<p><strong><u>${esc(title)}</u></strong></p>`, ul(lines)]),
    `<p><strong>Top-performing URLs for the week</strong></p>`,
    ul(topLines),
    `<p><strong>Underperforming URLs for the week</strong></p>`,
    ul(bottomLines),
    ...taskSections.flatMap(({ title, lines }) => [`<p><strong>${esc(title)}</strong></p>`, ul(lines)]),
  ].join("\n")}</body>`;

  const bullets = (lines: string[]) => lines.map((l) => `• ${l}`).join("\n");
  const text = [
    "Summary",
    "",
    `${w.monthLabel} KPI:`,
    bullets([
      `Organic Traffic Target: ${n0(config.trafficOrganicTarget)} | AI Traffic Target: ${n0(config.trafficAiTarget)}`,
      `Organic Traffic Reached (${mtdRange}): ${n0(kpis.trafficOrganic.actualMtd)} sessions | AI Traffic Reached: ${n0(kpis.trafficAi.actualMtd)} sessions`,
      `KPI run rate: ${pct1(kpis.trafficOrganic.projectedPct)}% | KPI run rate: ${pct1(kpis.trafficAi.projectedPct)}%`,
    ]),
    "",
    ...sections.flatMap(({ title, lines }) => [title, bullets(lines), ""]),
    "Top-performing URLs for the week",
    bullets(topLines),
    "",
    "Underperforming URLs for the week",
    bullets(bottomLines),
    ...taskSections.flatMap(({ title, lines }) => ["", title, bullets(lines)]),
  ].join("\n");

  return { html, text };
}
