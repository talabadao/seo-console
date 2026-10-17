"use client";

// SE Ranking sections ported from AI Brand Mention into their SEO Console destinations:
//   Competitors → Competitive research → Competitor overview      (CompetitorsSection)
//   Backlinks   → Link Building → Backlinks                        (BacklinksSection)
//   Site audit  → Technical SEO → Site audit                       (AuditSection)
// Each reads its own cached dataset for the open project (one SE Ranking site mapping, kept in Project settings);
// no second project picker. The donor sections render inside .ai-area (the donor's design tokens mapped to ours).
// Availability is explicit — demo, unconfigured, not mapped, unauthorized, pending, error, live (fresh/stale) —
// never zero results or generated data in live mode.

import { useEffect, useState, type ReactNode } from "react";
import type { SeSnapshot } from "@/lib/seranking/donor/types";
import type { DataApiEntitlement } from "@/lib/seranking/dataApi";
import { fmtTime } from "../v2/summaryUi";
import { EmptyState, ErrorState, LoadingState, buttonClass, primaryButtonClass } from "../v2/ui";
import { ProviderIcon } from "../v2/ProviderIcon";
import { AuditSection } from "./AuditSection";
import { BacklinksSection } from "./BacklinksSection";
import { CompetitorsSection } from "./CompetitorsSection";

type CacheInfo = { state: "fresh" | "stale"; fetchedAt: number | null; dataThrough: string | null; refreshing: boolean; lastError: string | null; cooldown?: boolean };
export type ModuleResponse<T> =
  | { state: "live"; data: { status: "ok"; site: { id: number; title: string; url: string } } & T; cache: CacheInfo; [k: string]: unknown }
  | { state: "demo" | "unconfigured" | "not-mapped" | "unauthorized" | "pending" | "error"; message: string; chosenMissing?: boolean; [k: string]: unknown };

/** Loads a module endpoint; polls while the first fetch runs on the server. `nonce` > 0 asks for a refresh. */
export function useModule<T>(url: string, nonce: number, refreshParam = true): { res: ModuleResponse<T> | null; error: string | null } {
  const [state, setState] = useState<{ key: string; res: ModuleResponse<T> | null; error: string | null }>({ key: "", res: null, error: null });
  const key = `${url}|${nonce}`;
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (refresh: boolean, polls: number) => {
      fetch(refresh && refreshParam ? `${url}${url.includes("?") ? "&" : "?"}refresh=1` : url, { cache: "no-store" })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok && body.state === undefined) throw new Error(body.error ?? `Request failed (${r.status})`);
          if (!live) return;
          if ((body.state === "pending" || body.cache?.refreshing) && polls < 40) {
            if (body.state !== "pending") setState({ key, res: body, error: null });
            timer = setTimeout(() => load(false, polls + 1), body.state === "pending" ? 3000 : 6000);
            return;
          }
          setState({ key, res: body, error: null });
        })
        .catch((e) => live && setState({ key, res: null, error: e instanceof Error ? e.message : String(e) }));
    };
    load(nonce > 0, 0);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [key, url, nonce, refreshParam]);
  return state.key === key ? { res: state.res, error: state.error } : { res: null, error: null };
}

export function snapOf(site: { id: number; title: string; url: string }, part: Partial<SeSnapshot>, syncedAt: number | null): SeSnapshot {
  return {
    version: 1,
    siteId: site.id,
    siteTitle: site.title,
    siteUrl: site.url,
    guestLink: null,
    syncedAt: new Date(syncedAt ?? Date.now()).toISOString(),
    mock: false,
    errors: {},
    summary: null,
    engines: [],
    history: {},
    keywords: [],
    competitors: [],
    competition: null,
    rivals: [],
    audit: null,
    backlinks: null,
    linkProfile: null,
    ai: null,
    visible: null,
    ...part,
  };
}

/** Non-data states, shared by every SE Ranking module. Returns null for live data. */
export function ModuleStates({ res, error, what, demo, onOpenIntegrations, onRetry }: { res: ModuleResponse<unknown> | null; error: string | null; what: string; demo: ReactNode; onOpenIntegrations: () => void; onRetry: () => void }) {
  if (error) return <ErrorState title={`Couldn't load ${what}.`} body={error} action={<button className={buttonClass} onClick={onRetry}>Try again</button>} />;
  if (!res) return <LoadingState label={`Loading ${what}…`} rows={6} />;
  switch (res.state) {
    case "live":
      return null;
    case "demo":
      return <>{demo}</>;
    case "pending":
      return (
        <>
          <p className="text-sm text-muted">{res.message}</p>
          <LoadingState label={res.message} rows={6} />
        </>
      );
    case "unconfigured":
      return <EmptyState title="SE Ranking isn't connected." body={`${res.message} Ask the administrator to add the SE Ranking API key to the server.`} />;
    case "unauthorized":
      return <ErrorState title="SE Ranking refused access." body={`${res.message} Saved data is hidden until access works again.`} />;
    case "not-mapped":
      return (
        <EmptyState
          title={res.chosenMissing ? "The chosen SE Ranking project is gone." : "No SE Ranking project is mapped."}
          body={res.message}
          action={
            <button className={primaryButtonClass} onClick={onOpenIntegrations}>
              Choose SE Ranking project
            </button>
          }
        />
      );
    default:
      return <ErrorState title={`Couldn't load ${what}.`} body={res.message} action={<button className={buttonClass} onClick={onRetry}>Try again</button>} />;
  }
}

function SourceBar({ site, cache, onRefresh, refreshLabel, refreshNote }: { site: { title: string; url: string }; cache: CacheInfo; onRefresh?: () => void; refreshLabel: string; refreshNote: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <ProviderIcon id="se-ranking" size={20} />
      <span>
        Source: SE Ranking · {site.title !== site.url ? `${site.title} · ` : ""}
        {site.url}
        {cache.fetchedAt ? ` · saved ${fmtTime(cache.fetchedAt)}` : ""}
        {cache.dataThrough ? ` · data through ${cache.dataThrough}` : ""}
      </span>
      {cache.state === "stale" && <span className="rounded-full border px-1.5 text-[11px]">Stale{cache.refreshing ? ", refreshing" : ""}</span>}
      {cache.cooldown && <span>Refreshed less than 5 minutes ago; showing the saved data.</span>}
      {cache.lastError && <span style={{ color: "var(--bad)" }}>Last refresh failed: {cache.lastError}</span>}
      {onRefresh && (
        <button className={`${buttonClass} ml-auto`} onClick={onRefresh} disabled={cache.refreshing} title={refreshNote}>
          {cache.refreshing ? "Refreshing…" : refreshLabel}
        </button>
      )}
    </div>
  );
}

export function CompetitorsModule({ projectId, demo, onOpenIntegrations }: { projectId: number; demo: ReactNode; onOpenIntegrations: () => void }) {
  const [nonce, setNonce] = useState(0);
  const { res, error } = useModule<SeSnapshotPart>(`/api/v2/seranking/${projectId}/competition`, nonce);
  const other = ModuleStates({ res, error, what: "competitors", demo, onOpenIntegrations, onRetry: () => setNonce((n) => n + 1) });
  if (other || !res || res.state !== "live") return other;
  const d = res.data;
  const snap = snapOf(d.site, { engines: d.engines, keywords: d.keywords, competitors: d.competitors, competition: d.competition, rivals: d.rivals, errors: d.errors }, res.cache.fetchedAt);
  return (
    <div className="space-y-4">
      <SourceBar
        site={d.site}
        cache={res.cache}
        onRefresh={() => setNonce((n) => n + 1)}
        refreshLabel="Refresh from SE Ranking"
        refreshNote="Re-reads competitors, the top 10 of the 40 highest-volume keywords and competitors' positions (about 60–70 SE Ranking Project API requests, no credits). Refreshes daily on its own when opened."
      />
      <div className="ai-area">
        <CompetitorsSection snap={snap} />
      </div>
    </div>
  );
}
type SeSnapshotPart = Pick<SeSnapshot, "engines" | "keywords" | "competitors" | "competition" | "rivals" | "errors">;

export function AuditModule({ projectId, demo, onOpenIntegrations }: { projectId: number; demo: ReactNode; onOpenIntegrations: () => void }) {
  const [nonce, setNonce] = useState(0);
  const { res, error } = useModule<Pick<SeSnapshot, "audit">>(`/api/v2/seranking/${projectId}/audit`, nonce);
  const other = ModuleStates({ res, error, what: "the site audit", demo, onOpenIntegrations, onRetry: () => setNonce((n) => n + 1) });
  if (other || !res || res.state !== "live") return other;
  const d = res.data;
  return (
    <div className="space-y-4">
      <SourceBar
        site={d.site}
        cache={res.cache}
        onRefresh={() => setNonce((n) => n + 1)}
        refreshLabel="Re-read latest audit"
        refreshNote="Reads the most recent existing audit from SE Ranking (1–2 requests). It never starts a new crawl; run audits in SE Ranking."
      />
      {d.audit ? (
        <div className="ai-area">
          <AuditSection audit={d.audit} />
        </div>
      ) : (
        <EmptyState
          title="No site audit in SE Ranking for this site."
          body="SEO Console reads existing audits only and never starts a crawl. Run a website audit for this project in SE Ranking; it appears here after it finishes."
        />
      )}
      {d.audit && d.audit.status !== "finished" && (
        <p className="text-xs text-muted">The latest audit is {d.audit.status}; issue details appear once SE Ranking finishes it.</p>
      )}
    </div>
  );
}

interface BacklinksExtra {
  profile: { data: { status: "ok"; linkProfile: SeSnapshot["linkProfile"]; competitors: SeSnapshot["competitors"] } | null; fetchedAt: number | null; lastError: string | null; refreshing: boolean };
  entitlement: DataApiEntitlement;
  refresh: { allowed: boolean; credits: number; reason?: string; remedy?: string };
}

export function BacklinksModule({ projectId, demo, onOpenIntegrations }: { projectId: number; demo: ReactNode; onOpenIntegrations: () => void }) {
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { res, error } = useModule<Pick<SeSnapshot, "backlinks" | "errors">>(`/api/v2/seranking/${projectId}/backlinks`, nonce, false);
  const other = ModuleStates({ res, error, what: "backlinks", demo, onOpenIntegrations, onRetry: () => setNonce((n) => n + 1) });
  if (other || !res || res.state !== "live") return other;
  const d = res.data;
  const x = res as unknown as BacklinksExtra;
  const blocked = !x.refresh.allowed ? `${x.refresh.reason} ${x.refresh.remedy ?? ""}`.trim() : x.entitlement.state !== "available" ? x.entitlement.message : null;
  const refresh = async () => {
    if (!window.confirm(`Refresh the backlink profile? This uses about ${x.refresh.credits} SE Ranking Data API credits.`)) return;
    setRefreshing(true);
    setMessage(null);
    const r = await fetch(`/api/v2/seranking/${projectId}/backlinks`, { method: "POST" });
    const b = await r.json().catch(() => ({}));
    setRefreshing(false);
    if (!r.ok || b.state === "error") setMessage(b.error ?? b.message ?? "The refresh failed.");
    setNonce((n) => n + 1);
  };
  const snap = snapOf(
    d.site,
    {
      backlinks: d.backlinks,
      linkProfile: x.profile.data?.linkProfile ?? null,
      competitors: x.profile.data?.competitors ?? [],
      errors: { ...(x.profile.lastError ? { linkProfile: x.profile.lastError } : {}) },
    },
    x.profile.fetchedAt ?? res.cache.fetchedAt,
  );
  return (
    <div className="space-y-4">
      <SourceBar site={d.site} cache={res.cache} refreshLabel="" refreshNote="" />
      <div className="rounded-lg border px-4 py-2.5 text-xs text-muted" role="note">
        <p>
          <strong className="text-foreground">Backlink profile (SE Ranking Data API):</strong>{" "}
          {x.profile.fetchedAt ? `saved ${fmtTime(x.profile.fetchedAt)}; it never refreshes on its own.` : "not fetched yet."} Each refresh uses about {x.refresh.credits} API credits.
        </p>
        <p>
          <strong className="text-foreground">Data API access:</strong> {x.entitlement.message} (checked with SE Ranking&apos;s free account/subscription call)
        </p>
        {blocked && (
          <p style={{ color: "var(--bad)" }}>
            <strong>Refresh unavailable:</strong> {blocked}
          </p>
        )}
        {message && <p style={{ color: "var(--bad)" }}>{message}</p>}
      </div>
      <div className="ai-area">
        <BacklinksSection snap={snap} onRefresh={() => void refresh()} refreshing={refreshing || x.profile.refreshing} blockedReason={blocked} />
      </div>
    </div>
  );
}
