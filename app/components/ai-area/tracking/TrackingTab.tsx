"use client";

// Google Search Tracking, ported from the AI Brand Mention app (src/components/tracking/TrackingTab.tsx).
// Changes for SEO Console:
// - Works on the SEO Console project that's open (no separate project list, create or delete).
// - The view is part of the address (/p/<id>/ai-area/google-search-tracking/<view>), via `sub` / `onSub`.
// - Data comes from /api/ai-area/<id>/tracking (Postgres, owner-only); no generated data when a key is missing.
// - "Run now" shows the estimated SerpApi requests and the remaining allowance first, then runs in chunks.
// - The same data serves Rank tracking → Google (initial view "rank"), so there's one set of runs and charges.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SURFACE_LABEL,
  buildSubjects,
  collectDates,
  computeDomainRows,
  computeSubjectSeries,
  computeSurfaceSplit,
  createHitLookup,
  domainMatchesWebsite,
  filterByRange,
  guessSiteName,
  summarizeSeries,
  type AiSurface,
  type SurfaceFilter,
} from "@/lib/ai-area/tracking/analytics";
import type { KeywordHistory, TrackingConfig } from "@/lib/ai-area/tracking/types";
import type { TrackingEstimate } from "@/lib/ai-area/tracking/job";
import type { UsageReport } from "@/lib/providers/usageReport";
import { isGoogleHost } from "@/lib/ai-area/tracking/visibility";
import { SerpUsageBadge } from "./SerpUsageBadge";
import { SerpReadinessPanel } from "./SerpReadinessPanel";
import type { SerpReadiness } from "@/lib/providers/serpReadiness";
import { Favicon } from "./Favicon";
import { MentionsView } from "./MentionsView";
import { OverviewView } from "./OverviewView";
import { RankTrackerView } from "./RankTrackerView";
import { ResponsesView } from "./ResponsesView";
import { SettingsView } from "./SettingsView";
import { EmptyState, IconCalendar, IconLayers, SelectControl } from "./ui";

type View = "overview" | "rank" | "mentions" | "responses" | "settings";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "rank", label: "Rank tracker" },
  { id: "mentions", label: "Mentions & Citations" },
  { id: "responses", label: "AI responses" },
  { id: "settings", label: "Settings" },
];

/** Readable slugs for the address. */
const VIEW_SLUG: Record<View, string> = {
  overview: "overview",
  rank: "rank-tracker",
  mentions: "mentions",
  responses: "ai-responses",
  settings: "settings",
};
const VIEW_BY_SLUG: Record<string, View> = Object.fromEntries(Object.entries(VIEW_SLUG).map(([v, slug]) => [slug, v as View]));

type Range = "7" | "30" | "90" | "all";

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const SURFACE_OPTIONS: Array<{ value: SurfaceFilter; label: string }> = [
  { value: "all", label: "All surfaces" },
  { value: "organic", label: SURFACE_LABEL.organic },
  { value: "aiOverview", label: SURFACE_LABEL.aiOverview },
  { value: "aiMode", label: SURFACE_LABEL.aiMode },
];

function sinceFor(range: Range): string | null {
  if (range === "all") return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (Number(range) - 1));
  return d.toISOString().slice(0, 10);
}

interface RunRow {
  id: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  actual: { searchesSent?: number; done?: string[]; plan?: string[]; stoppedReason?: string } | null;
  error: string | null;
}

interface Loaded {
  config: TrackingConfig;
  histories: KeywordHistory[];
  runs: RunRow[];
  estimate: TrackingEstimate;
}

export function TrackingTab({
  projectId,
  sub,
  onSub,
  defaultView = "overview",
  onOpenCredentials,
  onOpenBudgets,
}: {
  projectId: number;
  sub?: string;
  onSub?: (sub: string) => void;
  defaultView?: View;
  onOpenCredentials?: () => void;
  onOpenBudgets?: () => void;
}) {
  const view: View = VIEW_BY_SLUG[sub ?? ""] ?? defaultView;
  const setView = (v: View) => onSub?.(v === defaultView ? "" : VIEW_SLUG[v]);
  const [range, setRange] = useState<Range>("30");
  const [surface, setSurface] = useState<SurfaceFilter>("all");
  const [compare, setCompare] = useState(true);
  const [data, setData] = useState<{ key: string; value: Loaded } | null>(null);
  const [draft, setDraft] = useState<TrackingConfig | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [readiness, setReadiness] = useState<SerpReadiness | null>(null);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loadKey = `${projectId}|${range}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    const since = sinceFor(range);
    Promise.all([
      fetch(`/api/ai-area/${projectId}/tracking${since ? `?since=${since}` : ""}`, { cache: "no-store" }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `Couldn't load tracking data (status ${r.status})`);
        return body as Loaded;
      }),
      fetch(`/api/account/usage?days=30&project=${projectId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      // Whether this project may search right now, and why not (per project: Preview policy, limits, key).
      fetch(`/api/ai-area/${projectId}/serp-status`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([value, u, ready]) => {
        if (cancelled) return;
        setData({ key: loadKey, value });
        setDraft(null);
        setUsage(u?.report ?? null);
        setReadiness((ready as SerpReadiness | null) ?? null);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [projectId, range, loadKey]);

  const loaded = data?.key === loadKey ? data.value : null;
  const config = draft ?? loaded?.config ?? null;
  const histories = useMemo(() => loaded?.histories ?? [], [loaded]);

  const saveConfig = useCallback(
    async (next: TrackingConfig) => {
      setError(null);
      setDraft(next);
      try {
        const res = await fetch(`/api/ai-area/${projectId}/tracking`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Failed to save settings (status ${res.status})`);
        setNonce((n) => n + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save settings");
      }
    },
    [projectId],
  );

  const runNow = useCallback(async () => {
    setConfirming(false);
    setRunning(true);
    setError(null);
    setStatusMessage("Running tracking for this project's active keywords…");
    try {
      let runId: string | null = null;
      for (let i = 0; i < 100; i++) {
        const res = await fetch(`/api/ai-area/${projectId}/tracking/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(runId ? { runId } : {}),
        });
        const body = (await res.json().catch(() => ({}))) as {
          runId?: string;
          finished?: boolean;
          status?: string;
          error?: string | null;
          actual?: { searchesSent: number; done: string[]; plan: string[]; failedKeywords: number };
        };
        if (!res.ok) throw new Error(body.error || `Run failed (status ${res.status})`);
        runId = body.runId ?? runId;
        const a = body.actual;
        if (a) setStatusMessage(`Running… ${a.done.length} of ${a.plan.length} keywords · ${a.searchesSent} SerpApi requests sent`);
        if (body.status === "busy") await new Promise((r) => setTimeout(r, 3000));
        if (body.finished) {
          const failed = a?.failedKeywords ?? 0;
          setStatusMessage(
            body.status === "stopped"
              ? `Stopped: ${body.error}. ${a?.done.length ?? 0} of ${a?.plan.length ?? 0} keywords stored · ${a?.searchesSent ?? 0} SerpApi requests sent.`
              : `Done · ${a?.searchesSent ?? 0} SerpApi requests sent${failed > 0 ? ` · ${failed} keyword(s) failed` : ""}`,
          );
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
      setStatusMessage(null);
    } finally {
      setRunning(false);
      setNonce((n) => n + 1);
    }
  }, [projectId]);

  const subjects = useMemo(() => (config ? buildSubjects(config.brand, config.competitors) : []), [config]);
  const hits = useMemo(() => createHitLookup(subjects), [subjects]);
  const ranged = useMemo(() => filterByRange(histories, range === "all" ? null : Number(range)), [histories, range]);
  const { dates, series } = useMemo(() => computeSubjectSeries(ranged, subjects, hits, surface), [ranged, subjects, hits, surface]);
  const summaries = useMemo(() => summarizeSeries(series), [series]);
  const surfaceSplit = useMemo(() => (surface === "all" && subjects.length > 0 ? computeSurfaceSplit(ranged, hits) : null), [surface, ranged, hits, subjects]);
  const domains = useMemo(() => (config ? computeDomainRows(ranged, subjects, config.excludedDomains, surface) : []), [ranged, subjects, config, surface]);
  const allDomains = useMemo(() => (config ? computeDomainRows(histories, subjects, config.excludedDomains, "all") : []), [histories, subjects, config]);
  const aiSurfaces: AiSurface[] = surface === "all" ? ["aiOverview", "aiMode"] : surface === "organic" ? [] : [surface];

  if (!config || !loaded) {
    return error ? (
      <EmptyState title="Couldn't load tracking data" body={error} />
    ) : (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading tracking data…
      </p>
    );
  }

  const localeLabel = `${config.settings.language} · ${config.settings.country} · ${config.settings.device}`;
  const periodLabel = `Showing ${dates.length} tracked day${dates.length === 1 ? "" : "s"}`;
  const allDates = collectDates(histories);
  const hasData = allDates.length > 0;
  const needsSetup = config.keywords.length === 0 || !config.brand.name.trim();
  const account = usage?.serpapi.account.data ?? null;
  const searchesLeft = account?.totalSearchesLeft ?? account?.planSearchesLeft ?? null;
  // Per-project permission (Preview smoke test, project and account limits, key), not the account-wide summary.
  const canRun = readiness?.execution.allowed ?? false;
  const limitLines = readiness?.limits ?? [];
  const allowanceLeft = limitLines.length ? Math.min(...limitLines.map((l) => l.left)) : null;
  const est = loaded.estimate;
  const lastRun = loaded.runs[0];

  const excludeDomain = (domain: string) => {
    if (config.excludedDomains.includes(domain)) return;
    saveConfig({ ...config, excludedDomains: [...config.excludedDomains, domain] });
  };
  const unexcludeDomain = (domain: string) => saveConfig({ ...config, excludedDomains: config.excludedDomains.filter((d) => d !== domain) });
  const trackDomain = (domain: string) => {
    if (subjects.some((s) => domainMatchesWebsite(domain, s.website))) return;
    const name = allDomains.find((r) => r.domain === domain)?.siteName ?? guessSiteName(domain, []);
    saveConfig({
      ...config,
      competitors: [...config.competitors.filter((c) => c.name.trim() || c.website.trim()), { id: crypto.randomUUID(), name, aliases: [], website: domain }],
    });
    setStatusMessage(`Now tracking ${name} (${domain}) as a competitor - rename it or add aliases in Settings.`);
  };

  const runButton = (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      disabled={running || !canRun}
      title={readiness && !readiness.execution.allowed ? (readiness.execution.reason ?? undefined) : undefined}
      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      style={{ background: "var(--series-1)" }}
    >
      {running ? "Running…" : "Run now"}
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Google rankings, AI Overview and AI Mode visibility
          {allDates.length > 0 ? ` · last run ${allDates[allDates.length - 1]}` : ""} · runs only when you click Run now
        </p>
        <div className="flex items-center gap-2">
          <SerpUsageBadge account={account} unavailable={usage?.serpapi.account.message} />
          {runButton}
        </div>
      </header>

      {confirming && (
        <div role="dialog" aria-label="Confirm run" className="rounded-lg border p-4 text-sm" style={{ borderColor: "var(--series-1)", background: "var(--surface-1)" }}>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            Run tracking for {est.keywords} active keyword{est.keywords === 1 ? "" : "s"}?
          </p>
          <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
            Estimated SerpApi requests: {est.total.min}–{est.total.max} (usually about {est.total.typical}): per keyword {est.perKeyword.min}–{est.perKeyword.max} (
            {est.depth / 10} result page{est.depth === 10 ? "" : "s"}, AI Mode, the AI Overview when Google shows one, and a retry when page 1 looks unrelated).
          </p>
          {limitLines.length > 0 && (
            <p className="mt-1" style={{ color: allowanceLeft != null && allowanceLeft < est.total.max ? "var(--status-critical)" : "var(--text-secondary)" }}>
              {limitLines.map((l) => `${l.label}: ${l.left} left`).join("; ")}.
              {allowanceLeft != null && allowanceLeft < est.total.max ? " The run stops when the allowance runs out; what's fetched by then is kept." : ""}
            </p>
          )}
          {searchesLeft != null && (
            <p className="mt-1" style={{ color: "var(--text-muted)" }}>
              SerpApi account balance: {searchesLeft.toLocaleString("en-US")} searches (account-wide).
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={runNow} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--series-1)" }}>
              Run now
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--border-hairline)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <SerpReadinessPanel readiness={readiness} onOpenCredentials={onOpenCredentials} onOpenBudgets={onOpenBudgets} />
      {error ? (
        <div className="rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }} role="alert">
          {error}
        </div>
      ) : null}
      {statusMessage ? (
        <div className="rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }} role="status">
          {statusMessage}
        </div>
      ) : lastRun && lastRun.status !== "done" ? (
        <div className="rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }} role="status">
          Last run {new Date(lastRun.startedAt).toLocaleString("en-GB")}: {lastRun.status}
          {lastRun.error ? ` - ${lastRun.error}` : ""} · {lastRun.actual?.searchesSent ?? 0} SerpApi requests sent.
        </div>
      ) : null}

      <nav className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--gridline)" }} aria-label="Tracking views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            aria-current={view === v.id ? "page" : undefined}
            className="-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium"
            style={{
              borderColor: view === v.id ? "var(--text-primary)" : "transparent",
              color: view === v.id ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {view !== "settings" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setView("settings")}
            className="flex items-center gap-2 rounded-lg border py-1.5 pl-2 pr-3 text-xs font-semibold"
            style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            title="Edit brand in Settings"
          >
            <Favicon domain={config.brand.website} label={config.brand.name} size={16} />
            {config.brand.name || "Set your brand"}
          </button>
          <SelectControl ariaLabel="Date range" icon={<IconCalendar />} value={range} onChange={setRange} options={RANGE_OPTIONS} />
          {view !== "rank" ? <SelectControl ariaLabel="Search surface" icon={<IconLayers />} value={surface} onChange={setSurface} options={SURFACE_OPTIONS} /> : null}
          <button
            type="button"
            onClick={() => setView("settings")}
            className="rounded-lg border px-2.5 py-1.5 text-xs uppercase"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", background: "var(--surface-1)" }}
            title="Search settings"
          >
            {localeLabel}
          </button>
          <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
            {subjects.length - 1} competitor{subjects.length - 1 === 1 ? "" : "s"} · {config.keywords.filter((k) => k.active).length} keywords
          </span>
        </div>
      ) : null}

      {view === "settings" ? (
        <SettingsView
          config={config}
          onDraftChange={(c) => setDraft(c)}
          onSave={saveConfig}
          suggestions={allDomains.filter((r) => !r.owner && !isGoogleHost(r.domain))}
          onTrack={trackDomain}
          onExclude={excludeDomain}
          searchesLeft={searchesLeft}
        />
      ) : needsSetup && !hasData ? (
        <EmptyState
          title="Set up tracking"
          body="Add your brand, the competitors you want to compare against, and the keywords to track. Then run tracking once to start building history."
          action={
            <button
              type="button"
              onClick={() => setView("settings")}
              className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: "var(--series-1)" }}
            >
              Open settings
            </button>
          }
        />
      ) : !hasData ? (
        <EmptyState title="No tracking data yet" body="Tracking runs only when you click Run now. Run it to capture today's results." action={<div className="mt-2">{runButton}</div>} />
      ) : view === "overview" ? (
        <OverviewView
          dates={dates}
          series={series}
          summaries={summaries}
          surfaceSplit={surfaceSplit}
          compare={compare}
          onCompareChange={setCompare}
          periodLabel={periodLabel}
        />
      ) : view === "rank" ? (
        <RankTrackerView histories={ranged} subjects={subjects} hits={hits} localeLabel={localeLabel} onTrack={trackDomain} />
      ) : view === "mentions" ? (
        <MentionsView
          dates={dates}
          series={series}
          domainRows={domains}
          compare={compare}
          onCompareChange={setCompare}
          onExclude={excludeDomain}
          onUnexclude={unexcludeDomain}
          excludedDomains={config.excludedDomains}
          onTrack={trackDomain}
          periodLabel={periodLabel}
          surfaceLabel={SURFACE_OPTIONS.find((o) => o.value === surface)?.label ?? "All surfaces"}
        />
      ) : (
        <ResponsesView histories={ranged} dates={dates} subjects={subjects} hits={hits} surfaces={aiSurfaces} localeLabel={localeLabel} onTrack={trackDomain} />
      )}
    </div>
  );
}
