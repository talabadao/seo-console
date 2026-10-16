"use client";

// Project settings, in sections addressed as /p/<id>/settings/project/<section>.
// Reuses the existing editors: the project form (ProjectManager), the console
// settings panel (brand terms, AI sources, indexing automation, Asana/Bing
// keys) and the monthly KPI config API. Infrastructure secrets — database
// URLs, OAuth client secrets, the session key — stay in the server
// environment and are never editable here.

import { useEffect, useState, type ReactNode } from "react";
import type { Project } from "../ProjectManager";
import { Favicon } from "../ProjectManager";
import { hostOf } from "@/lib/projectMatch";
import { NAV, meetsRequirement, type ShellLocation } from "@/lib/v2/nav";
import { Card, buttonClass, primaryButtonClass } from "./ui";
import { LeadEventsEditor } from "../LeadEventsEditor";
import { BudgetLimits } from "./BudgetLimits";
import { useUsage } from "./UsageCosts";
import { KpiPlanner } from "./KpiPlanner";

export const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "integrations", label: "Integrations" },
  { id: "kpi", label: "KPI planning" },
  { id: "analytics", label: "Analytics / Key events" },
  { id: "tracking", label: "Tracking" },
  { id: "budgets", label: "Usage & budgets" },
  { id: "sync", label: "Sync and history" },
] as const;
type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

interface SiteMeta {
  property: string;
  source: string;
  lastSync: { status: string; finished_at: number | null } | null;
}

export function ProjectSettings({
  project,
  sub,
  sites,
  onSub,
  onNavigate,
  onEditProject,
  onOpenConsoleSettings,
  onProjectChanged,
}: {
  project: Project;
  sub: string;
  sites: SiteMeta[];
  onSub: (sub: string) => void;
  onNavigate: (l: ShellLocation) => void;
  onEditProject: (id: number) => void;
  onOpenConsoleSettings: () => void;
  onProjectChanged: () => void | Promise<void>;
}) {
  const section: SectionId = SETTINGS_SECTIONS.some((s) => s.id === sub) ? (sub as SectionId) : "general";
  const edit = (
    <button className={buttonClass} onClick={() => onEditProject(project.id)}>
      Edit project
    </button>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
      <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:flex-col">
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => onSub(s.id === "general" ? "" : s.id)}
            aria-current={section === s.id ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm ${section === s.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-accent-soft/50 hover:text-foreground"}`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 space-y-4">
        {section === "general" && (
          <Card title="General" actions={edit}>
            <div className="flex items-center gap-3">
              <Favicon src={project.faviconUrl} name={project.name} size={40} />
              <div className="min-w-0">
                <p className="font-medium">{project.name}</p>
                <p className="text-sm text-muted">{project.websiteUrl ? hostOf(project.websiteUrl) : "No website set"}</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted">
              Only this account can see this project. Signing in is limited to approved Google accounts, and being approved gives no access to
              another account&apos;s projects.
            </p>
          </Card>
        )}

        {section === "integrations" && <Integrations project={project} edit={edit} onNavigate={onNavigate} onProjectChanged={onProjectChanged} />}

        {section === "kpi" && (
          <KpiPlanner
            key={project.id}
            projectId={project.id}
            hasGa={Boolean(project.gaPropertyId)}
            leadEvents={null}
            onLink={() => onEditProject(project.id)}
            onLeadEvents={() => onSub("analytics")}
          />
        )}

        {section === "analytics" && (
          <Card title="Analytics / Key events">
            {project.gaPropertyId ? (
              <LeadEventsEditor projectId={project.id} />
            ) : (
              <>
                <p className="text-sm text-muted">Lead events are chosen from the project&apos;s GA4 events. Link a GA4 property first.</p>
                <button className={`mt-3 ${primaryButtonClass}`} onClick={() => onEditProject(project.id)}>
                  Link GA4
                </button>
              </>
            )}
          </Card>
        )}

        {section === "tracking" && (
          <Card
            title="Tracking"
            actions={
              <button className={buttonClass} onClick={onOpenConsoleSettings}>
                Open tracking &amp; connections
              </button>
            }
          >
            <ul className="space-y-2 text-sm">
              <Row label="Brand terms" body="Which search queries count as branded, for the Search Console filters." />
              <Row label="Long-tail and AI-prompt rules" body="Word count and position thresholds for the query filters." />
              <Row label="AI search sources" body="Referrer domains counted as AI search instead of Organic in GA4." />
              <Row label="Indexing automation" body="Daily URL inspection for this property: on or off, hour and daily cap." />
            </ul>
          </Card>
        )}

        {section === "budgets" && <Budgets project={project} onNavigate={onNavigate} />}

        {section === "sync" && <SyncHistory project={project} sites={sites} />}

        <p className="text-xs text-muted">
          Database connections, Google OAuth credentials and the session key are server environment settings. They aren&apos;t stored in or
          editable from project settings.
        </p>
      </div>
    </div>
  );
}

/** Whether a connection is set up. Says nothing about data freshness, so it never reads "Live". */
function ConnectionBadge({ on }: { on: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? "var(--good)" : "var(--bad)" }} aria-hidden="true" />
      {on ? "Connected" : "Not connected"}
    </span>
  );
}

function Row({ label, body, right }: { label: string; body: ReactNode; right?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="w-48 shrink-0 font-medium">{label}</span>
      <span className="min-w-0 flex-1 text-muted">{body}</span>
      {right}
    </li>
  );
}

function Integrations({
  project,
  edit,
  onNavigate,
  onProjectChanged,
}: {
  project: Project;
  edit: ReactNode;
  onNavigate: (l: ShellLocation) => void;
  onProjectChanged: () => void | Promise<void>;
}) {
  const connections = [
    { label: "Google Search Console", detail: project.gscProperty, on: Boolean(project.gscProperty) },
    { label: "Google Analytics 4", detail: project.gaPropertyId ? `Property ${project.gaPropertyId}` : null, on: Boolean(project.gaPropertyId) },
    {
      // The Maps link is a project field; the SerpApi key is a separate credential, shown below.
      label: "Google Maps link",
      detail: project.gbpLocationTitle ?? (project.mapsUrl || null),
      on: Boolean(project.mapsUrl),
    },
    { label: "Asana", detail: project.asanaProjectName || project.asanaProjectGid || null, on: Boolean(project.asanaProjectGid) },
  ];
  const pages = NAV.flatMap((g) => g.items.filter((i) => i.status === "live" && i.requires).map((i) => ({ g, i })));
  return (
    <>
      <Card title="Connections and property mappings" actions={edit}>
        <ul className="divide-y">
          {connections.map((c) => (
            <li key={c.label} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="w-48 font-medium">{c.label}</span>
              <ConnectionBadge on={c.on} />
              <span className="min-w-0 flex-1 truncate text-muted">{c.detail ?? "—"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          API keys, the Asana token and the Bing key belong to your account, not the project.{" "}
          <button className="text-accent hover:underline" onClick={() => onNavigate({ kind: "project", projectId: project.id, group: "settings", item: "account", sub: "" })}>
            Account settings
          </button>
        </p>
      </Card>
      <SerpApiKeyCard project={project} onProjectChanged={onProjectChanged} onNavigate={onNavigate} />
      <SeRankingCard project={project} />
      <Card title="Pages that need a connection">
        <ul className="grid gap-2 sm:grid-cols-2">
          {pages.map(({ g, i }) => {
            const ok = meetsRequirement(i.requires, project);
            const target: ShellLocation = { kind: "project", projectId: project.id, group: g.id, item: i.id, sub: "" };
            return (
              <li key={`${g.id}/${i.id}`}>
                <button
                  onClick={() => onNavigate(target)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm hover:border-accent"
                >
                  <span>
                    <span className="block font-medium">{i.label}</span>
                    <span className="block text-xs text-muted">{g.label}</span>
                  </span>
                  <ConnectionBadge on={ok} />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

/**
 * Which SerpApi key this project uses. Keys are saved once per account (Settings → Account → API credentials);
 * a legacy key stored on the project still applies until it's removed or adopted there. A free Check verifies
 * the key that applies (SerpApi's account endpoint; no search spent).
 */
function SerpApiKeyCard({
  project,
  onProjectChanged,
  onNavigate,
}: {
  project: Project;
  onProjectChanged: () => void | Promise<void>;
  onNavigate: (l: ShellLocation) => void;
}) {
  const [busy, setBusy] = useState<null | "check" | "clear">(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const accountHref: ShellLocation = { kind: "project", projectId: project.id, group: "settings", item: "account", sub: "" };
  const updated = project.serpKeyUpdatedAt
    ? ` · updated ${new Date(project.serpKeyUpdatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
    : "";
  async function check() {
    setBusy("check");
    const res = await fetch(`/api/projects/${project.id}/serpapi-key`, { method: "POST" });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: { totalSearchesLeft: number | null } };
    setResult(
      !res.ok || j.ok === false
        ? { ok: false, message: j.error ?? `Check failed (status ${res.status}).` }
        : { ok: true, message: j.account?.totalSearchesLeft == null ? "SerpApi accepted the key." : `SerpApi accepted the key; ${j.account.totalSearchesLeft.toLocaleString("en-US")} searches left on that account.` },
    );
    setBusy(null);
  }
  async function clear() {
    setBusy("clear");
    const res = await fetch(`/api/projects/${project.id}/serpapi-key`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) await onProjectChanged();
    else setResult({ ok: false, message: "Couldn't remove the project key." });
  }
  return (
    <Card title="SerpApi key">
      <ul className="space-y-2 text-sm">
        <Row
          label="Key that applies"
          body={
            project.serpKeySource === "account"
              ? `Your account's SerpApi key ••••${project.serpKeyLast4 ?? ""}${updated}`
              : project.serpKeySource === "project-legacy"
                ? `A legacy key stored on this project ••••${project.serpKeyLast4 ?? ""}${updated}. It keeps working until you remove it or move it to your account.`
                : project.serpKeySource === "server-legacy"
                  ? "The server's SerpApi key (legacy, allowed for this account)."
                  : "None. Add a SerpApi key for your account."
          }
          right={<ConnectionBadge on={project.hasSerpKey} />}
        />
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={buttonClass} onClick={() => onNavigate(accountHref)}>
          Manage in Account → API credentials
        </button>
        {project.hasSerpKey && (
          <button className={buttonClass} onClick={check} disabled={busy !== null} title="Reads your SerpApi account (free; no search is used)">
            {busy === "check" ? "Checking…" : "Check connection"}
          </button>
        )}
        {project.serpKeySource === "project-legacy" && (
          <button className="text-sm text-muted hover:text-bad" onClick={clear} disabled={busy !== null}>
            {busy === "clear" ? "Removing…" : "Remove project key (use account key)"}
          </button>
        )}
      </div>
      {result && (
        <p role="status" className="mt-2 text-xs" style={{ color: result.ok ? "var(--good)" : "var(--bad)" }}>
          {result.ok ? "Verified: " : "Check failed: "}
          {result.message}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">Used for Maps reviews, Google Search Tracking, Rank tracking → Google and Brand Mentions.</p>
    </Card>
  );
}

function SeRankingCard({ project }: { project: Project }) {
  type Loaded = { configured: boolean; sites?: { id: number; title: string; url: string; keywordCount: number }[]; chosen?: number | null; matched?: number | null; error?: string };
  const [data, setData] = useState<{ id: number; value: Loaded } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${project.id}/seranking`)
      .then((r) => r.json())
      .then((value: Loaded) => live && setData({ id: project.id, value }))
      .catch((e) => live && setData({ id: project.id, value: { configured: true, error: e instanceof Error ? e.message : String(e) } }));
    return () => {
      live = false;
    };
  }, [project.id, nonce]);
  const v = data?.id === project.id ? data.value : null;
  async function choose(siteId: number | null) {
    setSaving("Saving…");
    const res = await fetch(`/api/projects/${project.id}/seranking`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(res.ok ? "Saved." : (body.error ?? "Couldn't save."));
    setNonce((n) => n + 1);
  }
  const effective = v?.chosen ?? v?.matched ?? null;
  return (
    <Card title="SE Ranking project">
      {!v ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !v.configured ? (
        <p className="text-sm text-muted">
          SE Ranking isn&apos;t connected to SEO Console: the server has no SE Ranking API key. Keyword rankings show as unavailable until one is
          added to the server environment.
        </p>
      ) : v.error ? (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {v.error}
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-muted">
            Keyword rankings on the dashboards come from this SE Ranking project&apos;s tracked keywords.{" "}
            {v.chosen ? "Chosen by hand." : v.matched ? "Matched by website." : "No project matches the website."}
          </p>
          <select
            value={effective ?? ""}
            onChange={(e) => choose(e.target.value ? Number(e.target.value) : null)}
            className="w-full rounded-md border bg-background px-2 py-1.5"
            aria-label="SE Ranking project"
          >
            <option value="">Match by website{v.matched ? "" : " (no match)"}</option>
            {v.sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.url}, {s.keywordCount} keywords)
              </option>
            ))}
          </select>
          {saving && <p className="text-xs text-muted">{saving}</p>}
        </div>
      )}
    </Card>
  );
}

/**
 * Project-scoped usage and limits, from the same services as Settings → Account (one budget form, one report):
 * this project's limits are editable here; account-wide limits are shown and edited in Account settings.
 */
function Budgets({ project, onNavigate }: { project: Project; onNavigate: (l: ShellLocation) => void }) {
  const account = (sub: string): ShellLocation => ({ kind: "project", projectId: project.id, group: "settings", item: "account", sub });
  const usage = useUsage(project.id, 30);
  const r = usage?.report;
  return (
    <>
      <Card
        title="Usage, last 30 days (recorded)"
        actions={
          <button className={buttonClass} onClick={() => onNavigate(account("usage"))}>
            Open Usage &amp; Costs
          </button>
        }
      >
        {!usage ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !r ? (
          <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
            {usage.error}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            <Row label="SerpApi requests" body={`${(r.serpapi.recorded?.requests ?? 0).toLocaleString("en-US")} sent for this project${r.serpapi.recorded?.failed ? ` (${r.serpapi.recorded.failed} failed)` : ""}.`} />
            <Row
              label="Model calls"
              body={`${((r.openai.recorded?.requests ?? 0) + (r.anthropic.recorded?.requests ?? 0)).toLocaleString("en-US")} calls, about $${((r.openai.recorded?.estCostUsd ?? 0) + (r.anthropic.recorded?.estCostUsd ?? 0)).toFixed(2)} estimated.`}
            />
          </ul>
        )}
      </Card>
      <BudgetLimits projectId={project.id} onOpenAccount={() => onNavigate(account("budgets"))} />
      <Card title="Other limits (fixed)">
        <ul className="space-y-2 text-sm">
          <Row label="Maps reviews (SerpApi)" body={`Fetched only when you ask; 1 SerpApi search per page of reviews. ${project.hasSerpKey ? "A SerpApi key applies to this project." : "No SerpApi key yet."}`} />
          <Row label="Review analysis (OpenAI)" body="Runs only when you ask, on reviews not analysed yet." />
          <Row label="PageSpeed Insights" body="Up to 15 tracked pages per project, checked once a day." />
          <Row label="URL inspection" body="Google allows 2,000 inspections per property per day; one manual run does up to 500." />
          <Row label="Indexing API" body="Submissions only for eligible pages (job postings and livestreams), within Google's daily quota." />
          <Row label="Preview deployments" body="Paid and external actions are switched off on Preview, except the capped SerpApi smoke test." />
        </ul>
      </Card>
    </>
  );
}

function SyncHistory({ project, sites }: { project: Project; sites: SiteMeta[] }) {
  const site = sites.find((s) => s.source === "google" && s.property === project.gscProperty);
  const last = site?.lastSync;
  const when = last?.finished_at ? new Date(last.finished_at).toLocaleString("en-GB") : null;
  const [auto, setAuto] = useState<{ autoIndexEnabled: boolean; autoIndexHour: number; autoIndexCap: number } | null | "error">(null);
  useEffect(() => {
    if (!project.gscProperty) return;
    fetch(`/api/settings/indexing?property=${encodeURIComponent(project.gscProperty)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setAuto)
      .catch(() => setAuto("error"));
  }, [project.gscProperty]);
  return (
    <Card title="Sync schedules and history">
      <ul className="space-y-2 text-sm">
        <Row
          label="Search Console history"
          body={
            project.gscProperty
              ? last
                ? `Last stored sync: ${last.status}${when ? `, ${when}` : ""}. Dashboards read Search Console live; stored history fills older views.`
                : "No stored sync yet. Dashboards read Search Console live."
              : "No Search Console property linked."
          }
        />
        <Row
          label="Daily URL inspection"
          body={
            !project.gscProperty
              ? "Needs a Search Console property."
              : auto === null
                ? "Loading…"
                : auto === "error"
                  ? "Couldn't load the schedule."
                  : auto.autoIndexEnabled
                    ? `On, daily at ${String(auto.autoIndexHour).padStart(2, "0")}:00 UTC, up to ${auto.autoIndexCap} URLs.`
                    : "Off. Turn it on in Tracking settings."
          }
        />
        <Row label="PageSpeed checks" body="Daily between 01:30 and 03:30 UTC for tracked pages, on Production only." />
        <Row label="Maps reviews" body="Only when you click Fetch on the Reviews page. No schedule." />
        <Row label="Asana, GA4 and Search Console summaries" body="Read when a dashboard opens and cached for 15 minutes. Use Refresh on the dashboard to fetch again." />
      </ul>
    </Card>
  );
}
