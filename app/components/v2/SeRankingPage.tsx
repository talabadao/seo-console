"use client";

// Rank tracking → SE Ranking: read-only overview, history and keyword table for the SE Ranking project mapped to
// this project. Same mapping and definitions as the dashboard's Keyword rankings card (lib/seranking/report.ts).
// The engine, keyword group and table filters are views of the saved report and never ask SE Ranking again;
// only "Refresh from SE Ranking" does (about 4 API requests, at most once every 5 minutes).

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AVG_POSITION_DEFINITION, type SeKeywordView, type SeReportView } from "@/lib/seranking/metrics";
import { Delta, StateBadge, Stat, fmtInt, fmtPos, fmtTime } from "./summaryUi";
import { ProviderIcon } from "./ProviderIcon";
import { Move, PositionSpark } from "../seranking/shared";
import { HostOverview, type OverviewData } from "../seranking/HostOverview";
import { ModuleStates, useModule } from "../seranking/Modules";
import type { SeAudit, SeCompetition } from "@/lib/seranking/donor/types";
import { Card, ErrorState, EmptyState, LoadingState, buttonClass, primaryButtonClass } from "./ui";

type CacheInfo = { state: "fresh" | "stale"; fetchedAt: number | null; dataThrough: string | null; refreshing: boolean; lastError: string | null; cooldown?: boolean };
type Res =
  | { state: "live" | "demo"; view: SeReportView; message?: string; cache?: CacheInfo }
  | { state: "no-data"; message: string; site?: { title: string; url: string }; cache?: CacheInfo }
  | { state: "not-mapped"; message: string; chosenMissing: boolean }
  | { state: "unconfigured" | "unauthorized" | "pending" | "error"; message: string }
  | { state: "fetch-error"; message: string };

const RANGES = [
  [7, "Last 7 days"],
  [28, "Last 28 days"],
  [90, "Last 90 days"],
] as const;
const COMPARES = [
  [1, "Previous check (1 day)"],
  [7, "7 days earlier"],
  [28, "28 days earlier"],
  [90, "90 days earlier"],
] as const;


type SortKey = "name" | "volume" | "current" | "change" | "best";
type Filter = "all" | "top3" | "top10" | "ranked" | "unranked" | "up" | "down";
const PAGE = 50;

/** SE Ranking SERP feature codes (labels from the donor app). */
const FEATURE_LABEL: Record<string, string> = {
  sge: "AI Overview",
  ai_overview: "AI Overview",
  local_pack: "Local pack",
  people_also_ask: "People also ask",
  reviews: "Reviews",
  images: "Images",
  video: "Video",
  tads: "Top ads",
  bads: "Bottom ads",
  knowledge_graph: "Knowledge panel",
  sitelinks: "Sitelinks",
  gmb: "Business profile",
  featured_snippet: "Featured snippet",
};

type Tab = "overview" | "rankings";
type ModuleTarget = "audit" | "competitors" | "backlinks";

/**
 * Rank tracking → SE Ranking, with the donor app's Overview and Rankings tabs (the tab is the sub-path: "" or
 * "rankings"). Competitors, backlinks and the site audit live in their own modules; the overview links to them.
 */
export function SeRankingPage({
  projectId,
  sub,
  onSub,
  onOpenIntegrations,
  onOpenModule,
}: {
  projectId: number;
  sub: string;
  onSub: (sub: string) => void;
  onOpenIntegrations: () => void;
  onOpenModule: (target: ModuleTarget) => void;
}) {
  const tab: Tab = sub === "rankings" ? "rankings" : "overview";
  return (
    <div className="ai-area space-y-4">
      <div role="tablist" aria-label="SE Ranking" className="flex flex-wrap items-center gap-1 border-b">
        <ProviderIcon id="se-ranking" size={20} />
        {(
          [
            ["overview", "Overview"],
            ["rankings", "Rankings"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            onClick={() => onSub(id === "overview" ? "" : id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <OverviewTab projectId={projectId} onOpenIntegrations={onOpenIntegrations} onOpen={(t) => (t === "rankings" ? onSub("rankings") : onOpenModule(t))} />
      ) : (
        <RankingsTab projectId={projectId} onOpenIntegrations={onOpenIntegrations} />
      )}
    </div>
  );
}

function OverviewTab({ projectId, onOpenIntegrations, onOpen }: { projectId: number; onOpenIntegrations: () => void; onOpen: (t: "rankings" | ModuleTarget) => void }) {
  const [nonce, setNonce] = useState(0);
  const { res, error } = useModule<OverviewData>(`/api/v2/seranking/${projectId}/overview`, nonce);
  // Same scope as the dashboard card: last 28 days vs 28 days earlier, main engine, all groups.
  const view = useJson<Res>(`/api/v2/seranking/${projectId}?days=28&compare=28`);
  const audit = useJson<{ state: string; data?: { audit: SeAudit | null } }>(`/api/v2/seranking/${projectId}/audit?peek=1`);
  const competition = useJson<{ state: string; data?: { competition: SeCompetition | null } }>(`/api/v2/seranking/${projectId}/competition?peek=1`);
  const v = view && "view" in view ? view.view : null;
  const demo = (
    <div className="space-y-3">
      <p className="rounded-lg border px-3 py-2 text-xs text-muted">
        Demo project: invented rankings, not a measurement. Audit, competitors and backlinks aren&apos;t queried for demo projects.
      </p>
      <HostOverview data={{ summary: null, engines: [], history: {}, backlinks: null, errors: {} }} view={v} audit={null} competition={null} onOpen={onOpen} />
    </div>
  );
  const other = ModuleStates({ res, error, what: "the SE Ranking overview", demo, onOpenIntegrations, onRetry: () => setNonce((n) => n + 1) });
  if (other || !res || res.state !== "live") return other;
  const peeked = <T,>(r: { state: string; data?: T } | null): T | "not-fetched" | null => (!r ? null : r.state === "live" && r.data ? r.data : r.state === "not-fetched" ? "not-fetched" : null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>
          Source: SE Ranking · {res.data.site.title !== res.data.site.url ? `${res.data.site.title} · ` : ""}
          {res.data.site.url}
          {res.cache.fetchedAt ? ` · saved ${fmtTime(res.cache.fetchedAt)}` : ""}
        </span>
        {res.cache.state === "stale" && <span className="rounded-full border px-1.5 text-[11px]">Stale{res.cache.refreshing ? ", refreshing" : ""}</span>}
        {res.cache.lastError && <span style={{ color: "var(--bad)" }}>Last refresh failed: {res.cache.lastError}</span>}
        <button
          className={`${buttonClass} ml-auto`}
          onClick={() => setNonce((n) => n + 1)}
          disabled={res.cache.refreshing}
          title="Re-reads SE Ranking's summary and history (about 6 Project API requests). Skipped within 5 minutes of the last refresh."
        >
          {res.cache.refreshing ? "Refreshing…" : "Refresh from SE Ranking"}
        </button>
      </div>
      <HostOverview data={res.data} view={v} audit={peeked(audit)} competition={peeked(competition)} onOpen={onOpen} />
    </div>
  );
}

/** A small GET hook for read-only side requests. */
function useJson<T>(url: string): T | null {
  const [state, setState] = useState<{ url: string; value: T | null }>({ url: "", value: null });
  useEffect(() => {
    let live = true;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => live && setState({ url, value: b as T }))
      .catch(() => live && setState({ url, value: null }));
    return () => {
      live = false;
    };
  }, [url]);
  return state.url === url ? state.value : null;
}

function RankingsTab({ projectId, onOpenIntegrations }: { projectId: number; onOpenIntegrations: () => void }) {
  const [days, setDays] = useState<number>(28);
  const [compare, setCompare] = useState<number>(28);
  const [engine, setEngine] = useState<number | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = `${projectId}|${days}|${compare}|${engine}|${group}|${nonce}`;
  const [res, setRes] = useState<{ key: string; value: Res } | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (refresh: boolean, polls: number) => {
      const q = new URLSearchParams({ days: String(days), compare: String(Math.min(compare, days)) });
      if (engine != null) q.set("engine", String(engine));
      if (group) q.set("group", group);
      if (refresh) q.set("refresh", "1");
      fetch(`/api/v2/seranking/${projectId}?${q}`, { cache: "no-store" })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
          if (!live) return;
          // A first load still running on the server, or a refresh in progress: ask again (joins the same job).
          if ((body.state === "pending" || body.cache?.refreshing) && polls < 40) {
            if (body.state !== "pending") setRes({ key, value: body as Res });
            timer = setTimeout(() => load(false, polls + 1), body.state === "pending" ? 3000 : 6000);
            return;
          }
          setRes({ key, value: body as Res });
        })
        .catch((e) => live && setRes({ key, value: { state: "fetch-error", message: e instanceof Error ? e.message : String(e) } }));
    };
    load(nonce > 0, 0);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [key, projectId, days, compare, engine, group, nonce]);

  const current = res?.key === key ? res.value : null;
  const view = current && "view" in current ? current.view : null;
  const cache = current && "cache" in current ? current.cache : undefined;

  const controls = (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Date range</span>
        <select className="rounded-md border bg-surface px-2 py-1.5" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map(([d, l]) => (
            <option key={d} value={d}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Compare with</span>
        <select className="rounded-md border bg-surface px-2 py-1.5" value={Math.min(compare, days)} onChange={(e) => setCompare(Number(e.target.value))}>
          {COMPARES.filter(([d]) => d <= days).map(([d, l]) => (
            <option key={d} value={d}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {view && (
        <>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted">Search engine</span>
            <select className="max-w-[18rem] rounded-md border bg-surface px-2 py-1.5" value={view.engine.id} onChange={(e) => setEngine(Number(e.target.value))}>
              {view.engines.map((e) => (
                <option key={e.id} value={e.id}>
                  {[e.name, e.region, e.language, e.device].filter(Boolean).join(" · ")} ({fmtInt(e.keywordCount)} keywords)
                </option>
              ))}
            </select>
          </label>
          {view.groups.length > 1 && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Keyword group</span>
              <select className="rounded-md border bg-surface px-2 py-1.5" value={view.group ?? ""} onChange={(e) => setGroup(e.target.value || null)}>
                <option value="">All tracked keywords</option>
                {view.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.keywords})
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      {current?.state !== "demo" && current?.state !== "unconfigured" && current?.state !== "not-mapped" && (
        <button
          className={`${buttonClass} ml-auto`}
          onClick={() => setNonce((n) => n + 1)}
          disabled={!current || cache?.refreshing}
          title="Asks SE Ranking again (about 4 API requests). Skipped if the saved report is less than 5 minutes old; joins a refresh that's already running."
        >
          {cache?.refreshing ? "Refreshing…" : "Refresh from SE Ranking"}
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {controls}
      {!current ? (
        <LoadingState label="Loading SE Ranking report…" rows={6} />
      ) : current.state === "pending" ? (
        <>
          <p className="text-sm text-muted">{current.message}</p>
          <LoadingState label={current.message} rows={6} />
        </>
      ) : current.state === "unconfigured" ? (
        <EmptyState title="SE Ranking isn't connected." body={`${current.message} Ask the administrator to add the SE Ranking API key to the server.`} />
      ) : current.state === "unauthorized" ? (
        <ErrorState title="SE Ranking refused access." body={`${current.message} Saved data is hidden until access works again.`} />
      ) : current.state === "not-mapped" ? (
        <EmptyState
          title={current.chosenMissing ? "The chosen SE Ranking project is gone." : "No SE Ranking project is mapped."}
          body={current.message}
          action={
            <button className={primaryButtonClass} onClick={onOpenIntegrations}>
              Choose SE Ranking project
            </button>
          }
        />
      ) : current.state === "no-data" ? (
        <EmptyState title="No rankings to show." body={`${current.site ? `${current.site.title}: ` : ""}${current.message}`} />
      ) : current.state === "error" || current.state === "fetch-error" ? (
        <ErrorState
          title="Couldn't load SE Ranking."
          body={current.message}
          action={
            <button className={buttonClass} onClick={() => setNonce((n) => n + 1)}>
              Try again
            </button>
          }
        />
      ) : view ? (
        <Report view={view} demo={current.state === "demo"} cache={cache} />
      ) : null}
    </div>
  );
}

function Freshness({ view, demo, cache }: { view: SeReportView; demo: boolean; cache?: CacheInfo }) {
  const parts = [`Source: SE Ranking${demo ? " (demo data, invented)" : ""}`, `${view.site.title} (${view.site.url})`, `latest check ${view.latestDate}`];
  const saved = fmtTime(cache?.fetchedAt ?? undefined);
  if (saved) parts.push(`saved ${saved}`);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <StateBadge state={demo ? "demo" : "live"} small />
      {cache?.state === "stale" && (
        <span className="rounded-full border px-1.5 text-[11px]" style={{ borderColor: "var(--position)" }} title="Older than the 12-hour refresh interval">
          Stale
        </span>
      )}
      <span>{parts.join(" · ")}</span>
      {cache?.refreshing && <span>· refreshing in the background</span>}
      {cache?.cooldown && <span>· refreshed less than 5 minutes ago, showing the saved report</span>}
      {cache?.lastError && <span style={{ color: "var(--bad)" }}>· last refresh failed: {cache.lastError}</span>}
    </div>
  );
}

function Report({ view, demo, cache }: { view: SeReportView; demo: boolean; cache?: CacheInfo }) {
  const p = view.previous;
  const pair = (k: "top3" | "top5" | "top10" | "avgPosition" | "ranked") => ({ current: view.current[k], previous: p ? p[k] : null });
  const history = useMemo(() => view.history.map((h) => ({ date: h.date.slice(5), top3: h.top3, top5: h.top5, top10: h.top10, avg: h.avgPosition })), [view]);
  const e = view.engine;
  return (
    <>
      <Freshness view={view} demo={demo} cache={cache} />
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Top 3" value={fmtInt(view.current.top3)} pair={pair("top3")} absolute integer hint="Keywords at positions 1–3" />
          <Stat label="Top 5" value={fmtInt(view.current.top5)} pair={pair("top5")} absolute integer hint="Keywords at positions 1–5 (includes the top 3)" />
          <Stat label="Top 10" value={fmtInt(view.current.top10)} pair={pair("top10")} absolute integer hint="Keywords at positions 1–10 (includes the top 5)" />
          <Stat label="In top 100" value={fmtInt(view.current.ranked)} pair={pair("ranked")} absolute integer hint="Keywords ranking anywhere in the tracked depth" />
          <Stat label="Avg. position" value={fmtPos(view.current.avgPosition)} pair={pair("avgPosition")} lowerIsBetter absolute hint={AVG_POSITION_DEFINITION} />
          <Stat label="Avg. of ranked only" value={fmtPos(view.current.rankedAvgPosition)} hint="Mean position of keywords in the top 100 only" />
        </div>
        <p className="mt-3 text-xs text-muted">
          {fmtInt(view.keywords.length)} tracked keywords · {[e.name, e.region, e.language, e.device].filter(Boolean).join(" · ")} ·{" "}
          {view.group ? view.groups.find((g) => g.id === view.group)?.name : "all keyword groups"}. Checked {view.latestDate}
          {view.comparisonDate ? ` vs ${view.comparisonDate}` : " (no check early enough to compare)"}. Top 3 / 5 / 10 are cumulative; position 0 from
          SE Ranking means outside the top 100 and counts as not ranking. {AVG_POSITION_DEFINITION}
          {view.engines.length > 1 ? ` ${view.engines.length - 1} other search engine${view.engines.length === 2 ? "" : "s"} tracked; choose one above (never mixed).` : ""}
        </p>
      </Card>

      {history.length > 1 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Keywords in the top positions">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="top3" name="Top 3" stroke="var(--good)" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="top5" name="Top 5" stroke="var(--ctr)" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="top10" name="Top 10" stroke="var(--clicks)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Average position (lower is better)">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={24} />
                  <YAxis reversed domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v: number) => v.toFixed(0)} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }} formatter={(v) => fmtPos(Number(v))} />
                  <Line type="monotone" dataKey="avg" name="Avg. position" stroke="var(--position)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted">Each day counts only the keywords SE Ranking checked that day.</p>
          </Card>
        </div>
      )}

      <KeywordTable view={view} />
    </>
  );
}

function KeywordTable({ view }: { view: SeReportView }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "current", desc: false });
  const [page, setPage] = useState(0);
  const groupName = useMemo(() => new Map(view.groups.map((g) => [g.id, g.name])), [view]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const keep = (k: SeKeywordView) => {
      if (s && !k.name.toLowerCase().includes(s) && !(k.landing ?? "").toLowerCase().includes(s)) return false;
      if (filter === "top3") return k.current != null && k.current <= 3;
      if (filter === "top10") return k.current != null && k.current <= 10;
      if (filter === "ranked") return k.current != null;
      if (filter === "unranked") return k.current === null;
      if (filter === "up") return (k.change ?? 0) > 0;
      if (filter === "down") return (k.change ?? 0) < 0;
      return true;
    };
    // Not ranking / not checked always sort after ranked keywords.
    const val = (k: SeKeywordView): number | string | null =>
      sort.key === "name" ? k.name.toLowerCase() : sort.key === "volume" ? k.volume : sort.key === "current" ? (k.current ?? null) : sort.key === "change" ? k.change : k.best;
    return view.keywords.filter(keep).sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null && y == null) return a.name.localeCompare(b.name);
      if (x == null) return 1;
      if (y == null) return -1;
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [view, search, filter, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(Math.min(page, pages - 1) * PAGE, Math.min(page, pages - 1) * PAGE + PAGE);

  const header = (label: string, key: SortKey, align = "text-right") => (
    <th className={`px-2 py-1.5 font-medium ${align}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className="hover:underline" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === "volume" || key === "change" }))}>
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <Card
      title={`Keywords (${fmtInt(rows.length)}${rows.length !== view.keywords.length ? ` of ${fmtInt(view.keywords.length)}` : ""})`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search keyword or URL"
            aria-label="Search keywords"
            className="w-48 rounded-md border bg-surface px-2 py-1 text-sm"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <select
            aria-label="Filter keywords"
            className="rounded-md border bg-surface px-2 py-1 text-sm"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as Filter);
              setPage(0);
            }}
          >
            <option value="all">All</option>
            <option value="top3">Top 3</option>
            <option value="top10">Top 10</option>
            <option value="ranked">In top 100</option>
            <option value="unranked">Not ranking</option>
            <option value="up">Improved</option>
            <option value="down">Declined</option>
          </select>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              {header("Keyword", "name", "text-left")}
              {view.groups.length > 1 && <th className="px-2 py-1.5 font-medium">Group</th>}
              {header("Volume", "volume")}
              {header("Position", "current")}
              {header(`Change${view.comparisonDate ? ` since ${view.comparisonDate.slice(5)}` : ""}`, "change")}
              {header("Best", "best")}
              <th className="px-2 py-1.5 font-medium">30 days</th>
              <th className="px-2 py-1.5 text-right font-medium">1d</th>
              <th className="px-2 py-1.5 text-right font-medium">7d</th>
              <th className="px-2 py-1.5 text-right font-medium">30d</th>
              <th className="px-2 py-1.5 font-medium">Landing page</th>
              <th className="px-2 py-1.5 font-medium">SERP features</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((k) => (
              <tr key={k.id} className="border-t border-border/60 align-top">
                <td className="px-2 py-1.5">{k.name}</td>
                {view.groups.length > 1 && <td className="px-2 py-1.5 text-xs text-muted">{k.groupId ? (groupName.get(k.groupId) ?? k.groupId) : "—"}</td>}
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtInt(k.volume)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {k.current === undefined ? <span className="text-muted" title="No check on the latest date">—</span> : k.current === null ? <span className="text-xs text-muted">Not in top 100</span> : k.current}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {k.previous === null && k.current != null ? (
                    <span className="text-xs font-medium" style={{ color: "var(--good)" }}>
                      New
                    </span>
                  ) : k.previous != null && k.current === null ? (
                    <span className="text-xs font-medium" style={{ color: "var(--bad)" }}>
                      Lost
                    </span>
                  ) : (
                    <Delta pair={{ current: k.current ?? null, previous: k.previous ?? null }} lowerIsBetter absolute integer />
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{k.best ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <PositionSpark positions={k.recent} />
                </td>
                <td className="px-2 py-1.5 text-right text-xs">
                  <Move value={k.change1} />
                </td>
                <td className="px-2 py-1.5 text-right text-xs">
                  <Move value={k.change7} />
                </td>
                <td className="px-2 py-1.5 text-right text-xs">
                  <Move value={k.change30} />
                </td>
                <td className="max-w-[16rem] truncate px-2 py-1.5 text-xs">
                  {k.landing ? (
                    <a href={k.landing} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" title={k.landing}>
                      {k.landing.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs text-muted">
                  {k.features.length ? k.features.map((f) => `${FEATURE_LABEL[f] ?? f.replace(/_/g, " ")}${k.ownFeatures.includes(f) ? " (yours)" : ""}`).join(", ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="py-4 text-center text-sm text-muted">No keywords match.</p>}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button className={buttonClass} disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Previous
          </button>
          <span className="text-xs text-muted">
            Page {Math.min(page, pages - 1) + 1} of {pages}
          </span>
          <button className={buttonClass} disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>
            Next
          </button>
        </div>
      )}
    </Card>
  );
}
