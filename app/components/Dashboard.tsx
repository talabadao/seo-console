"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Indexing } from "./Indexing";
import { Opportunities } from "./Opportunities";
import { Analytics } from "./Analytics";
import { WeeklyReport } from "./WeeklyReport";
import { PageSpeed } from "./PageSpeed";
import { Reviews } from "./Reviews";
import { SettingsPanel } from "./SettingsPanel";
import { GoogleReconnectBanner } from "./GoogleReconnect";
import { ProjectManager, ProjectPicker, type Project, type ProjectView } from "./ProjectManager";
import { PerformanceView, SEARCH_TYPES } from "./PerformanceView";
import { projectSlug } from "@/lib/projectMatch";

interface SiteMeta {
  id: number;
  source: string;
  property: string;
  lastSync: { status: string; finished_at: number | null } | null;
}

const PROJECT_KEY = "seo-project";

type Tab =
  | "performance"
  | "opportunities"
  | "analytics"
  | "indexing"
  | "weekly-report"
  | "pagespeed"
  | "reviews";

// Tabs fed by the project's Search Console property, and by its GA4 property.
const GSC_TABS: Tab[] = ["performance", "opportunities", "indexing"];
const GA_TABS: Tab[] = ["analytics", "weekly-report"];
const ALL_TABS: Tab[] = [
  "performance",
  "opportunities",
  "analytics",
  "weekly-report",
  "indexing",
  "pagespeed",
  "reviews",
];

/** Reads /<project>/<tab>/<sub-tab> (or just /<tab>) from an address path. */
function parsePath(segments: string[]): { project: string | null; tab: Tab | null; sub: string } {
  const isTab = (s: string | undefined): s is Tab => ALL_TABS.includes(s as Tab);
  if (isTab(segments[0])) return { project: null, tab: segments[0], sub: segments[1] ?? "" };
  return { project: segments[0] ?? null, tab: isTab(segments[1]) ? segments[1] : null, sub: segments[2] ?? "" };
}

const pathSegments = (pathname: string) =>
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

function MissingAsset({
  asset,
  project,
  onEdit,
}: {
  asset: string;
  project: string;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-xl border bg-surface p-6 text-sm">
      <p className="font-medium">
        {project} has no {asset} linked.
      </p>
      <p className="mt-1 text-muted">Link one in the project settings to see this tab.</p>
      <button
        onClick={onEdit}
        className="mt-3 rounded-md bg-accent px-3 py-1.5 font-medium text-white"
      >
        Edit project
      </button>
    </div>
  );
}

export function Dashboard({
  user,
  bingConnected,
  initialPath,
  v2Available = false,
}: {
  user: { email: string; name: string | null; picture: string | null };
  bingConnected: boolean;
  /** Address segments the page was opened on: [project, tab, sub-tab]. */
  initialPath: string[];
  /** The v2 shell is switched on for this deployment: show a link to it. */
  v2Available?: boolean;
}) {
  const [sites, setSites] = useState<SiteMeta[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectView, setProjectView] = useState<ProjectView | null>(null);
  const [searchType, setSearchType] = useState("web");
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<Tab>(() => parsePath(initialPath).tab ?? "performance");
  // Sub-tab segment of the address (empty = the tab's default section).
  const [sub, setSub] = useState(() => parsePath(initialPath).sub);
  const urlSynced = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/sites");
    if (!res.ok) return;
    const json = await res.json();
    if (json.needsReconnect) setNeedsReconnect(true);
    setSites(json.sites ?? []);
  }, []);

  // `selectId` switches to that project (after creating/editing one); otherwise
  // the current selection is kept, falling back to the one used last time.
  const loadProjects = useCallback(async (selectId?: number) => {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const list: Project[] = (await res.json()).projects ?? [];
    setProjects(list);
    setProjectsLoaded(true);
    setProjectId((cur) => {
      let stored: number | null = null;
      try {
        stored = Number(localStorage.getItem(PROJECT_KEY)) || null;
      } catch {}
      // The project named in the address wins on first load, then the last one used.
      const slug = parsePath(pathSegments(window.location.pathname)).project;
      const fromUrl = slug ? list.find((p) => projectSlug(p, list) === slug)?.id : null;
      const pick = [selectId, cur, fromUrl, stored].find(
        (id) => id != null && list.some((p) => p.id === id),
      );
      return pick ?? list[0]?.id ?? null;
    });
  }, []);

  // Sites first: the one-time project seeding on the server pairs projects
  // with the Search Console properties that request has just refreshed.
  useEffect(() => {
    (async () => {
      await loadSites();
      await loadProjects();
    })();
  }, [loadSites, loadProjects]);

  useEffect(() => {
    if (projectId == null) return;
    try {
      localStorage.setItem(PROJECT_KEY, String(projectId));
    } catch {}
  }, [projectId]);

  const project = projects.find((p) => p.id === projectId) ?? null;

  // Keep the address in step with the view: /<project>/<tab>/<sub-tab>. The
  // first sync replaces the entry the page was opened on; later changes add
  // history entries so Back and Forward move between views.
  useEffect(() => {
    if (!project) return;
    const want = `/${projectSlug(project, projects)}/${tab}${sub ? `/${sub}` : ""}`;
    if (window.location.pathname !== want) {
      if (urlSynced.current) window.history.pushState(null, "", want);
      else window.history.replaceState(null, "", want + window.location.search);
    }
    urlSynced.current = true;
  }, [project, projects, tab, sub]);

  // Back / Forward: follow the address.
  useEffect(() => {
    const onPop = () => {
      const p = parsePath(pathSegments(window.location.pathname));
      if (p.tab) setTab(p.tab);
      setSub(p.sub);
      if (p.project) {
        const match = projects.find((x) => projectSlug(x, projects) === p.project);
        if (match) setProjectId(match.id);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [projects]);
  const property = project?.gscProperty ?? "";
  const gaPropertyId = project?.gaPropertyId ?? "";

  async function runSync() {
    if (!property) return;
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property }),
      });
      const json = await res.json();
      if (json.result?.ok) {
        setNotice(`Synced ${json.result.rowsWritten.toLocaleString()} history rows.`);
        await loadSites();
      } else {
        setNotice(`Sync failed: ${json.result?.error ?? json.error ?? "unknown"}`);
      }
    } finally {
      setSyncing(false);
    }
  }

  const currentSite = sites.find((s) => s.property === property);
  const lastSyncText = currentSite?.lastSync?.finished_at
    ? `history synced ${format(currentSite.lastSync.finished_at, "MMM d, HH:mm")}`
    : "history not synced";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-5 py-3">
          <span className="text-base font-semibold">SEO Console</span>

          <ProjectPicker
            projects={projects}
            value={projectId}
            onChange={setProjectId}
            onManage={() => setProjectView("list")}
            onNew={() => setProjectView("new")}
          />

          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {SEARCH_TYPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            onClick={runSync}
            disabled={syncing || !property}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent-soft disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync history"}
          </button>
          <span className="text-xs text-muted">{lastSyncText}</span>

          <div className="ml-auto flex items-center gap-3">
            {v2Available && (
              <a
                href={project ? `/p/${project.id}/dashboard/overview` : "/portfolio"}
                className="rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft"
              >
                Try the new console
              </a>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent-soft"
            >
              Settings
            </button>
            {user.picture && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.picture} alt="" className="h-7 w-7 rounded-full" />
            )}
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                location.reload();
              }}
              className="text-sm text-muted hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="mx-auto flex max-w-[1500px] gap-1 px-5">
          {(
            [
              ["performance", "Performance"],
              ["opportunities", "Opportunities"],
              ["analytics", "Analytics"],
              ["weekly-report", "Weekly Report"],
              ["indexing", "Indexing"],
              ["pagespeed", "Page Speed"],
              ["reviews", "Reviews"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setSub("");
              }}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-6">
        {notice && (
          <div className="mb-4 flex items-center justify-between rounded-lg border bg-surface p-3 text-sm">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-muted">
              ✕
            </button>
          </div>
        )}

        {needsReconnect ? (
          <GoogleReconnectBanner detail="Google stopped accepting this app's Search Console access — sign in again to reconnect Performance, Opportunities, and Indexing." />
        ) : !project ? (
          projectsLoaded && (
            <div className="mx-auto max-w-lg rounded-2xl border bg-surface p-8 text-center">
              <h2 className="text-lg font-semibold">Create your first project</h2>
              <p className="mt-2 text-sm text-muted">
                A project groups one brand&apos;s website with its Search Console and Google
                Analytics properties, so every tab shows that brand&apos;s data together.
              </p>
              <button
                onClick={() => setProjectView("new")}
                className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
              >
                New project
              </button>
            </div>
          )
        ) : GSC_TABS.includes(tab) && !property ? (
          <MissingAsset
            asset="Search Console property"
            project={project.name}
            onEdit={() => setProjectView(project.id)}
          />
        ) : GA_TABS.includes(tab) && !gaPropertyId ? (
          <MissingAsset
            asset="Google Analytics (GA4) property"
            project={project.name}
            onEdit={() => setProjectView(project.id)}
          />
        ) : tab === "reviews" && !(project.mapsUrl && project.hasSerpKey) ? (
          <MissingAsset
            asset="Google Maps link and SerpApi key"
            project={project.name}
            onEdit={() => setProjectView(project.id)}
          />
        ) : (
          <>
            {tab === "reviews" && (
              <Reviews
                key={`${project.id}:${project.mapsUrl}`}
                projectId={project.id}
                projectName={project.name}
                onEditProject={() => setProjectView(project.id)}
              />
            )}
            {tab === "indexing" && (
              <Indexing property={property} neverSynced={!currentSite?.lastSync?.finished_at} />
            )}
            {tab === "analytics" && <Analytics key={gaPropertyId} fixedPropertyId={gaPropertyId} sub={sub} onSub={setSub} />}
            {tab === "weekly-report" && <WeeklyReport key={gaPropertyId} fixedPropertyId={gaPropertyId} sub={sub} onSub={setSub} />}
            {tab === "opportunities" && (
              <Opportunities property={property} searchType={searchType} sub={sub} onSub={setSub} />
            )}
            {tab === "pagespeed" && (
              <PageSpeed key={project.id} projectId={project.id} websiteUrl={project.websiteUrl} />
            )}
          </>
        )}

        {/* Performance stays mounted while other tabs are open, so its range,
            filters and loaded data survive a tab switch as before. */}
        {!needsReconnect && property && (
          <div hidden={tab !== "performance"}>
            <PerformanceView
              property={property}
              searchType={searchType}
              onNeedsReconnect={() => setNeedsReconnect(true)}
              onNotice={setNotice}
            />
          </div>
        )}
      </main>

      {projectView != null && (
        <ProjectManager
          projects={projects}
          sites={sites.filter((s) => s.source === "google")}
          initialView={projectView}
          onClose={() => setProjectView(null)}
          onChanged={loadProjects}
        />
      )}

      {showSettings && (
        <SettingsPanel
          property={property}
          bingConnected={bingConnected}
          onClose={() => setShowSettings(false)}
          onChanged={loadSites}
        />
      )}
    </div>
  );
}
