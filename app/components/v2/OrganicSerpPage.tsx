"use client";

// Rank tracking → Organic SERP: organic results from Google, Bing, Yandex or Naver through SerpApi, separate from
// the AI Area. Searches are explicit (the button shows the most SerpApi searches the run can use and the limit
// it counts against); saved snapshots open from the database without searching; two snapshots of the same search
// can be compared. Results are normalized text (position, title, URL, snippet, features); provider HTML is never
// embedded.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEVICES,
  ENGINES,
  ENGINE_IDS,
  YANDEX_DOMAINS,
  belongsTo,
  diffSnapshots,
  isEngine,
  maxRequests,
  type EngineId,
  type Field,
  type SerpParams,
} from "@/lib/organicSerp/engines";
import type { SerpConfig, Snapshot, SnapshotSummary } from "@/lib/organicSerp/store";
import { fmtTime } from "./summaryUi";
import { Card, EmptyState, ErrorState, LoadingState, buttonClass, primaryButtonClass } from "./ui";

interface Overview {
  trackedDomain: string | null;
  demo: boolean;
  configs: SerpConfig[];
  snapshots: SnapshotSummary[];
}
interface Quote {
  requests: number;
  maxRequests: number;
  allowed: boolean;
  reason?: string | null;
  demo?: boolean;
  tightest?: { label: string; used: number; max: number; left: number } | null;
}

const FIELD_LABEL: Record<Field, string> = {
  location: "Location",
  country: "Country (gl / cc)",
  language: "Language",
  device: "Device",
  yandexDomain: "Yandex domain",
  region: "Region id (lr)",
};
const FIELD_HINT: Partial<Record<Field, string>> = {
  location: "City-level works best, e.g. Ho Chi Minh City, Vietnam",
  country: "Two letters, e.g. vn",
  language: "e.g. en, vi",
  region: "Numeric Yandex region, optional",
};

type Form = SerpParams & { depth: number; stopOnFound: boolean };
const emptyForm = (engine: EngineId): Form => ({ query: "", depth: ENGINES[engine].depths[0], stopOnFound: true, ...(engine === "yandex" ? { yandexDomain: "yandex.com" } : {}) });

const describe = (s: { engine: EngineId; params: SerpParams }) =>
  [ENGINES[s.engine].label, s.params.location, s.params.country?.toUpperCase(), s.params.language, s.params.yandexDomain, s.params.region && `lr ${s.params.region}`, s.params.device]
    .filter(Boolean)
    .join(" · ");

export function OrganicSerpPage({
  projectId,
  engine: engineSub,
  onEngine,
  onOpenUsage,
  onOpenBudgets,
}: {
  projectId: number;
  engine: string;
  onEngine: (engine: string) => void;
  onOpenUsage: () => void;
  onOpenBudgets: () => void;
}) {
  const engine: EngineId = isEngine(engineSub) ? engineSub : "google";
  const spec = ENGINES[engine];
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forms, setForms] = useState<Partial<Record<EngineId, Form>>>({});
  const form = forms[engine] ?? emptyForm(engine);
  const setForm = (patch: Partial<Form>) => setForms((f) => ({ ...f, [engine]: { ...(f[engine] ?? emptyForm(engine)), ...patch } }));
  const [configId, setConfigId] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "bad"; text: string; rerun?: boolean } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [compare, setCompare] = useState<Snapshot | null>(null);
  const [onlyEngine, setOnlyEngine] = useState(true);

  const reload = useCallback(
    () =>
      fetch(`/api/v2/organic-serp/${projectId}`, { cache: "no-store" })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
          setOverview(body as Overview);
          setLoadError(null);
        })
        .catch((e) => setLoadError(e instanceof Error ? e.message : String(e))),
    [projectId],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  // Expected usage for the current engine and depth (reads limits only; sends nothing). Re-read after each run.
  const runs = nonceOf(overview);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/organic-serp/${projectId}/quote?engine=${engine}&depth=${form.depth}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((q) => live && setQuote(q as Quote))
      .catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, [projectId, engine, form.depth, runs]);

  // Opening a snapshot reads it from the database; it never searches.
  useEffect(() => {
    if (openId == null) return;
    let live = true;
    fetch(`/api/v2/organic-serp/${projectId}/snapshots/${openId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => live && setSnapshot(b.snapshot ?? null));
    return () => {
      live = false;
    };
  }, [projectId, openId]);
  useEffect(() => {
    if (compareId == null) return;
    let live = true;
    fetch(`/api/v2/organic-serp/${projectId}/snapshots/${compareId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => live && setCompare(b.snapshot ?? null));
    return () => {
      live = false;
    };
  }, [projectId, compareId]);

  const payload = () => ({
    engine,
    params: Object.fromEntries(["query", ...spec.fields].map((f) => [f, (form as unknown as Record<string, unknown>)[f] ?? ""])),
    depth: form.depth,
    stopOnFound: form.stopOnFound,
  });

  async function run(force: boolean) {
    setBusy(force ? "Searching again…" : "Searching…");
    setNotice(null);
    try {
      const res = await fetch(`/api/v2/organic-serp/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload(), configId, force }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ tone: "bad", text: body.error ?? `The search failed (status ${res.status}).` });
        return;
      }
      const s = body.snapshot as Snapshot;
      if (body.reused) {
        setNotice({ tone: "info", text: `Showing the identical search from ${fmtTime(s.startedAt)}; no new SerpApi search was made.`, rerun: true });
      } else if (body.joined) {
        setNotice({ tone: "info", text: "The same search was already running; showing its result instead of searching twice." });
      } else if (s.status === "partial") {
        setNotice({ tone: "bad", text: `Only part of the results came back: ${s.error}. The snapshot is marked partial.` });
      }
      setSnapshot(s);
      setOpenId(s.id);
      setCompareId(null);
      setCompare(null);
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const name = window.prompt("Name for this saved search", configId ? (overview?.configs.find((c) => c.id === configId)?.name ?? "") : `${spec.label}: ${form.query}`);
    if (name == null) return;
    setBusy("Saving…");
    try {
      const res = await fetch(`/api/v2/organic-serp/${projectId}/configs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload(), name, id: configId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setNotice({ tone: "bad", text: body.error ?? "Couldn't save." });
      setConfigId(body.config.id);
      setOverview((o) => (o ? { ...o, configs: body.configs } : o));
      setNotice({ tone: "info", text: `Saved "${body.config.name}". No search was made.` });
    } finally {
      setBusy(null);
    }
  }

  async function removeConfig(id: number) {
    if (!window.confirm("Delete this saved search? Its snapshots stay in the history.")) return;
    const res = await fetch(`/api/v2/organic-serp/${projectId}/configs?config=${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setOverview((o) => (o ? { ...o, configs: body.configs } : o));
      setConfigId(null);
    }
  }

  function loadConfig(id: number | null) {
    setConfigId(id);
    const c = overview?.configs.find((x) => x.id === id);
    if (!c) return;
    setForms((f) => ({ ...f, [c.engine]: { ...emptyForm(c.engine), ...c.params, depth: c.depth, stopOnFound: c.stopOnFound } }));
    if (c.engine !== engine) onEngine(c.engine);
  }

  const history = useMemo(() => (overview?.snapshots ?? []).filter((s) => !onlyEngine || s.engine === engine), [overview, onlyEngine, engine]);

  if (loadError) return <ErrorState title="Couldn't load Organic SERP." body={loadError} />;
  if (!overview) return <LoadingState label="Loading Organic SERP…" />;

  const max = maxRequests(engine, form.depth);
  const blocked = quote && !quote.allowed;
  const runLabel = overview.demo ? "Run demo search (no SerpApi searches)" : `Run search (up to ${max} SerpApi search${max === 1 ? "" : "es"})`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Organic results through SerpApi, separate from the AI Area (AI Overviews and brand mentions live there). Searches run only when you press the
        button; opening a saved snapshot never searches again.
        {overview.trackedDomain ? (
          <>
            {" "}
            Results from <strong className="text-foreground">{overview.trackedDomain}</strong> are highlighted.
          </>
        ) : (
          " Add the project's website to highlight its results."
        )}
      </p>

      <div role="tablist" aria-label="Search engine" className="flex flex-wrap gap-1 border-b">
        {ENGINE_IDS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={id === engine}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${id === engine ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            onClick={() => {
              setConfigId(null);
              onEngine(id);
            }}
          >
            {ENGINES[id].label}
          </button>
        ))}
      </div>

      <Card title={`${spec.label} search`}>
        {overview.configs.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-xs text-muted">Saved search</span>
              <select className="rounded-md border bg-surface px-2 py-1" value={configId ?? ""} onChange={(e) => loadConfig(e.target.value ? Number(e.target.value) : null)}>
                <option value="">None</option>
                {overview.configs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({ENGINES[c.engine].label})
                  </option>
                ))}
              </select>
            </label>
            {configId && (
              <button className="text-xs text-bad hover:underline" onClick={() => removeConfig(configId)}>
                Delete saved search
              </button>
            )}
          </div>
        )}
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && form.query.trim() && !blocked) void run(false);
          }}
        >
          <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
            <span className="text-xs text-muted">Keyword</span>
            <input className="rounded-md border bg-surface px-2 py-1.5" value={form.query} maxLength={300} onChange={(e) => setForm({ query: e.target.value })} required />
          </label>
          {spec.fields.map((f) => (
            <label key={f} className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted">{FIELD_LABEL[f]}</span>
              {f === "device" ? (
                <select className="rounded-md border bg-surface px-2 py-1.5" value={form.device ?? "desktop"} onChange={(e) => setForm({ device: e.target.value as Form["device"] })}>
                  {DEVICES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : f === "yandexDomain" ? (
                <select className="rounded-md border bg-surface px-2 py-1.5" value={form.yandexDomain ?? "yandex.com"} onChange={(e) => setForm({ yandexDomain: e.target.value })}>
                  {YANDEX_DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="rounded-md border bg-surface px-2 py-1.5"
                  placeholder={FIELD_HINT[f]}
                  value={(form as unknown as Record<string, string | undefined>)[f] ?? ""}
                  onChange={(e) => setForm({ [f]: e.target.value } as Partial<Form>)}
                />
              )}
            </label>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted">Depth (results to scan)</span>
            <select className="rounded-md border bg-surface px-2 py-1.5" value={form.depth} onChange={(e) => setForm({ depth: Number(e.target.value) })}>
              {spec.depths.map((d) => (
                <option key={d} value={d}>
                  Top {d} (up to {maxRequests(engine, d)} search{maxRequests(engine, d) === 1 ? "" : "es"})
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
            <input type="checkbox" checked={form.stopOnFound} onChange={(e) => setForm({ stopOnFound: e.target.checked })} />
            Stop when {overview.trackedDomain ?? "the site"} is found (saves searches)
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
            <button type="submit" className={primaryButtonClass} disabled={Boolean(busy) || !form.query.trim() || Boolean(blocked)}>
              {busy?.startsWith("Search") ? busy : runLabel}
            </button>
            <button type="button" className={buttonClass} disabled={Boolean(busy) || !form.query.trim()} onClick={save}>
              {configId ? "Update saved search" : "Save search"}
            </button>
          </div>
        </form>
        <div className="mt-2 space-y-1 text-xs text-muted">
          <p>
            {spec.note} Each results page is billed as one SerpApi search; a run stops early when it reaches the depth, runs out of results
            {form.stopOnFound ? " or finds the site" : ""}. An identical search from the last hour is shown instead of searching again.
          </p>
          {quote?.demo ? (
            <p>Demo project: results are invented and no SerpApi search is made.</p>
          ) : blocked ? (
            <p style={{ color: "var(--bad)" }}>
              Can&apos;t search: {quote?.reason}{" "}
              <button className="text-accent hover:underline" onClick={onOpenBudgets}>
                Budgets &amp; limits
              </button>
            </p>
          ) : quote?.tightest ? (
            <p>
              Counts against: {quote.tightest.label} — {quote.tightest.left.toLocaleString("en-US")} of {quote.tightest.max.toLocaleString("en-US")} left.{" "}
              <button className="text-accent hover:underline" onClick={onOpenUsage}>
                Usage &amp; Costs
              </button>
            </p>
          ) : null}
        </div>
        {notice && (
          <p role="status" className="mt-2 text-sm" style={{ color: notice.tone === "bad" ? "var(--bad)" : undefined }}>
            {notice.text}{" "}
            {notice.rerun && !blocked && (
              <button className="text-accent hover:underline" onClick={() => run(true)} disabled={Boolean(busy)}>
                Search again anyway (up to {max} SerpApi search{max === 1 ? "" : "es"})
              </button>
            )}
          </p>
        )}
      </Card>

      {snapshot ? (
        <SnapshotView
          snapshot={snapshot}
          trackedDomain={overview.trackedDomain}
          candidates={(overview.snapshots ?? []).filter(
            (s) => s.id !== snapshot.id && s.engine === snapshot.engine && s.params.query.toLowerCase() === snapshot.params.query.toLowerCase() && s.status !== "failed",
          )}
          compare={compareId != null && compare?.id === compareId ? compare : null}
          compareId={compareId}
          onCompare={(id) => {
            setCompareId(id);
            if (id == null) setCompare(null);
          }}
        />
      ) : (
        <EmptyState title="No snapshot open." body="Run a search, or open one from the history below. Opening a snapshot doesn't search again." />
      )}

      <Card
        title="History"
        actions={
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={onlyEngine} onChange={(e) => setOnlyEngine(e.target.checked)} />
            {spec.label} only
          </label>
        }
      >
        {history.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-2 py-1.5 font-medium">Fetched</th>
                  <th className="px-2 py-1.5 font-medium">Keyword</th>
                  <th className="px-2 py-1.5 font-medium">Engine and settings</th>
                  <th className="px-2 py-1.5 text-right font-medium">Site position</th>
                  <th className="px-2 py-1.5 text-right font-medium">Scanned</th>
                  <th className="px-2 py-1.5 text-right font-medium">Searches</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id} className={`border-t border-border/60 ${s.id === openId ? "bg-accent-soft" : ""}`}>
                    <td className="px-2 py-1.5">
                      <button className="text-accent hover:underline" onClick={() => setOpenId(s.id)} disabled={s.status === "running"}>
                        {fmtTime(s.startedAt)}
                      </button>
                    </td>
                    <td className="px-2 py-1.5">{s.params.query}</td>
                    <td className="px-2 py-1.5 text-xs text-muted">{describe(s)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{s.trackedPosition ?? (s.status === "done" || s.status === "partial" ? `> ${s.scanned}` : "—")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.scanned} / {s.depth}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{s.demo ? "demo" : s.requests}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {s.status === "done" ? "Done" : s.status === "partial" ? <span style={{ color: "var(--bad)" }}>Partial</span> : s.status === "running" ? "Running…" : <span style={{ color: "var(--bad)" }}>Failed</span>}
                      {s.demo ? " · Demo" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No saved snapshots{onlyEngine ? ` for ${spec.label}` : ""} yet.</p>
        )}
      </Card>
    </div>
  );
}

/** Re-quote after each run (limits change). */
const nonceOf = (o: Overview | null) => o?.snapshots.length ?? 0;

function SnapshotView({
  snapshot: s,
  trackedDomain,
  candidates,
  compare,
  compareId,
  onCompare,
}: {
  snapshot: Snapshot;
  trackedDomain: string | null;
  candidates: SnapshotSummary[];
  compare: Snapshot | null;
  compareId: number | null;
  onCompare: (id: number | null) => void;
}) {
  const tracked = s.trackedDomain ?? trackedDomain;
  // A = the older snapshot, B = the newer.
  const [older, newer] = compare ? (compare.startedAt < s.startedAt ? [compare, s] : [s, compare]) : [null, null];
  const diff = useMemo(() => (older && newer ? diffSnapshots(older.results, newer.results, tracked) : []), [older, newer, tracked]);
  return (
    <Card title={`“${s.params.query}”`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{describe(s)}</span>
        <span>Fetched {fmtTime(s.startedAt)}</span>
        <span>
          Scanned {s.scanned} of top {s.depth}
          {s.stopOnFound && s.trackedPosition != null && s.scanned < s.depth ? " (stopped when the site was found)" : ""}
        </span>
        <span>{s.demo ? "Demo results (invented); no SerpApi search" : `${s.requests} SerpApi search${s.requests === 1 ? "" : "es"}`}</span>
        {s.status === "partial" && <span style={{ color: "var(--bad)" }}>Partial: {s.error}</span>}
        {s.status === "failed" && <span style={{ color: "var(--bad)" }}>Failed: {s.error}</span>}
      </div>
      {tracked && (
        <p className="mt-2 text-sm">
          {s.trackedPosition != null ? (
            <>
              <strong>{tracked}</strong> ranks at position <strong>{s.trackedPosition}</strong>
              {s.trackedUrl ? (
                <>
                  {" "}
                  with{" "}
                  <a className="text-accent hover:underline" href={s.trackedUrl} target="_blank" rel="noopener noreferrer">
                    {s.trackedUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                </>
              ) : null}
              .
            </>
          ) : s.status === "failed" ? null : (
            <>
              <strong>{tracked}</strong> was not found within the {s.scanned} results scanned{s.scanned < s.depth ? ` (depth ${s.depth} requested)` : ""}.
            </>
          )}
        </p>
      )}
      {s.features.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="SERP features on the first page">
          {s.features.map((f) => (
            <span key={f} className="rounded-full border px-2 py-0.5 text-[11px] text-muted">
              {f}
            </span>
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-muted">Compare with</span>
          <select className="rounded-md border bg-surface px-2 py-1" value={compareId ?? ""} onChange={(e) => onCompare(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {fmtTime(c.startedAt)} · {describe(c)} · site {c.trackedPosition ?? `> ${c.scanned}`}
              </option>
            ))}
          </select>
        </label>
      )}

      {older && newer ? (
        <div className="mt-3 overflow-x-auto">
          <p className="mb-2 text-xs text-muted">
            {fmtTime(older.startedAt)} → {fmtTime(newer.startedAt)}.{" "}
            {tracked
              ? `${tracked}: ${older.trackedPosition ?? `not in top ${older.scanned}`} → ${newer.trackedPosition ?? `not in top ${newer.scanned}`}.`
              : ""}{" "}
            Positions are only comparable within the depth each snapshot scanned.
          </p>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-2 py-1.5 font-medium">Result</th>
                <th className="px-2 py-1.5 text-right font-medium">Before</th>
                <th className="px-2 py-1.5 text-right font-medium">After</th>
                <th className="px-2 py-1.5 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {diff.map((r) => (
                <tr key={r.url} className={`border-t border-border/60 ${r.tracked ? "bg-accent-soft" : ""}`}>
                  <td className="max-w-[28rem] px-2 py-1.5">
                    <div className="truncate">{r.title}</div>
                    <div className="truncate text-xs text-muted">{r.url.replace(/^https?:\/\/(www\.)?/, "")}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.a ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.b ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right text-xs">
                    {r.a == null ? (
                      <span style={{ color: "var(--good)" }}>New</span>
                    ) : r.b == null ? (
                      <span style={{ color: "var(--bad)" }}>Dropped</span>
                    ) : r.change ? (
                      <span style={{ color: r.change > 0 ? "var(--good)" : "var(--bad)" }}>
                        {r.change > 0 ? "▲" : "▼"} {Math.abs(r.change)}
                      </span>
                    ) : (
                      <span className="text-muted">±0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : s.results.length ? (
        <ol className="mt-3 divide-y divide-border/60">
          {s.results.map((r) => {
            const own = tracked ? belongsTo(r.domain, tracked) : false;
            return (
              <li key={r.position} className={`flex gap-3 py-2.5 ${own ? "-mx-2 rounded-md bg-accent-soft px-2" : ""}`}>
                <span className="w-7 shrink-0 text-right text-sm font-semibold tabular-nums text-muted">{r.position}</span>
                <div className="min-w-0">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-accent hover:underline">
                    {r.title}
                  </a>
                  <div className="truncate text-xs" style={{ color: "var(--good)" }}>
                    {r.displayedUrl ?? r.url}
                    {own && <span className="ml-2 rounded-full border px-1.5 text-[11px] text-foreground">Your site</span>}
                  </div>
                  {r.snippet && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{r.snippet}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted">{s.status === "failed" ? "No results were saved." : "The search returned no organic results."}</p>
      )}
    </Card>
  );
}
