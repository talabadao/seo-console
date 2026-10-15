"use client";

// v2 console shell (Milestone 01b), behind the V2_SHELL feature flag.
// Owns the layout, navigation, project switcher and addresses; the existing
// working views (Performance, Opportunities, Analytics, Weekly Report,
// Indexing, Page Speed, Reviews) are mounted inside it unchanged.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  StatusBadge,
  buttonClass,
  primaryButtonClass,
  type Crumb,
  type Status,
} from "./ui";

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
  const [collapsed, setCollapsed] = useState(false);
  const [searchType, setSearchType] = useState("web");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);

  const navigate = useCallback((next: ShellLocation | string, replace = false) => {
    const href = typeof next === "string" ? next : buildShellPath(next);
    const parsed = parseShellPath(segmentsOf(href.split("?")[0]));
    if (!parsed) {
      window.location.assign(href); // a classic-dashboard address
      return;
    }
    if (window.location.pathname !== href) {
      if (replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
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
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
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
        <div className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r bg-surface lg:block ${collapsed ? "w-16" : "w-64"}`}>
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
  const activeGroup = loc.kind === "project" || loc.kind === "pick" ? loc.group : null;
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
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        active ? "bg-accent-soft font-medium text-accent" : "text-foreground hover:bg-accent-soft/50"
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
        {link({ kind: "portfolio" }, "All projects", loc.kind === "portfolio", (
          <>
            <Icon name="grid" />
            {!collapsed && <span>All projects</span>}
          </>
        ))}
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
                    <span className="flex-1 truncate">{g.label}</span>
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
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  groupActive ? "font-medium" : ""
                }`}
              >
                <Icon name={g.icon} />
                <span className="flex-1 truncate">{g.label}</span>
                <span aria-hidden="true" className="text-xs text-muted">
                  {expanded ? "▾" : "▸"}
                </span>
              </button>
              {expanded && (
                <div className="ml-5 mt-0.5 space-y-0.5 border-l pl-2">
                  {g.items.map((it) => (
                    <div key={it.id}>
                      {link(itemHref(loc, project, g.id, it.id), it.label, groupActive && it.id === activeItem, (
                        <>
                          <span className="flex-1 truncate">{it.label}</span>
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
                <span className="text-[11px] text-muted">Planned</span>
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
  if (item.status === "demo") return <span className="text-[11px] text-muted">Demo</span>;
  if (item.status === "planned") return <span className="text-[11px] text-muted">Planned</span>;
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
          title="The docs catalogue arrives in Milestone 13."
          body="Product guide, SOPs and intern training, linking to existing Drive documents with their current permissions."
        />
      </>
    );
  }

  if (loc.kind === "pick") {
    const found = findItem(loc.group, loc.item)!;
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

  return (
    <>
      <PageHeader crumbs={crumbs} title={item.label} status={status} description={item.status !== "live" ? item.description : undefined} actions={actions} onNavigate={nav} />
      <ProjectPage {...props} project={project} item={item} connected={connected} />
    </>
  );
}

function ProjectPage({
  loc,
  project,
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
}: PageProps & { project: Project; item: NavItem; connected: boolean }) {
  if (loc.kind !== "project") return null;
  const subNav = (sub: string) => onNavigate({ ...loc, sub });

  if (item.status === "planned") {
    return (
      <EmptyState
        title={`Planned for Milestone ${item.milestone}.`}
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
      return <ProjectOverview project={project} onNavigate={onNavigate} onEditProject={onEditProject} />;
    case "search-console/performance":
      return gscReconnect || <PerformanceView property={property} searchType={searchType} onNeedsReconnect={onNeedsReconnect} onNotice={onNotice} />;
    case "search-console/opportunities":
      return gscReconnect || <Opportunities property={property} searchType={searchType} sub={loc.sub} onSub={subNav} />;
    case "analytics/overview":
      return <Analytics fixedPropertyId={project.gaPropertyId ?? ""} sub={loc.sub} onSub={subNav} />;
    case "reports/weekly":
      return <WeeklyReport fixedPropertyId={project.gaPropertyId ?? ""} sub={loc.sub} onSub={subNav} />;
    case "local-seo/reviews":
      return <Reviews projectId={project.id} projectName={project.name} onEditProject={() => onEditProject(project.id)} />;
    case "technical-seo/pagespeed":
      return <PageSpeed projectId={project.id} websiteUrl={project.websiteUrl} />;
    case "technical-seo/indexing":
      return gscReconnect || <Indexing property={property} neverSynced={!site?.lastSync?.finished_at} />;
    case "settings/project":
      return <SettingsPage project={project} onEditProject={onEditProject} onOpenSettings={onOpenSettings} />;
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

function connectionStatus(on: boolean): Status {
  return on ? "live" : "not-connected";
}

function PortfolioPage({ projects, onNavigate, onEditProject }: PageProps) {
  const [only, setOnly] = useState<"all" | "missing">("all");
  const counts = useMemo(
    () => ({
      gsc: projects.filter((p) => p.gscProperty).length,
      ga4: projects.filter((p) => p.gaPropertyId).length,
      reviews: projects.filter((p) => p.mapsUrl && p.hasSerpKey).length,
    }),
    [projects],
  );
  const rows =
    only === "missing" ? projects.filter((p) => !p.gscProperty || !p.gaPropertyId || !(p.mapsUrl && p.hasSerpKey)) : projects;
  const open = (p: Project) => onNavigate({ kind: "project", projectId: p.id, ...DEFAULT_ITEM, sub: "" });
  const total = projects.length;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Workspace" }, { label: "All projects" }]}
        title="All projects"
        description="Only the projects your account owns. Performance, KPI and task columns arrive with portfolio summaries (Milestone 11)."
        actions={
          <button className={primaryButtonClass} onClick={() => onEditProject()}>
            New project
          </button>
        }
        onNavigate={(h) => onNavigate(h)}
      />
      {!total ? (
        <NoProjects onNew={() => onEditProject()} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Projects" value={String(total)} />
            <MetricCard label="Search Console linked" value={`${counts.gsc} of ${total}`} />
            <MetricCard label="GA4 linked" value={`${counts.ga4} of ${total}`} />
            <MetricCard label="Reviews set up" value={`${counts.reviews} of ${total}`} />
          </div>
          <DataTable
            rows={rows}
            rowKey={(p) => String(p.id)}
            exportName="projects"
            searchPlaceholder="Search projects…"
            toolbar={
              <select
                value={only}
                onChange={(e) => setOnly(e.target.value as "all" | "missing")}
                aria-label="Filter projects"
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="all">All projects</option>
                <option value="missing">Missing a connection</option>
              </select>
            }
            emptyText="No projects match."
            columns={[
              {
                key: "name",
                label: "Project",
                width: "28%",
                render: (p) => (
                  <a
                    href={buildShellPath({ kind: "project", projectId: p.id, ...DEFAULT_ITEM, sub: "" })}
                    onClick={(e) => {
                      e.preventDefault();
                      open(p);
                    }}
                    className="flex items-center gap-2 font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <Favicon src={p.faviconUrl} name={p.name} size={18} />
                    <span className="truncate">{p.name}</span>
                  </a>
                ),
              },
              { key: "website", label: "Website", value: (p) => (p.websiteUrl ? hostOf(p.websiteUrl) : null) },
              { key: "gsc", label: "Search Console", value: (p) => (p.gscProperty ? "Linked" : "Not connected"), render: (p) => <StatusBadge status={connectionStatus(Boolean(p.gscProperty))} /> },
              { key: "ga4", label: "GA4", value: (p) => (p.gaPropertyId ? "Linked" : "Not connected"), render: (p) => <StatusBadge status={connectionStatus(Boolean(p.gaPropertyId))} /> },
              {
                key: "reviews",
                label: "Maps reviews",
                value: (p) => (p.mapsUrl && p.hasSerpKey ? "Linked" : "Not connected"),
                render: (p) => <StatusBadge status={connectionStatus(Boolean(p.mapsUrl && p.hasSerpKey))} />,
              },
              { key: "asana", label: "Asana", value: (p) => p.asanaProjectName || (p.asanaProjectGid ? "Linked" : null) },
            ]}
          />
        </>
      )}
    </>
  );
}

function ProjectOverview({
  project,
  onNavigate,
  onEditProject,
}: {
  project: Project;
  onNavigate: (l: ShellLocation) => void;
  onEditProject: (id?: number) => void;
}) {
  const connections: { label: string; detail: string | null; on: boolean }[] = [
    { label: "Google Search Console", detail: project.gscProperty, on: Boolean(project.gscProperty) },
    { label: "Google Analytics 4", detail: project.gaPropertyId ? `Property ${project.gaPropertyId}` : null, on: Boolean(project.gaPropertyId) },
    { label: "Google Maps reviews", detail: project.gbpLocationTitle ?? (project.mapsUrl ? "Maps link saved" : null), on: Boolean(project.mapsUrl && project.hasSerpKey) },
    { label: "Asana", detail: project.asanaProjectName || project.asanaProjectGid || null, on: Boolean(project.asanaProjectGid) },
  ];
  const live = NAV.flatMap((g) => g.items.filter((i) => i.status === "live" && g.id !== "dashboard" && g.id !== "settings").map((i) => ({ g, i })));

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card
        title="Project"
        actions={
          <button className={buttonClass} onClick={() => onEditProject(project.id)}>
            Edit project
          </button>
        }
      >
        <div className="flex items-center gap-3">
          <Favicon src={project.faviconUrl} name={project.name} size={36} />
          <div className="min-w-0">
            <p className="truncate font-medium">{project.name}</p>
            {project.websiteUrl ? (
              <a href={project.websiteUrl} target="_blank" rel="noreferrer" className="truncate text-sm text-accent hover:underline">
                {hostOf(project.websiteUrl)}
              </a>
            ) : (
              <p className="text-sm text-muted">No website set</p>
            )}
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">
          Monthly KPI attainment, tasks and source health appear here with the project dashboard (Milestone 11).
        </p>
      </Card>
      <Card title="Connections" className="xl:col-span-2">
        <ul className="divide-y">
          {connections.map((c) => (
            <li key={c.label} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="w-48 font-medium">{c.label}</span>
              <StatusBadge status={connectionStatus(c.on)} />
              <span className="min-w-0 flex-1 truncate text-muted">{c.detail ?? "—"}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Live modules" className="xl:col-span-3">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {live.map(({ g, i }) => {
            const ok = meetsRequirement(i.requires, project);
            const target: ShellLocation = { kind: "project", projectId: project.id, group: g.id, item: i.id, sub: "" };
            return (
              <li key={`${g.id}/${i.id}`}>
                <a
                  href={buildShellPath(target)}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(target);
                  }}
                  className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span>
                    <span className="block font-medium">{i.label}</span>
                    <span className="block text-xs text-muted">{g.label}</span>
                  </span>
                  <StatusBadge status={ok ? "live" : "not-connected"} />
                </a>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function SettingsPage({
  project,
  onEditProject,
  onOpenSettings,
}: {
  project: Project;
  onEditProject: (id?: number) => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Project">
        <p className="text-sm text-muted">
          Brand name, website, favicon, linked Search Console and GA4 properties, Google Maps reviews source, Asana project
          and this month&apos;s KPI targets for {project.name}.
        </p>
        <button className={`mt-3 ${primaryButtonClass}`} onClick={() => onEditProject(project.id)}>
          Edit project
        </button>
      </Card>
      <Card title="Console settings">
        <p className="text-sm text-muted">Theme, Bing key, Asana token, brand terms, indexing automation and AI-search sources.</p>
        <button className={`mt-3 ${buttonClass}`} onClick={onOpenSettings}>
          Open settings
        </button>
      </Card>
      <Card title="Access" className="lg:col-span-2">
        <p className="text-sm text-muted">
          Sign-in is limited to approved Google accounts, and each account sees only its own projects. Workspace members and
          roles arrive in phase 2.
        </p>
      </Card>
    </div>
  );
}
