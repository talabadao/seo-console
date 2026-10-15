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

export const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "integrations", label: "Integrations" },
  { id: "kpi", label: "KPI targets" },
  { id: "analytics", label: "Analytics / Key events" },
  { id: "tracking", label: "Tracking" },
  { id: "budgets", label: "Budgets and limits" },
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
}: {
  project: Project;
  sub: string;
  sites: SiteMeta[];
  onSub: (sub: string) => void;
  onNavigate: (l: ShellLocation) => void;
  onEditProject: (id: number) => void;
  onOpenConsoleSettings: () => void;
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

        {section === "integrations" && <Integrations project={project} edit={edit} onNavigate={onNavigate} onOpenConsoleSettings={onOpenConsoleSettings} />}

        {section === "kpi" && <KpiTargets project={project} onLink={() => onEditProject(project.id)} onLeadEvents={() => onSub("analytics")} />}

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
                Open tracking settings
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

        {section === "budgets" && <Budgets project={project} />}

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
  onOpenConsoleSettings,
}: {
  project: Project;
  edit: ReactNode;
  onNavigate: (l: ShellLocation) => void;
  onOpenConsoleSettings: () => void;
}) {
  const connections = [
    { label: "Google Search Console", detail: project.gscProperty, on: Boolean(project.gscProperty) },
    { label: "Google Analytics 4", detail: project.gaPropertyId ? `Property ${project.gaPropertyId}` : null, on: Boolean(project.gaPropertyId) },
    {
      label: "Google Maps reviews",
      detail: project.gbpLocationTitle ?? (project.mapsUrl ? (project.hasSerpKey ? "Maps link and SerpApi key saved" : "Maps link saved; SerpApi key missing") : null),
      on: Boolean(project.mapsUrl && project.hasSerpKey),
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
          The Asana token and Bing key belong to your account, not the project.{" "}
          <button className="text-accent hover:underline" onClick={onOpenConsoleSettings}>
            Account keys
          </button>
        </p>
      </Card>
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

interface KpiConfig {
  yearMonth: string;
  trafficOrganicTarget: number;
  trafficAiTarget: number;
  leadOrganicTarget: number;
  leadAiTarget: number;
  leadEvents: string[];
  asanaProjectGid: string;
  asanaStatusTitle: string;
}

function monthOptions() {
  const now = new Date();
  return [0, 1].map((n) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1));
    return { id: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) };
  });
}

function KpiTargets({ project, onLink, onLeadEvents }: { project: Project; onLink: () => void; onLeadEvents: () => void }) {
  const months = monthOptions();
  const [month, setMonth] = useState(months[0].id);
  const pid = project.gaPropertyId;
  const loadKey = `${pid}|${month}`;
  // What was loaded, keyed by property and month; anything else is still loading.
  const [loadedFor, setLoadedFor] = useState<{ key: string; cfg: KpiConfig | null; error: string | null } | null>(null);
  const [edits, setEdits] = useState<{ key: string; cfg: KpiConfig } | null>(null);
  const [save, setSave] = useState<{ key: string; state: "saving" | "saved" | "error"; message?: string } | null>(null);

  useEffect(() => {
    if (!pid) return;
    let live = true;
    fetch(`/api/weekly-report/config?propertyId=${encodeURIComponent(pid)}&yearMonth=${month}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
        if (live) setLoadedFor({ key: loadKey, cfg: body as KpiConfig, error: null });
      })
      .catch((e) => live && setLoadedFor({ key: loadKey, cfg: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [pid, month, loadKey]);

  const current = loadedFor?.key === loadKey ? loadedFor : null;
  const cfg = edits?.key === loadKey ? edits.cfg : (current?.cfg ?? null);
  const setCfg = (next: KpiConfig) => setEdits({ key: loadKey, cfg: next });
  const saving = save?.key === loadKey ? save : null;
  const state = !current ? "loading" : current.error ? "error" : (saving?.state ?? "ready");
  const message = current?.error ?? saving?.message ?? null;

  if (!pid) {
    return (
      <Card title="KPI targets">
        <p className="text-sm text-muted">Monthly targets are measured in GA4. Link a GA4 property to this project first.</p>
        <button className={`mt-3 ${primaryButtonClass}`} onClick={onLink}>
          Link GA4
        </button>
      </Card>
    );
  }

  const field = (key: keyof Pick<KpiConfig, "trafficOrganicTarget" | "trafficAiTarget" | "leadOrganicTarget" | "leadAiTarget">, label: string, hint: string) => (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <span className="block text-xs text-muted">{hint}</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={cfg ? String(cfg[key] || "") : ""}
        placeholder="No target"
        onChange={(e) => cfg && setCfg({ ...cfg, [key]: Number(e.target.value) || 0 })}
        className="mt-1 w-full rounded-md border bg-background px-3 py-1.5"
      />
    </label>
  );

  async function saveTargets() {
    if (!cfg || !pid) return;
    setSave({ key: loadKey, state: "saving" });
    try {
      const res = await fetch("/api/weekly-report/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cfg, propertyId: pid, yearMonth: month }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setSave({ key: loadKey, state: "saved" });
    } catch (e) {
      setSave({ key: loadKey, state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <Card
      title="KPI targets"
      actions={
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="rounded-md border bg-background px-2 py-1.5 text-sm">
          {months.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      }
    >
      {state === "loading" ? (
        <p className="text-sm text-muted">Loading targets…</p>
      ) : state === "error" && !cfg ? (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          Couldn&apos;t load targets: {message}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("trafficOrganicTarget", "Organic sessions", "GA4 Organic Search sessions this month")}
            {field("leadOrganicTarget", "Organic leads", "Lead events from organic sessions")}
            {field("trafficAiTarget", "AI search sessions", "Sessions from AI search sources")}
            {field("leadAiTarget", "AI search leads", "Lead events from AI search sessions")}
          </div>
          <p className="mt-3 text-xs text-muted">
            Lead KPIs count these lead events: {cfg?.leadEvents.length ? cfg.leadEvents.join(", ") : "none chosen"}.{" "}
            <button className="text-accent hover:underline" onClick={onLeadEvents}>
              Change lead events
            </button>
            . Leave a field empty for no target; KPIs without a target aren&apos;t shown.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button className={primaryButtonClass} onClick={saveTargets} disabled={state === "saving"}>
              {state === "saving" ? "Saving…" : "Save targets"}
            </button>
            {state === "saved" && <span className="text-sm text-muted">Saved.</span>}
            {state === "error" && cfg && (
              <span role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
                {message}
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function Budgets({ project }: { project: Project }) {
  return (
    <Card title="Budgets and usage limits">
      <ul className="space-y-2 text-sm">
        <Row
          label="Maps reviews (SerpApi)"
          body={`Fetched only when you ask. 1 SerpApi credit per page of reviews. ${project.hasSerpKey ? "A key is saved for this project." : "No key saved."}`}
        />
        <Row label="Review analysis (OpenAI)" body="Runs only when you ask, on reviews not analysed yet." />
        <Row label="PageSpeed Insights" body="Up to 15 tracked pages per project, checked once a day." />
        <Row label="URL inspection" body="Google allows 2,000 inspections per property per day; one manual run does up to 500." />
        <Row label="Indexing API" body="Submissions only for eligible pages (job postings and livestreams), within Google's daily quota." />
        <Row label="Preview deployments" body="Paid and external actions are switched off on Preview." />
      </ul>
      <p className="mt-3 text-xs text-muted">These limits are fixed today; editable per-project budgets are planned.</p>
    </Card>
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
