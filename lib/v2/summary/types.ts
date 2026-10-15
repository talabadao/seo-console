// Typed project summaries behind the v2 project and portfolio dashboards.
//
// Every section says where its numbers come from and how fresh they are, and
// is in exactly one state:
//   live           real data from a connected source
//   demo           invented sample data, always labelled; never shown as live
//   not-connected  the project lacks the connection this section needs
//   unavailable    connected, but nothing to show (no targets set, missing
//                  permission, nothing tracked) — not the same as zero
//   error          the provider request failed; no numbers are substituted
// Missing values are null, never 0.

export type SectionState = "live" | "demo" | "not-connected" | "unavailable" | "error";

export interface SectionMeta {
  state: SectionState;
  /** Human-readable source, e.g. "Google Search Console". */
  source: string;
  /** Why the section has no data, or the provider's error. */
  message?: string;
  /** Last date the source has data for (YYYY-MM-DD), when known. */
  dataThrough?: string | null;
  /** True when dataThrough is older than this source normally lags. */
  stale?: boolean;
  /** When the numbers were fetched from the provider (ms since epoch). */
  fetchedAt?: number;
}

export type Section<T> = SectionMeta & { data?: T };

/** A metric for the current period and the comparison period; null = unavailable. */
export interface MetricPair {
  current: number | null;
  previous: number | null;
}

export interface GscData {
  clicks: MetricPair;
  impressions: MetricPair;
  /** Clicks ÷ impressions over the whole period, as Google reports it. */
  ctr: MetricPair;
  /** Google's own impression-weighted average for the period. */
  position: MetricPair;
  series?: { date: string; clicks: number; impressions: number }[];
}

export interface Ga4Data {
  /** Organic Search channel only; sources on the AI list are excluded. */
  sessions: MetricPair;
  engagedSessions: MetricPair;
  keyEvents: MetricPair;
  /** Null when the property records no revenue; never summed across currencies. */
  revenue: MetricPair | null;
  currency: string | null;
  series?: { date: string; sessions: number }[];
}

export type KpiStatus = "on-track" | "at-risk" | "off-track";

export interface KpiItem {
  id: string;
  label: string;
  actual: number;
  target: number;
  /** Month-end projection from the last 30 days' daily rate. */
  projected: number;
  /** projected ÷ target, in percent. */
  projectedPct: number;
  /** actual ÷ target, in percent. */
  progressPct: number;
  status: KpiStatus;
}

export interface KpiData {
  yearMonth: string;
  monthLabel: string;
  daysElapsed: number;
  daysInMonth: number;
  items: KpiItem[];
}

export interface TaskRef {
  gid: string;
  name: string;
  assignee: string | null;
  dueOn: string | null;
  completedAt: string | null;
  status: "completed" | "overdue" | "open";
  url: string | null;
}

export interface TaskData {
  yearMonth: string;
  /** Calendar month the counts cover, in UTC. */
  monthStart: string;
  monthEnd: string;
  today: string;
  /** Tasks whose due date falls in this month, done or not. */
  dueThisMonth: number;
  /** Tasks completed in this month, by completion date. */
  completedThisMonth: number;
  /** Open tasks whose due date has passed. */
  overdue: number;
  overdueTasks: TaskRef[];
  upcoming: TaskRef[];
  recentlyCompleted: TaskRef[];
  projectUrl: string | null;
}

export const CONTENT_STAGES = ["planned", "drafting", "internal-review", "client-review", "approved", "published"] as const;
export type ContentStage = (typeof CONTENT_STAGES)[number];
export const CONTENT_STAGE_LABEL: Record<ContentStage, string> = {
  planned: "Planned",
  drafting: "Drafting",
  "internal-review": "Internal review",
  "client-review": "Client review",
  approved: "Approved",
  published: "Published",
};

export interface ContentData {
  counts: Record<ContentStage, number>;
  awaitingApproval: { title: string; stage: ContentStage; since: string }[];
}

export interface HealthData {
  /** Most recent stored Search Console sync for this project's property. */
  lastSync: { status: string; finishedAt: number | null; message: string | null } | null;
  pageSpeedErrors: number;
  reviewsSyncError: string | null;
}

export type SummaryPart = "gsc" | "ga4" | "kpi" | "tasks" | "content" | "health";
export const ALL_PARTS: SummaryPart[] = ["gsc", "ga4", "kpi", "tasks", "content", "health"];

export interface PeriodInfo {
  preset: string;
  compare: string;
  label: string;
  compareLabel: string | null;
  current: { start: string; end: string };
  previous: { start: string; end: string } | null;
}

export interface ProjectSummary {
  projectId: number;
  /** True for demo projects and local mock mode: every section is demo data. */
  demo: boolean;
  period: PeriodInfo;
  generatedAt: number;
  /** Served from the server's short-lived cache. */
  cached?: boolean;
  gsc?: Section<GscData>;
  ga4?: Section<Ga4Data>;
  kpi?: Section<KpiData>;
  tasks?: Section<TaskData>;
  content?: Section<ContentData>;
  health?: Section<HealthData>;
}
