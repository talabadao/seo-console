// Navigation and addresses for the v2 console shell (Milestone 01b).
// Pure data and functions, shared by the shell UI and its tests.
//
// Addresses:
//   /portfolio                       All projects (only the signed-in account's)
//   /portfolio/<group>/<item>        A project-only page opened from All projects: pick a project first
//   /p/<projectId>/<group>/<item>[/<sub>]
//   /docs
// The project is identified by its id, never by its (editable) name.

/** live = real data today; demo = fictional fixtures, labelled; planned = placeholder for a later milestone. */
export type ItemStatus = "live" | "demo" | "planned";

/** Project asset a live page needs before it can show anything. */
export type Requirement = "gsc" | "ga4" | "reviews";

export interface NavItem {
  id: string;
  label: string;
  status: ItemStatus;
  requires?: Requirement;
  /** Roadmap milestone that delivers a demo/planned item for real. */
  milestone?: string;
  /** One sentence shown on demo and placeholder pages. */
  description?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "home",
    items: [{ id: "overview", label: "Project overview", status: "live" }],
  },
  {
    id: "keyword-research",
    label: "Keyword Research",
    icon: "search",
    items: [
      {
        id: "explorer",
        label: "Keyword explorer",
        status: "demo",
        milestone: "12",
        description: "Keyword volume, difficulty and intent with saved lists and clusters.",
      },
    ],
  },
  {
    id: "competitive-research",
    label: "Competitive Research",
    icon: "compare",
    items: [
      {
        id: "overview",
        label: "Competitor overview",
        status: "demo",
        milestone: "12",
        description: "Domain comparison, estimated traffic and content gaps.",
      },
    ],
  },
  {
    id: "link-building",
    label: "Link Building",
    icon: "link",
    items: [
      {
        id: "backlinks",
        label: "Backlinks",
        status: "demo",
        milestone: "12",
        description: "Referring domains, new and lost links, and prospects. No outreach.",
      },
    ],
  },
  {
    id: "organic-serp",
    label: "Organic SERP",
    icon: "chart",
    items: [
      {
        id: "se-ranking",
        label: "SE Ranking",
        status: "planned",
        milestone: "06",
        description: "Daily rankings, competitors, backlinks, site audit and AI prompts from SE Ranking. Needs an SE Ranking API key.",
      },
      {
        id: "google",
        label: "Google Search Tracking",
        status: "planned",
        milestone: "07",
        description: "SERP snapshots for selected keywords through SerpApi, checked on demand or on a schedule you enable.",
      },
      { id: "bing", label: "Bing Search Tracking", status: "planned", milestone: "07", description: "Bing SERP tracking through SerpApi." },
      { id: "yandex", label: "Yandex Search Tracking", status: "planned", milestone: "07", description: "Yandex SERP tracking through SerpApi." },
      { id: "naver", label: "Naver Search Tracking", status: "planned", milestone: "07", description: "Naver SERP tracking through SerpApi." },
    ],
  },
  {
    id: "search-console",
    label: "Google Search Console",
    icon: "gsc",
    items: [
      { id: "performance", label: "Performance", status: "live", requires: "gsc" },
      { id: "opportunities", label: "Opportunities", status: "live", requires: "gsc" },
    ],
  },
  {
    id: "analytics",
    label: "Google Analytics 4",
    icon: "analytics",
    items: [{ id: "overview", label: "Analytics", status: "live", requires: "ga4" }],
  },
  {
    id: "local-seo",
    label: "Local SEO",
    icon: "pin",
    items: [
      {
        id: "business-profile",
        label: "Google Business Profile",
        status: "planned",
        milestone: "08",
        description: "Public listing analysis with evidence-based recommendations, compared with competitors.",
      },
      { id: "reviews", label: "Google Maps Reviews", status: "live", requires: "reviews" },
    ],
  },
  {
    id: "technical-seo",
    label: "Technical SEO",
    icon: "wrench",
    items: [
      {
        id: "site-audit",
        label: "Site Audit",
        status: "planned",
        milestone: "09c",
        description: "A bounded crawl of your site checking status codes, redirects, canonicals, titles, headings and internal links.",
      },
      { id: "pagespeed", label: "PageSpeed Insights", status: "live" },
      { id: "indexing", label: "Indexing", status: "live", requires: "gsc" },
      {
        id: "structured-data",
        label: "Structured Data / Schema",
        status: "planned",
        milestone: "09d",
        description: "Checks the structured data (schema.org JSON-LD and microdata) on your pages for errors and missing recommended fields. The checking engine comes in a separate Technical SEO milestone.",
      },
    ],
  },
  {
    id: "content",
    label: "Content",
    icon: "doc",
    items: [
      {
        id: "board",
        label: "Editorial board",
        status: "demo",
        milestone: "12",
        description: "Briefs, drafts, reviews and approvals. Google Docs and WordPress actions are previews only.",
      },
    ],
  },
  {
    id: "ai-area",
    label: "AI Area",
    icon: "sparkle",
    items: [
      {
        id: "overview",
        label: "AI visibility",
        status: "planned",
        milestone: "10",
        description: "Mentions, citations, competitors and sentiment in AI answers, from Searchable. Needs a Searchable connection.",
      },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    icon: "bolt",
    items: [
      {
        id: "workflows",
        label: "Workflows",
        status: "planned",
        milestone: "13",
        description: "Status and run history of connected workflows such as GBP Post Auto, once its Sheet and Apps Script are audited.",
      },
    ],
  },
  {
    id: "reports",
    label: "Report",
    icon: "report",
    items: [
      { id: "weekly", label: "Weekly Report", status: "live", requires: "ga4" },
      {
        id: "monthly",
        label: "Monthly Report",
        status: "demo",
        milestone: "12",
        description: "Executive summary, KPIs, search and analytics results, completed work and next month's plan.",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "gear",
    items: [{ id: "project", label: "Project settings", status: "live" }],
  },
];

/** Project-level sub-tabs carried in the address (/p/1/analytics/overview/key-events). */
export const DEFAULT_ITEM = { group: "dashboard", item: "overview" } as const;

export type ShellLocation =
  | { kind: "portfolio" }
  | { kind: "pick"; group: string; item: string }
  | { kind: "project"; projectId: number; group: string; item: string; sub: string }
  | { kind: "docs" };

export function findItem(group: string, item: string): { group: NavGroup; item: NavItem } | null {
  const g = NAV.find((x) => x.id === group);
  const i = g?.items.find((x) => x.id === item);
  return g && i ? { group: g, item: i } : null;
}

/** True for paths the v2 shell owns; everything else stays with the legacy dashboard. */
export function isShellPath(segments: string[]): boolean {
  return segments[0] === "portfolio" || segments[0] === "p" || segments[0] === "docs";
}

/** Reads a shell address. Unknown pages fall back to the project overview; unknown roots give null. */
export function parseShellPath(segments: string[]): ShellLocation | null {
  const [root, a, b, c, d] = segments;
  if (root === "docs") return { kind: "docs" };
  if (root === "portfolio") {
    return a && b && findItem(a, b) ? { kind: "pick", group: a, item: b } : { kind: "portfolio" };
  }
  if (root === "p") {
    const projectId = Number(a);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) return { kind: "portfolio" };
    if (b && c && findItem(b, c)) return { kind: "project", projectId, group: b, item: c, sub: d ?? "" };
    return { kind: "project", projectId, ...DEFAULT_ITEM, sub: "" };
  }
  return null;
}

export function buildShellPath(loc: ShellLocation): string {
  switch (loc.kind) {
    case "portfolio":
      return "/portfolio";
    case "docs":
      return "/docs";
    case "pick":
      return `/portfolio/${loc.group}/${loc.item}`;
    case "project":
      return `/p/${loc.projectId}/${loc.group}/${loc.item}${loc.sub ? `/${loc.sub}` : ""}`;
  }
}

/**
 * Where to go when the project switcher changes. Switching between projects
 * keeps the current page (but not its sub-tab or any data); "All projects"
 * goes to the portfolio.
 */
export function switchProject(current: ShellLocation, projectId: number | null): ShellLocation {
  if (projectId == null) return { kind: "portfolio" };
  if (current.kind === "project" || current.kind === "pick") {
    return { kind: "project", projectId, group: current.group, item: current.item, sub: "" };
  }
  return { kind: "project", projectId, ...DEFAULT_ITEM, sub: "" };
}

/** Whether a project has what a live page needs. */
export function meetsRequirement(
  req: Requirement | undefined,
  project: { gscProperty: string | null; gaPropertyId: string | null; mapsUrl: string; hasSerpKey: boolean },
): boolean {
  if (req === "gsc") return Boolean(project.gscProperty);
  if (req === "ga4") return Boolean(project.gaPropertyId);
  if (req === "reviews") return Boolean(project.mapsUrl && project.hasSerpKey);
  return true;
}

export const REQUIREMENT_LABEL: Record<Requirement, string> = {
  gsc: "a Search Console property",
  ga4: "a Google Analytics (GA4) property",
  reviews: "a Google Maps link and a SerpApi key",
};
