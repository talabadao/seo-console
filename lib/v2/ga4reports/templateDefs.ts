// GA4 report template definitions: names, breakdowns, metrics and wording. Pure (shared by the server runner in
// templates.ts and the UI).

export const TEMPLATE_IDS = ["leads", "events", "landing-pages", "traffic-acquisition", "user-acquisition"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateView {
  id: string;
  label: string;
  dimension: string;
}

export interface TemplateDef {
  id: TemplateId;
  title: string;
  description: string;
  views: TemplateView[];
  /** Table metrics (GA4 API names), plus a lead-events column when the project has lead events. */
  metrics: string[];
  leadColumn: boolean;
  /** Scorecards: GA4 metrics from the totals query; "leads" is the project's lead events. */
  scorecards: string[];
  /** Daily trend metric ("leads" = the project's lead events). */
  trend: string;
}

export const METRIC_LABELS: Record<string, string> = {
  sessions: "Sessions",
  engagedSessions: "Engaged sessions",
  engagementRate: "Engagement rate",
  keyEvents: "Key events (all)",
  totalUsers: "Total users",
  newUsers: "New users",
  activeUsers: "Active users",
  eventCount: "Event count",
  eventCountPerUser: "Events per user",
  averageSessionDuration: "Avg. session duration",
  leads: "Lead events",
};

const SESSION_VIEWS: TemplateView[] = [
  { id: "channel", label: "Session default channel group", dimension: "sessionDefaultChannelGroup" },
  { id: "source-medium", label: "Session source / medium", dimension: "sessionSourceMedium" },
  { id: "campaign", label: "Session campaign", dimension: "sessionCampaignName" },
];

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  leads: {
    id: "leads",
    title: "Generate leads",
    description:
      "Lead events are this project's chosen events (Project settings → Analytics / Key events), counted as events. Key events (all) are every event the GA4 property marks as a key event; the two are shown separately.",
    views: [
      { id: "channel", label: "Session default channel group", dimension: "sessionDefaultChannelGroup" },
      { id: "landing-page", label: "Landing page", dimension: "landingPage" },
      { id: "source-medium", label: "Session source / medium", dimension: "sessionSourceMedium" },
    ],
    metrics: ["sessions", "keyEvents"],
    leadColumn: true,
    scorecards: ["leads", "sessions", "keyEvents"],
    trend: "leads",
  },
  events: {
    id: "events",
    title: "Events",
    description: "Every event the property recorded. Total users counts each person once per event row; users are never added across rows.",
    views: [{ id: "event", label: "Event name", dimension: "eventName" }],
    metrics: ["eventCount", "totalUsers", "eventCountPerUser"],
    leadColumn: false,
    scorecards: ["eventCount", "totalUsers", "eventCountPerUser"],
    trend: "eventCount",
  },
  "landing-pages": {
    id: "landing-pages",
    title: "Landing pages",
    description: "The first page of each session (path, without query string). Sessions, users and engagement are attributed to the page the session started on.",
    views: [{ id: "landing-page", label: "Landing page", dimension: "landingPage" }],
    metrics: ["sessions", "totalUsers", "engagedSessions", "engagementRate", "keyEvents"],
    leadColumn: true,
    scorecards: ["sessions", "totalUsers", "engagementRate", "keyEvents"],
    trend: "sessions",
  },
  "traffic-acquisition": {
    id: "traffic-acquisition",
    title: "Traffic acquisition",
    description: "Session-scoped: where each session came from. One user can bring sessions from several channels.",
    views: SESSION_VIEWS,
    metrics: ["sessions", "engagedSessions", "engagementRate", "keyEvents"],
    leadColumn: true,
    scorecards: ["sessions", "engagedSessions", "engagementRate", "keyEvents"],
    trend: "sessions",
  },
  "user-acquisition": {
    id: "user-acquisition",
    title: "User acquisition",
    description:
      "User-scoped: how each user was first acquired (first user channel), whatever brought their later sessions. Differs from Traffic acquisition, which attributes each session to its own source.",
    views: [
      { id: "channel", label: "First user default channel group", dimension: "firstUserDefaultChannelGroup" },
      { id: "source-medium", label: "First user source / medium", dimension: "firstUserSourceMedium" },
      { id: "campaign", label: "First user campaign", dimension: "firstUserCampaignName" },
    ],
    metrics: ["totalUsers", "newUsers", "engagedSessions", "engagementRate", "keyEvents"],
    leadColumn: true,
    scorecards: ["totalUsers", "newUsers", "engagementRate", "keyEvents"],
    trend: "newUsers",
  },
};

export const isTemplateId = (v: unknown): v is TemplateId => (TEMPLATE_IDS as readonly string[]).includes(v as string);
