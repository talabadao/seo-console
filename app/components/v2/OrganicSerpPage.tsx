"use client";

// Rank tracking → Organic SERP → archive: the multi-engine (Google, Bing, Yandex, Naver) snapshots saved before
// Organic SERP became Google Search Tracking. Read-only: snapshots open from the database and two snapshots of the
// same search can be compared; nothing here searches. Results are normalized text; provider HTML is never embedded.

import { useEffect, useMemo, useState } from "react";
import { ENGINES, ENGINE_IDS, belongsTo, diffSnapshots, type EngineId, type SerpParams } from "@/lib/organicSerp/engines";
import type { Snapshot, SnapshotSummary } from "@/lib/organicSerp/store";
import { fmtTime } from "./summaryUi";
import { Card, EmptyState, ErrorState, LoadingState } from "./ui";

interface Overview {
  trackedDomain: string | null;
  demo: boolean;
  snapshots: SnapshotSummary[];
}

const describe = (s: { engine: EngineId; params: SerpParams }) =>
  [ENGINES[s.engine].label, s.params.location, s.params.country?.toUpperCase(), s.params.language, s.params.yandexDomain, s.params.region && `lr ${s.params.region}`, s.params.device]
    .filter(Boolean)
    .join(" · ");

/**
 * The superseded multi-engine Organic SERP (16 Oct 2026), kept as a read-only archive: saved Google, Bing, Yandex
 * and Naver snapshots open and compare from the database. New searches happen in Organic SERP (Google Search
 * Tracking); nothing here can start a search or spend SerpApi requests.
 */
export function OrganicSerpPage({ projectId, onBack }: { projectId: number; engine?: string; readOnly?: boolean; onEngine?: (e: string) => void; onBack?: () => void; onOpenUsage?: () => void; onOpenBudgets?: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineId | "all">("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [compare, setCompare] = useState<Snapshot | null>(null);

  useEffect(() => {
    fetch(`/api/v2/organic-serp/${projectId}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
        setOverview(body as Overview);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [projectId]);

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

  const history = useMemo(() => (overview?.snapshots ?? []).filter((s) => engine === "all" || s.engine === engine), [overview, engine]);

  if (loadError) return <ErrorState title="Couldn't load the archive." body={loadError} />;
  if (!overview) return <LoadingState label="Loading archive…" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Read-only archive of the multi-engine searches saved before Organic SERP became Google Search Tracking (17 Oct 2026). Opening a snapshot reads it
        from the database and never searches again; no new searches can be started here.{" "}
        {onBack && (
          <button className="text-accent hover:underline" onClick={onBack}>
            Back to Organic SERP
          </button>
        )}
      </p>
      <div role="radiogroup" aria-label="Engine" className="flex flex-wrap gap-1 border-b">
        {(["all", ...ENGINE_IDS] as const).map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={id === engine}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${id === engine ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            onClick={() => setEngine(id)}
          >
            {id === "all" ? "All engines" : ENGINES[id].label}
          </button>
        ))}
      </div>

      {snapshot ? (
        <SnapshotView
          snapshot={snapshot}
          trackedDomain={overview.trackedDomain}
          candidates={overview.snapshots.filter(
            (s) => s.id !== snapshot.id && s.engine === snapshot.engine && s.params.query.toLowerCase() === snapshot.params.query.toLowerCase() && s.status !== "failed",
          )}
          compare={compareId != null && compare?.id === compareId ? compare : null}
          compareId={compareId}
          onCompare={(id) => {
            setCompareId(id);
            if (id == null) setCompare(null);
          }}
        />
      ) : null}

      <Card title="Archived snapshots">
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
                      {s.status === "done" ? "Done" : s.status === "partial" ? <span style={{ color: "var(--bad)" }}>Partial</span> : <span style={{ color: "var(--bad)" }}>{s.status === "running" ? "Interrupted" : "Failed"}</span>}
                      {s.demo ? " · Demo" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nothing archived." body="No multi-engine searches were saved for this project." />
        )}
      </Card>
    </div>
  );
}

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
