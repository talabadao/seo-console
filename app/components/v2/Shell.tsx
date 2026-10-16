"use client";

// v2 console shell, behind the V2_SHELL feature flag.
// Owns the layout, navigation, project switcher and addresses; the existing
// working views (Performance, Opportunities, Analytics, Weekly Report,
// Indexing, Page Speed, Reviews) are mounted inside it unchanged.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_ITEM,
  NAV,
  REQUIREMENT_LABEL,
  buildShellPath,
  findItem,
  meetsRequirement,
  parseShellPath,
  switchProject,
  type NavGroup,
  type NavItem,
  type ShellLocation,
} from "@/lib/v2/nav";
import { hostOf } from "@/lib/projectMatch";
import { Favicon, ProjectManager, type Project, type ProjectView } from "../ProjectManager";
import { PerformanceView, SEARCH_TYPES } from "../PerformanceView";
import { Opportunities } from "../Opportunities";
import { Analytics } from "../Analytics";
import { WeeklyReport } from "../WeeklyReport";
import { Indexing } from "../Indexing";
import { PageSpeed } from "../PageSpeed";
import { Reviews } from "../Reviews";
import { SettingsPanel } from "../SettingsPanel";
import { GoogleReconnectBanner } from "../GoogleReconnect";
import { Icon } from "./icons";
import {
  BacklinksDemo,
  CompetitorOverviewDemo,
  EditorialBoardDemo,
  KeywordExplorerDemo,
  MonthlyReportDemo,
} from "./DemoPages";
import { Breadcrumbs, EmptyState, ErrorState, LoadingState, PageHeader, buttonClass, primaryButtonClass, type Crumb, type Status } from "./ui";
import { ProjectDashboard } from "./ProjectDashboard";
import { PortfolioDashboard } from "./PortfolioDashboard";
import { ProjectSettings } from "./ProjectSettings";
import { AccountSettings } from "./AccountSettings";
import { LlmTrafficReport } from "./LlmTrafficReport";
import { TrackingTab } from "../ai-area/tracking/TrackingTab";
import { BrandMentionsView } from "../ai-area/brand/BrandMentionsView";
import { AiUsageSummary } from "./UsageCosts";
import { useStored, writeStored } from "./summaryClient";

interface SiteMeta {
  id: number;
  source: string;
  property: string;
  lastSync: { status: string; finished_at: number | null } | null;
}

const PROJECT_KEY = "seo-project"; // shared with the classic dashboard
const COLLAPSE_KEY = "seo-v2-sidebar-collapsed";

const segmentsOf = (pathname: string) =>
  pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

export function Shell({
  user,
  bingConnected,
  initialPath,
}: {
  user: { email: string; name: string | null; picture: string | null };
  bingConnected: boolean;
  initialPath: string[];
}) {
  const [loc, setLoc] = useState<ShellLocation>(() => parseShellPath(initialPath) ?? { kind: "portfolio" });
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "error">("loading");
  const [sites, setSites] = useState<SiteMeta[]>([]);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [projectView, setProjectView] = useState<ProjectView | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const collapsed = useStored(COLLAPSE_KEY, false, (v) => v === 1);
  const [searchType, setSearchType] = useState("web");
  const [notice, setNotice] = useState<string | null>(null);

  const navigate = useCallback((next: ShellLocation | string, replace = false) => {
    const href = typeof next === "string" ? next : buildShellPath(next);
    const parsed = parseShellPath(segmentsOf(href.split("?")[0]));
    if (!parsed) {
      window.location.assign(href); // a classic-dashboard address
      return;
    }
    // Always record the canonical address (old addresses, e.g. /p/4/ai-area/usage, resolve to their new page).
    const canonical = buildShellPath(parsed) + (href.includes("?") ? href.slice(href.indexOf("?")) : "");
    if (window.location.pathname + window.location.search !== canonical) {
      if (replace) window.history.replaceState(null, "", canonical);
      else window.history.pushState(null, "", canonical);
    }
    setLoc(parsed);
    setDrawer(false);
    setNotice(null);
  }, []);

  // Back / Forward.
  useEffect(() => {
    const onPop = () => setLoc(parseShellPath(segmentsOf(window.location.pathname)) ?? { kind: "portfolio" });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Normalise the address once (e.g. /p/7 → /p/7/dashboard/overview).
  const normalised = useRef(false);
  useEffect(() => {
    if (normalised.current) return;
    normalised.current = true;
    const want = buildShellPath(loc);
    if (window.location.pathname !== want) window.history.replaceState(null, "", want + window.location.search);
  }, [loc]);

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/sites");
    if (!res.ok) return;
    const json = await res.json();
    if (json.needsReconnect) setNeedsReconnect(true);
    setSites(json.sites ?? []);
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(String(res.status));
      setProjects(((await res.json()).projects ?? []) as Project[]);
      setProjectsState("ready");
    } catch {
      setProjectsState("error");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadSites(); // first: the server pairs new projects with these properties
      await loadProjects();
    })();
  }, [loadSites, loadProjects]);

  const project = loc.kind === "project" ? (projects.find((p) => p.id === loc.projectId) ?? null) : null;

  useEffect(() => {
    if (!project) return;
    try {
      localStorage.setItem(PROJECT_KEY, String(project.id));
    } catch {}
  }, [project]);

  function toggleCollapsed() {
    writeStored(COLLAPSE_KEY, collapsed ? 0 : 1);
  }

  const sidebar = (mobile: boolean) => (
    <Sidebar
      loc={loc}
      project={project}
      collapsed={!mobile && collapsed}
      onNavigate={navigate}
      onToggleCollapsed={mobile ? () => setDrawer(false) : toggleCollapsed}
      mobile={mobile}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-surface/95 px-4 backdrop-blur lg:px-6">
        <button
          onClick={() => setDrawer(true)}
          aria-label="Open navigation"
          className="rounded-md p-1.5 hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:hidden"
        >
          <Icon name="menu" />
        </button>
        <a
          href="/portfolio"
          onClick={(e) => {
            e.preventDefault();
            navigate({ kind: "portfolio" });
          }}
          className="hidden items-center gap-2 font-semibold sm:flex"
        >
          SEO Console
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">v2 preview</span>
        </a>
        <ProjectSwitcher
          projects={projects}
          current={project}
          loading={projectsState === "loading"}
          onPick={(id) => navigate(switchProject(loc, id))}
          onNew={() => setProjectView("new")}
          onManage={() => setProjectView("list")}
        />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <a href="/" className="hidden text-muted hover:text-foreground sm:inline" title="The current console, unchanged">
            Classic view
          </a>
          {user.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.picture} alt="" className="h-7 w-7 rounded-full" />
          ) : null}
          <span className="hidden max-w-48 truncate text-muted md:inline" title={user.email}>
            {user.email}
          </span>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.reload();
            }}
            className="text-muted hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex">
        <div className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r bg-surface lg:block ${collapsed ? "w-16" : "w-72"}`}>
          {sidebar(false)}
        </div>

        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-surface shadow-xl">{sidebar(true)}</div>
          </div>
        )}

        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-6">
          {notice && (
            <div className="mb-4 flex items-center justify-between rounded-lg border bg-surface p-3 text-sm">
              <span>{notice}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-muted">
                ✕
              </button>
            </div>
          )}
          <Page
            key={loc.kind === "project" ? `${loc.projectId}:${loc.group}:${loc.item}` : `${loc.kind}:${"group" in loc ? loc.group + loc.item : ""}`}
            loc={loc}
            project={project}
            projects={projects}
            projectsState={projectsState}
            sites={sites}
            needsReconnect={needsReconnect}
            searchType={searchType}
            setSearchType={setSearchType}
            onNavigate={navigate}
            onEditProject={(id) => setProjectView(id ?? "new")}
            onOpenSettings={() => setShowSettings(true)}
            onNeedsReconnect={() => setNeedsReconnect(true)}
            onNotice={setNotice}
            onRetryProjects={loadProjects}
          />
        </main>
      </div>

      {projectView != null && (
        <ProjectManager
          projects={projects}
          gscProperties={sites.filter((s) => s.source === "google").map((s) => s.property)}
          initialView={projectView}
          onClose={() => setProjectView(null)}
          onChanged={async (selectId) => {
            await loadProjects();
            if (selectId) navigate(switchProject(loc, selectId));
          }}
        />
      )}
      {showSettings && (
        <SettingsPanel
          property={project?.gscProperty ?? ""}
          bingConnected={bingConnected}
          onClose={() => setShowSettings(false)}
          onChanged={loadSites}
        />
      )}
    </div>
  );
}

// ---------- sidebar ----------

function itemHref(loc: ShellLocation, project: Project | null, group: string, item: string): ShellLocation {
  if (project) return { kind: "project", projectId: project.id, group, item, sub: "" };
  if (findItem(group, item)?.item.scope === "account") return { kind: "pick", group, item };
  if (group === DEFAULT_ITEM.group && item === DEFAULT_ITEM.item) return { kind: "portfolio" };
  return { kind: "pick", group, item };
}

function Sidebar({
  loc,
  project,
  collapsed,
  mobile,
  onNavigate,
  onToggleCollapsed,
}: {
  loc: ShellLocation;
  project: Project | null;
  collapsed: boolean;
  mobile: boolean;
  onNavigate: (l: ShellLocation) => void;
  onToggleCollapsed: () => void;
}) {
  // On All projects, "Dashboard" is the portfolio dashboard; inside a project it's that project's dashboard.
  const activeGroup = loc.kind === "project" || loc.kind === "pick" ? loc.group : loc.kind === "portfolio" ? DEFAULT_ITEM.group : null;
  const activeItem = loc.kind === "project" || loc.kind === "pick" ? loc.item : null;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (g: NavGroup) => open[g.id] ?? (g.id === activeGroup || g.items.length <= 2);

  const link = (target: ShellLocation, label: string, active: boolean, children: ReactNode, title?: string) => (
    <a
      href={buildShellPath(target)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onNavigate(target);
      }}
      aria-current={active ? "page" : undefined}
      title={title ?? label}
      className={`flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        active ? "bg-accent-soft font-semibold text-accent" : "text-foreground hover:bg-accent-soft/50"
      } ${collapsed ? "justify-center px-0" : ""}`}
    >
      {children}
    </a>
  );

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className={`flex items-center border-b px-3 py-2 ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed && <span className="text-xs font-medium uppercase tracking-wide text-muted">{project ? "Project" : "Workspace"}</span>}
        <button
          onClick={onToggleCollapsed}
          aria-label={mobile ? "Close navigation" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-md p-1 text-muted hover:bg-accent-soft hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Icon name={mobile ? "x" : collapsed ? "chevronRight" : "chevronLeft"} className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV.map((g) => {
          const groupActive = g.id === activeGroup;
          if (collapsed) {
            const first = g.items[0];
            return (
              <div key={g.id}>
                {link(itemHref(loc, project, g.id, first.id), g.label, groupActive, <Icon name={g.icon} />, g.label)}
              </div>
            );
          }
          if (g.items.length === 1) {
            const it = g.items[0];
            return (
              <div key={g.id}>
                {link(itemHref(loc, project, g.id, it.id), g.label, groupActive, (
                  <>
                    <Icon name={g.icon} />
                    <span className="min-w-0 flex-1 leading-snug">{g.label}</span>
                    <ItemMark item={it} project={project} />
                  </>
                ))}
              </div>
            );
          }
          const expanded = isOpen(g);
          return (
            <div key={g.id}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))}
                aria-expanded={expanded}
                title={g.label}
                className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm font-medium hover:bg-accent-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  groupActive ? "text-accent" : ""
                }`}
              >
                <Icon name={g.icon} />
                <span className="min-w-0 flex-1 leading-snug">{g.label}</span>
                <Icon name={expanded ? "chevronDown" : "chevronRight"} className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
              </button>
              {expanded && (
                <div className="ml-5 mt-0.5 space-y-0.5 border-l pl-2">
                  {g.items.map((it) => (
                    <div key={it.id}>
                      {link(itemHref(loc, project, g.id, it.id), it.label, groupActive && it.id === activeItem, (
                        <>
                          <span className="min-w-0 flex-1 font-normal leading-snug">{it.label}</span>
                          <ItemMark item={it} project={project} />
                        </>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t p-2">
        {link({ kind: "docs" }, "Docs", loc.kind === "docs", (
          <>
            <Icon name="book" />
            {!collapsed && (
              <>
                <span className="flex-1">Docs</span>
                <span className="shrink-0 rounded border border-dashed px-1 text-[10px] uppercase tracking-wide text-muted">Soon</span>
              </>
            )}
          </>
        ))}
      </div>
    </nav>
  );
}

/** Small text marker after a nav label: Demo, Planned, or a dot when the project lacks a connection. */
function ItemMark({ item, project }: { item: NavItem; project: Project | null }) {
  if (item.status === "demo") return <span className="shrink-0 rounded border px-1 text-[10px] uppercase tracking-wide text-muted" title="Sample data">Demo</span>;
  if (item.status === "planned") return <span className="shrink-0 rounded border border-dashed px-1 text-[10px] uppercase tracking-wide text-muted" title="Not built yet">Soon</span>;
  if (project && !meetsRequirement(item.requires, project)) {
    return <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--bad)" }} title="Not connected" />;
  }
  return null;
}

// ---------- project switcher ----------

function ProjectSwitcher({
  projects,
  current,
  loading,
  onPick,
  onNew,
  onManage,
}: {
  projects: Project[];
  current: Project | null;
  loading: boolean;
  onPick: (id: number | null) => void;
  onNew: () => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? projects.filter((p) => p.name.toLowerCase().includes(needle) || p.websiteUrl.toLowerCase().includes(needle))
    : projects;
  const pick = (id: number | null) => {
    setOpen(false);
    setQ("");
    onPick(id);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-44 items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:w-64"
      >
        {current ? <Favicon src={current.faviconUrl} name={current.name} size={18} /> : <Icon name="grid" className="h-4 w-4 text-muted" />}
        <span className="flex-1 truncate font-medium">{loading ? "Loading…" : (current?.name ?? "All projects")}</span>
        <span aria-hidden="true" className="text-muted">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-80 max-w-[90vw] rounded-lg border bg-surface shadow-xl">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="w-full border-b bg-transparent px-3 py-2 text-sm outline-none"
          />
          <ul role="listbox" aria-label="Projects" className="max-h-80 overflow-auto py-1">
            <li>
              <button
                role="option"
                aria-selected={!current}
                onClick={() => pick(null)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none ${!current ? "text-accent" : ""}`}
              >
                <Icon name="grid" className="h-4 w-4" />
                All projects
              </button>
            </li>
            {shown.map((p) => (
              <li key={p.id}>
                <button
                  role="option"
                  aria-selected={p.id === current?.id}
                  onClick={() => pick(p.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none ${
                    p.id === current?.id ? "text-accent" : ""
                  }`}
                >
                  <Favicon src={p.faviconUrl} name={p.name} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                    {p.websiteUrl && <span className="block truncate text-xs text-muted">{hostOf(p.websiteUrl)}</span>}
                  </span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="px-3 py-2 text-sm text-muted">No matching projects.</li>}
          </ul>
          <div className="flex gap-2 border-t p-2">
            <button onClick={() => { setOpen(false); onNew(); }} className={`flex-1 justify-center ${primaryButtonClass}`}>
              New project
            </button>
            <button onClick={() => { setOpen(false); onManage(); }} className={`flex-1 justify-center ${buttonClass}`}>
              Manage
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- pages ----------

interface PageProps {
  loc: ShellLocation;
  project: Project | null;
  projects: Project[];
  projectsState: "loading" | "ready" | "error";
  sites: SiteMeta[];
  needsReconnect: boolean;
  searchType: string;
  setSearchType: (s: string) => void;
  onNavigate: (l: ShellLocation | string) => void;
  onEditProject: (id?: number) => void;
  onOpenSettings: () => void;
  onNeedsReconnect: () => void;
  onNotice: (m: string) => void;
  onRetryProjects: () => void;
}

function Page(props: PageProps) {
  const { loc, project, projects, projectsState, onNavigate } = props;
  const nav = (href: string) => onNavigate(href);

  if (projectsState === "loading") return <LoadingState label="Loading projects…" rows={6} />;
  if (projectsState === "error") {
    return (
      <ErrorState
        title="Couldn't load your projects."
        body="Check your connection and try again."
        action={
          <button className={buttonClass} onClick={props.onRetryProjects}>
            Try again
          </button>
        }
      />
    );
  }

  if (loc.kind === "portfolio") return <PortfolioPage {...props} />;

  if (loc.kind === "docs") {
    return (
      <>
        <PageHeader crumbs={[{ label: "Workspace" }, { label: "Docs" }]} title="Docs" status="planned" onNavigate={nav} />
        <EmptyState
          title="Docs aren't available yet."
          body="A product guide, SOPs and training material, linking to existing Drive documents with their current permissions."
        />
      </>
    );
  }

  if (loc.kind === "pick") {
    const found = findItem(loc.group, loc.item)!;
    if (found.item.scope === "account") {
      return (
        <>
          <PageHeader
            crumbs={[{ label: "All projects", href: "/portfolio" }, { label: found.group.label }, { label: found.item.label }]}
            title={found.item.label}
            onNavigate={nav}
          />
          <AccountSettings
            sub={loc.sub ?? ""}
            projectId={null}
            projects={projects}
            onSub={(sub) => onNavigate({ kind: "pick", group: loc.group, item: loc.item, ...(sub ? { sub } : {}) })}
            onProjectsChanged={props.onRetryProjects}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader
          crumbs={[{ label: "All projects", href: "/portfolio" }, { label: found.group.label }, { label: found.item.label }]}
          title={found.item.label}
          description="This page belongs to a single project. Choose which one to open."
          onNavigate={nav}
        />
        {projects.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <a
                key={p.id}
                href={buildShellPath({ kind: "project", projectId: p.id, group: loc.group, item: loc.item, sub: "" })}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate({ kind: "project", projectId: p.id, group: loc.group, item: loc.item, sub: "" });
                }}
                className="flex items-center gap-3 rounded-xl border bg-surface p-4 hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Favicon src={p.faviconUrl} name={p.name} size={28} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted">{p.websiteUrl ? hostOf(p.websiteUrl) : "No website"}</span>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <NoProjects onNew={() => props.onEditProject()} />
        )}
      </>
    );
  }

  // Project pages. The project must be one of this account's own; the server
  // enforces the same rule on every API call.
  if (!project) {
    return (
      <ErrorState
        title="Project not found."
        body="It doesn't exist or isn't one of your projects."
        action={
          <button className={buttonClass} onClick={() => onNavigate({ kind: "portfolio" })}>
            Go to All projects
          </button>
        }
      />
    );
  }

  const found = findItem(loc.group, loc.item)!;
  const item = found.item;
  const connected = meetsRequirement(item.requires, project);
  const status: Status = item.status === "live" && !connected ? "not-connected" : item.status;
  const crumbs: Crumb[] = [
    { label: "All projects", href: "/portfolio" },
    { label: project.name, href: buildShellPath({ kind: "project", projectId: project.id, ...DEFAULT_ITEM, sub: "" }) },
    ...(found.group.items.length > 1 || found.group.label !== item.label ? [{ label: found.group.label }] : []),
    { label: item.label },
  ];
  const actions =
    loc.group === "search-console" && connected ? (
      <label className="flex items-center gap-2 text-sm text-muted">
        Search type
        <select
          value={props.searchType}
          onChange={(e) => props.setSearchType(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          {SEARCH_TYPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    ) : undefined;

  if (loc.group === "dashboard") {
    return (
      <>
        <div className="mb-3">
          <Breadcrumbs crumbs={crumbs} onNavigate={nav} />
        </div>
        <ProjectPage {...props} project={project} item={item} connected={connected} />
      </>
    );
  }
  return (
    <>
      <PageHeader crumbs={crumbs} title={item.label} status={status === "live" ? undefined : status} description={item.status !== "live" ? item.description : undefined} actions={actions} onNavigate={nav} />
      <ProjectPage {...props} project={project} item={item} connected={connected} />
    </>
  );
}

function ProjectPage({
  loc,
  project,
  projects,
  item,
  connected,
  sites,
  needsReconnect,
  searchType,
  onNavigate,
  onEditProject,
  onOpenSettings,
  onNeedsReconnect,
  onNotice,
  onRetryProjects,
}: PageProps & { project: Project; item: NavItem; connected: boolean }) {
  if (loc.kind !== "project") return null;
  const subNav = (sub: string) => onNavigate({ ...loc, sub });

  if (item.status === "planned") {
    return (
      <EmptyState
        title="This page isn't built yet."
        body={<p>{item.description} Nothing on this page reads or writes any data yet.</p>}
      />
    );
  }
  if (item.status === "demo") {
    const key = `${loc.group}/${loc.item}`;
    if (key === "keyword-research/explorer") return <KeywordExplorerDemo />;
    if (key === "competitive-research/overview") return <CompetitorOverviewDemo />;
    if (key === "link-building/backlinks") return <BacklinksDemo />;
    if (key === "content/board") return <EditorialBoardDemo />;
    if (key === "reports/monthly") return <MonthlyReportDemo />;
  }
  if (!connected && item.requires) {
    return (
      <EmptyState
        title={`${project.name} has no ${REQUIREMENT_LABEL[item.requires]} linked.`}
        body="Link it in the project settings to use this page."
        action={
          <button className={primaryButtonClass} onClick={() => onEditProject(project.id)}>
            Edit project
          </button>
        }
      />
    );
  }

  const gscReconnect = needsReconnect && item.requires === "gsc" && (
    <GoogleReconnectBanner detail="Google stopped accepting this app's Search Console access. Sign in again to reconnect." />
  );
  const property = project.gscProperty ?? "";
  const site = sites.find((s) => s.property === property);

  switch (`${loc.group}/${loc.item}`) {
    case "dashboard/overview":
      return <ProjectDashboard project={project} onNavigate={onNavigate} />;
    case "search-console/performance":
      return gscReconnect || <PerformanceView property={property} searchType={searchType} onNeedsReconnect={onNeedsReconnect} onNotice={onNotice} />;
    case "search-console/opportunities":
      return gscReconnect || <Opportunities property={property} searchType={searchType} sub={loc.sub} onSub={subNav} />;
    case "ai-area/google-search-tracking":
    case "organic-serp/google":
      return (
        <div className="ai-area">
          <AiUsageSummary projectId={project.id} onOpen={() => onNavigate({ ...loc, group: "settings", item: "account", sub: "usage" })} />
          {loc.group === "organic-serp" && (
            <p className="mb-3 text-xs text-muted">Same keywords, data and runs as AI Area → Google Search Tracking; nothing is tracked or charged twice.</p>
          )}
          <TrackingTab projectId={project.id} sub={loc.sub} onSub={subNav} defaultView={loc.group === "organic-serp" ? "rank" : "overview"} />
        </div>
      );
    case "ai-area/brand-mentions":
      return (
        <div className="ai-area">
          <AiUsageSummary projectId={project.id} onOpen={() => onNavigate({ ...loc, group: "settings", item: "account", sub: "usage" })} />
          <BrandMentionsView
            projectId={project.id}
            sub={loc.sub}
            onSub={subNav}
            onOpenTrackingSettings={() => onNavigate({ ...loc, group: "ai-area", item: "google-search-tracking", sub: "settings" })}
            onOpenReviews={() => onNavigate({ ...loc, group: "local-seo", item: "reviews", sub: "" })}
            onOpenBudgets={() => onNavigate({ ...loc, group: "settings", item: "account", sub: "budgets" })}
          />
        </div>
      );
    case "analytics/llm-traffic":
      return <LlmTrafficReport projectId={project.id} />;
    case "analytics/overview":
      return <Analytics fixedPropertyId={project.gaPropertyId ?? ""} sub={loc.sub} onSub={subNav} />;
    case "reports/weekly":
      return (
        <WeeklyReport
          fixedPropertyId={project.gaPropertyId ?? ""}
          sub={loc.sub}
          onSub={subNav}
          leadEventsHref={(id) => buildShellPath({ kind: "project", projectId: id, group: "settings", item: "project", sub: "analytics" })}
        />
      );
    case "local-seo/reviews":
      return <Reviews projectId={project.id} projectName={project.name} onEditProject={() => onEditProject(project.id)} />;
    case "technical-seo/pagespeed":
      return <PageSpeed projectId={project.id} websiteUrl={project.websiteUrl} />;
    case "technical-seo/indexing":
      return gscReconnect || <Indexing property={property} neverSynced={!site?.lastSync?.finished_at} />;
    case "settings/account":
      return (
        <AccountSettings
          sub={loc.sub}
          projectId={project.id}
          projects={projects}
          onSub={subNav}
          onProjectsChanged={onRetryProjects}
        />
      );
    case "settings/project":
      return (
        <ProjectSettings
          project={project}
          sub={loc.sub}
          sites={sites}
          onSub={subNav}
          onNavigate={onNavigate}
          onEditProject={(id) => onEditProject(id)}
          onOpenConsoleSettings={onOpenSettings}
          onProjectChanged={onRetryProjects}
        />
      );
  }
  return <EmptyState title="This page isn't available." />;
}

function NoProjects({ onNew }: { onNew: () => void }) {
  return (
    <EmptyState
      title="No projects yet."
      body="A project groups one brand's website with its Search Console, Analytics and review sources."
      action={
        <button className={primaryButtonClass} onClick={onNew}>
          New project
        </button>
      }
    />
  );
}

function PortfolioPage({ projects, onNavigate, onEditProject, onRetryProjects }: PageProps) {
  // On a Preview deployment (where /api/preview-status exists), an approved
  // user can add synthetic demo projects to their own, otherwise empty, account.
  const [preview, setPreview] = useState(false);
  const [adding, setAdding] = useState<"idle" | "busy" | "error">("idle");
  useEffect(() => {
    if (projects.length) return;
    fetch("/api/preview-status")
      .then((r) => setPreview(r.ok))
      .catch(() => {});
  }, [projects.length]);
  async function addDemo() {
    setAdding("busy");
    const res = await fetch("/api/preview/demo-projects", { method: "POST" }).catch(() => null);
    if (!res?.ok) return setAdding("error");
    setAdding("idle");
    onRetryProjects();
  }
  const demoButton = preview ? (
    <button className={buttonClass} onClick={addDemo} disabled={adding === "busy"} title="Adds three invented projects to your own account on this Preview">
      {adding === "busy" ? "Adding…" : adding === "error" ? "Couldn't add demo projects. Try again" : "Add demo projects"}
    </button>
  ) : null;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Workspace" }, { label: "All projects" }]}
        title="All projects"
        description="Performance and work across the projects your account owns."
        actions={
          <button className={primaryButtonClass} onClick={() => onEditProject()}>
            New project
          </button>
        }
        onNavigate={(h) => onNavigate(h)}
      />
      {projects.length ? (
        <PortfolioDashboard projects={projects} onNavigate={onNavigate} onNewProject={() => onEditProject()} />
      ) : (
        <EmptyState
          title="No projects yet."
          body={
            preview
              ? "Create a project, or add a few demo projects to explore the dashboards. Demo projects are invented, labelled as demo, and visible only to your account."
              : "A project groups one brand's website with its Search Console, Analytics and review sources."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button className={primaryButtonClass} onClick={() => onEditProject()}>
                New project
              </button>
              {demoButton}
            </div>
          }
        />
      )}
    </>
  );
}
