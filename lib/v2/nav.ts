// Navigation and addresses for the v2 console shell.
// Pure data and functions, shared by the shell UI and its tests.
//
// Addresses:
//   /portfolio                       All projects of the team workspace (filter: all / mine, brand)
//   /portfolio/<group>/<item>[/<sub>] A project-only page opened from All projects: pick a project first
//   /account[/<section>][?project=<id>]  The signed-in person's own settings (Profile, Linked logins, API
//                                    credentials, Usage & Costs, Budgets & limits, Scheduled spending, Notification
//                                    preferences, Data connections, Sync & cache). ?project only pre-selects a filter.
//   /team                            Team directory
//   /p/<projectId>/<group>/<item>[/<sub>]
//   /docs[/<slug>]                    Docs articles and news (a slug opens one)
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
  /** Roadmap milestone that delivers a demo/planned item for real (docs and tests only; never shown in the UI). */
  milestone?: string;
  /** One sentence shown on demo and placeholder pages. */
  description?: string;
  /** "account": the page belongs to the signed-in account, not a project (works with or without one selected). */
  scope?: "account";
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
    items: [{ id: "overview", label: "Dashboard", status: "live" }],
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
    label: "Competitors",
    icon: "compare",
    items: [
      // SE Ranking competitors (tracked competitors, top-10 domains, positions), ported from AI Brand Mention.
      { id: "overview", label: "Competitor overview", status: "live" },
    ],
  },
  {
    id: "link-building",
    label: "Link Building",
    icon: "link",
    items: [
      // SE Ranking Backlink Monitor and Data API backlink profile (credits; explicit refresh only).
      { id: "backlinks", label: "Backlinks", status: "live" },
    ],
  },
  {
    id: "organic-serp",
    label: "Rank tracking",
    icon: "chart",
    items: [
      // Read-only report from the SE Ranking project mapped in Project settings → Integrations.
      { id: "se-ranking", label: "SE Ranking", status: "live" },
      // Google Search Tracking (ported from AI Brand Mention): rankings, AI Overview / AI Mode mentions and citations,
      // AI responses and tracking settings; the view is the sub-path (/p/<id>/organic-serp/organic/rank-tracker).
      // The earlier multi-engine snapshots stay readable at /organic-serp/organic/archive.
      { id: "organic", label: "Organic SERP", status: "live" },
    ],
  },
  {
    id: "search-console",
    label: "Search Console",
    icon: "gsc",
    items: [
      { id: "performance", label: "Performance", status: "live", requires: "gsc" },
      { id: "opportunities", label: "Opportunities", status: "live", requires: "gsc" },
    ],
  },
  {
    id: "analytics",
    label: "Analytics (GA4)",
    icon: "analytics",
    items: [
      { id: "overview", label: "Analytics", status: "live", requires: "ga4" },
      { id: "reports", label: "GA4 reports", status: "live", requires: "ga4" },
      { id: "llm-traffic", label: "LLMs Traffic", status: "live", requires: "ga4" },
    ],
  },
  {
    id: "local-seo",
    label: "Local SEO",
    icon: "pin",
    items: [
      {
        id: "business-profile",
        label: "Business Profile",
        status: "planned",
        milestone: "08",
        description: "Public listing analysis with evidence-based recommendations, compared with competitors.",
      },
      { id: "reviews", label: "Maps reviews", status: "live", requires: "reviews" },
    ],
  },
  {
    id: "technical-seo",
    label: "Technical SEO",
    icon: "wrench",
    items: [
      // The latest existing SE Ranking site audit (never starts a crawl).
      { id: "site-audit", label: "Site audit", status: "live" },
      { id: "pagespeed", label: "PageSpeed", status: "live" },
      { id: "indexing", label: "Indexing", status: "live", requires: "gsc" },
      {
        id: "structured-data",
        label: "Structured Data / Schema",
        status: "planned",
        milestone: "09d",
        description: "Checks the structured data (schema.org JSON-LD and microdata) on your pages for errors and missing recommended fields. The checking engine isn't built yet.",
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
    // Phase one ports the AI Brand Mention app's two screens; Searchable is not part of it. Usage, costs and
    // budgets live in Settings → Account (old ai-area/usage addresses redirect there; see LEGACY_ITEMS).
    // Google Search Tracking moved to Rank tracking → Organic SERP (old addresses redirect there, same view).
    items: [{ id: "brand-mentions", label: "Brand Mentions", status: "live" }],
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
    label: "Reports",
    icon: "report",
    items: [
      { id: "weekly", label: "Weekly report", status: "live", requires: "ga4" },
      {
        id: "monthly",
        label: "Monthly report",
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
    // Project-specific configuration only. Account settings open from the account menu (bottom-left).
    items: [{ id: "project", label: "Project settings", status: "live" }],
  },
];

/** Project-level sub-tabs carried in the address (/p/1/analytics/overview/key-events). */
export const DEFAULT_ITEM = { group: "dashboard", item: "overview" } as const;

export type ShellLocation =
  | { kind: "portfolio" }
  | { kind: "pick"; group: string; item: string; sub?: string }
  | { kind: "project"; projectId: number; group: string; item: string; sub: string }
  | { kind: "docs"; slug?: string }
  | { kind: "team" }
  | { kind: "account"; section: string; projectId: number | null };

/** Account settings sections ("" = API credentials, kept as the default for old links). */
export const ACCOUNT_SECTIONS = ["profile", "logins", "", "usage", "budgets", "spending", "notifications", "connections", "sync"] as const;
const accountSection = (s: string | undefined) => (s && (ACCOUNT_SECTIONS as readonly string[]).includes(s) ? s : "");
const projectParam = (search: string | undefined) => {
  const id = Number(new URLSearchParams(search ?? "").get("project"));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export function findItem(group: string, item: string): { group: NavGroup; item: NavItem } | null {
  const g = NAV.find((x) => x.id === group);
  const i = g?.items.find((x) => x.id === item);
  return g && i ? { group: g, item: i } : null;
}

/**
 * Pages that moved: old group/item → new group/item/sub. Old bookmarks keep working, with the same project
 * (and, from All projects, no project) — never a hard-coded one.
 */
export const LEGACY_ITEMS: Record<string, { section: string }> = {
  "ai-area/usage": { section: "usage" },
  "settings/account": { section: "" },
};

/**
 * Rank tracking pages that became one page: the old per-engine items open Organic SERP with that engine selected
 * (and, for the old Google item, nothing from AI Area's tracker). Same project; any old sub-path is dropped.
 */
export const LEGACY_PAGES: Record<string, { group: string; item: string; sub: string | null }> = {
  // sub null: keep the old sub-path (the view), e.g. …/ai-area/google-search-tracking/mentions → …/organic/mentions.
  "ai-area/google-search-tracking": { group: "organic-serp", item: "organic", sub: null },
  "organic-serp/google": { group: "organic-serp", item: "organic", sub: "rank-tracker" },
  "organic-serp/bing": { group: "organic-serp", item: "organic", sub: "archive" },
  "organic-serp/yandex": { group: "organic-serp", item: "organic", sub: "archive" },
  "organic-serp/naver": { group: "organic-serp", item: "organic", sub: "archive" },
};

/** Sub-paths of the superseded multi-engine Organic SERP (2026-10-16): Google → the rank tracker, others → archive. */
const OLD_ENGINE_SUB: Record<string, string> = { google: "rank-tracker", bing: "archive", yandex: "archive", naver: "archive" };
const organicSub = (group: string, item: string, sub: string) => (group === "organic-serp" && item === "organic" && OLD_ENGINE_SUB[sub] ? OLD_ENGINE_SUB[sub] : sub);

/** True for paths the v2 shell owns; everything else stays with the legacy dashboard. */
export function isShellPath(segments: string[]): boolean {
  return segments[0] === "portfolio" || segments[0] === "p" || segments[0] === "docs" || segments[0] === "account" || segments[0] === "team";
}

/** Reads a shell address. Unknown pages fall back to the project overview; unknown roots give null. */
export function parseShellPath(segments: string[], search?: string): ShellLocation | null {
  const [root, a, b, c, d] = segments;
  if (root === "docs") return a && /^[a-z0-9-]{1,100}$/.test(a) ? { kind: "docs", slug: a } : { kind: "docs" };
  if (root === "account") return { kind: "account", section: accountSection(a), projectId: projectParam(search) };
  if (root === "team") return { kind: "team" };
  if (root === "portfolio") {
    // Older account / usage addresses: Account settings without a project.
    const moved = a && b ? LEGACY_ITEMS[`${a}/${b}`] : undefined;
    if (moved) return { kind: "account", section: accountSection(c) || moved.section, projectId: null };
    const page = a && b ? LEGACY_PAGES[`${a}/${b}`] : undefined;
    if (page) {
      const sub = page.sub ?? c ?? "";
      return sub ? { kind: "pick", group: page.group, item: page.item, sub } : { kind: "pick", group: page.group, item: page.item };
    }
    if (a && b && findItem(a, b)) return c ? { kind: "pick", group: a, item: b, sub: organicSub(a, b, c) } : { kind: "pick", group: a, item: b };
    return { kind: "portfolio" };
  }
  if (root === "p") {
    const projectId = Number(a);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) return { kind: "portfolio" };
    // Older account / usage addresses keep the project as the usage filter.
    const moved = b && c ? LEGACY_ITEMS[`${b}/${c}`] : undefined;
    if (moved) return { kind: "account", section: accountSection(d) || moved.section, projectId };
    const page = b && c ? LEGACY_PAGES[`${b}/${c}`] : undefined;
    if (page) return { kind: "project", projectId, group: page.group, item: page.item, sub: page.sub ?? d ?? "" };
    if (b && c && findItem(b, c)) return { kind: "project", projectId, group: b, item: c, sub: organicSub(b, c, d ?? "") };
    return { kind: "project", projectId, ...DEFAULT_ITEM, sub: "" };
  }
  return null;
}

export function buildShellPath(loc: ShellLocation): string {
  switch (loc.kind) {
    case "portfolio":
      return "/portfolio";
    case "docs":
      return loc.slug ? `/docs/${loc.slug}` : "/docs";
    case "team":
      return "/team";
    case "pick":
      return `/portfolio/${loc.group}/${loc.item}${loc.sub ? `/${loc.sub}` : ""}`;
    case "account":
      return `/account${loc.section ? `/${loc.section}` : ""}${loc.projectId ? `?project=${loc.projectId}` : ""}`;
    case "project":
      return `/p/${loc.projectId}/${loc.group}/${loc.item}${loc.sub ? `/${loc.sub}` : ""}`;
  }
}

/**
 * Where to go when the project switcher changes. Switching between projects
 * keeps the current page (but not its data sub-tab, except a Settings
 * section); "All projects" goes to the portfolio.
 */
export function switchProject(current: ShellLocation, projectId: number | null): ShellLocation {
  // Account settings don't depend on a project: stay on the page; the project only becomes the usage filter.
  if (current.kind === "account") return { ...current, projectId };
  if (projectId == null) return { kind: "portfolio" };
  if (current.kind === "project") {
    // Settings sections are the same for every project, so they carry over; data sub-tabs don't.
    const sub = current.group === "settings" ? current.sub : "";
    return { kind: "project", projectId, group: current.group, item: current.item, sub };
  }
  if (current.kind === "pick") {
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
