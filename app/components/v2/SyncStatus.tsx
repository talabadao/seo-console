"use client";

// Account settings → Sync & cache: what the shared cache holds for this account and how the background
// refreshes are doing — last successful fetch, data-through date, next refresh, queued/running/failed jobs,
// provider requests and retries, cache hits and misses, active provider cool-downs. Reads local records every
// 15 seconds while open; never polls a provider. Paid usage lives in Usage & Costs.

import { useEffect, useState } from "react";
import type { SyncStatus as BaseStatus } from "@/lib/sync/status";
import type { CronRunRow } from "@/lib/cronRuns";
import type { DatabaseStatus } from "@/lib/dbStatus";

type Status = BaseStatus & { cronRuns?: CronRunRow[] | null; database?: DatabaseStatus };
import { Card, buttonClass } from "./ui";

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const pct = (a: number, b: number) => (a + b ? `${Math.round((a / (a + b)) * 100)}%` : "—");

export function SyncStatusPage({ projectId, onOpenUsage }: { projectId: number | null; onOpenUsage: () => void }) {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const [onlyProject, setOnlyProject] = useState(projectId != null);

  useEffect(() => {
    let live = true;
    const tick = () =>
      fetch("/api/account/sync", { cache: "no-store" })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!live) return;
          if (!r.ok) return setError(body.error ?? `Couldn't load sync status (status ${r.status}).`);
          setData(body as Status);
          setError(null);
        })
        .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    void tick();
    const t = setInterval(() => document.visibilityState === "visible" && void tick(), 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [nonce]);

  async function runNow() {
    setRunning("Running queued refreshes…");
    const res = await fetch("/api/account/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 10 }) });
    const body = (await res.json().catch(() => ({}))) as { ran?: number; outcomes?: Record<string, number>; error?: string };
    setRunning(res.ok ? `Ran ${body.ran ?? 0} job${body.ran === 1 ? "" : "s"}${body.outcomes ? ` (${Object.entries(body.outcomes).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""}.` : (body.error ?? "Couldn't run jobs."));
    setNonce((n) => n + 1);
  }

  if (error && !data) {
    return (
      <Card title="Sync & cache">
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card title="Sync & cache">
        <p className="text-sm text-muted">Loading…</p>
      </Card>
    );
  }
  const entries = onlyProject && projectId != null ? data.entries.filter((e) => e.projectId === projectId) : data.entries;
  const hits = data.byProvider.reduce((a, p) => a + p.hits, 0);
  const misses = data.byProvider.reduce((a, p) => a + p.misses, 0);
  return (
    <>
      <Card
        title="Sync & cache"
        actions={
          <button className={buttonClass} onClick={runNow} disabled={running === "Running queued refreshes…"}>
            Run queued refreshes now
          </button>
        }
      >
        <p className="text-sm text-muted">
          Dashboards read saved results first. A result past its refresh time is still shown, with its time, while one background refresh runs; nothing
          asks a provider again until then. Shared by every server instance; only this account&apos;s data.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted">Queued / running</dt>
          <dd className="tabular-nums">
            {data.jobs.queued} / {data.jobs.running}
          </dd>
          <dt className="text-muted">Failed (7 days)</dt>
          <dd className="tabular-nums">{data.jobs.failed}</dd>
          <dt className="text-muted">Provider requests (7 days)</dt>
          <dd className="tabular-nums">{data.jobs.providerRequests.toLocaleString("en-US")}</dd>
          <dt className="text-muted">Retries (7 days)</dt>
          <dd className="tabular-nums">{data.jobs.retries}</dd>
          <dt className="text-muted">Cache hit ratio</dt>
          <dd className="tabular-nums">
            {pct(hits, misses)} <span className="text-xs text-muted">({hits.toLocaleString("en-US")} hits, {misses.toLocaleString("en-US")} misses)</span>
          </dd>
        </dl>
        {running && (
          <p role="status" className="mt-2 text-xs text-muted">
            {running}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          Paid provider usage (SerpApi, OpenAI, Anthropic, DataForSEO) is in{" "}
          <button className="text-accent hover:underline" onClick={onOpenUsage}>
            Usage &amp; Costs
          </button>
          . Scheduled refreshes run on Production only; on Preview use &ldquo;Run queued refreshes now&rdquo;.
        </p>
      </Card>

      <Card title="By provider">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-2 py-1.5 font-medium">Provider</th>
                <th className="px-2 py-1.5 text-right font-medium">Jobs</th>
                <th className="px-2 py-1.5 text-right font-medium">Failed</th>
                <th className="px-2 py-1.5 text-right font-medium">Requests</th>
                <th className="px-2 py-1.5 text-right font-medium">Retries</th>
                <th className="px-2 py-1.5 text-right font-medium">Hit ratio</th>
              </tr>
            </thead>
            <tbody>
              {data.byProvider.map((p) => (
                <tr key={p.provider} className="border-t border-border/60">
                  <td className="px-2 py-1.5">{p.provider}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.jobs}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.failed}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.providerRequests}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.retries}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(p.hits, p.misses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.cooldowns.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Waiting on provider limits: {data.cooldowns.map((c) => `${c.bucket} until ${when(c.until)}${c.reason ? ` (${c.reason})` : ""}`).join("; ")}.
          </p>
        )}
      </Card>

      {data.database && (
        <Card title="Database">
          <p className="text-sm">
            {data.database.environment === "production" ? "Production" : data.database.environment === "preview" ? "Preview (its own database)" : "Development"} ·{" "}
            {data.database.applied == null
              ? "no migration history recorded"
              : `latest migration ${data.database.applied[data.database.applied.length - 1] ?? "none"} (${data.database.applied.length} recorded)`}
          </p>
          <p className="mt-1 text-xs text-muted">
            {data.database.pending.length
              ? `Not applied yet: ${data.database.pending.join(", ")}. Features that need them stay off until they are.`
              : "Every migration this version knows about is applied."}
          </p>
        </Card>
      )}

      <Card title="Scheduled runs">
        {data.cronRuns == null ? (
          <p className="text-sm text-muted">Run history isn&apos;t recorded on this database yet (migration 0012).</p>
        ) : data.cronRuns.length === 0 ? (
          <p className="text-sm text-muted">No authenticated scheduled run recorded yet. Scheduled runs happen on Production only.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-2 py-1.5 font-medium">Started</th>
                  <th className="px-2 py-1.5 font-medium">Job</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 text-right font-medium">Processed</th>
                  <th className="px-2 py-1.5 text-right font-medium">Queued</th>
                  <th className="px-2 py-1.5 text-right font-medium">Skipped</th>
                  <th className="px-2 py-1.5 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.cronRuns.map((r) => (
                  <tr key={r.id} className="border-t border-border/60 align-top">
                    <td className="px-2 py-1.5">{when(r.startedAt)}</td>
                    <td className="px-2 py-1.5">{r.job}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {r.status === "ok" ? (r.processed || r.queued ? "OK" : "OK, nothing due") : r.status === "running" ? "Running or stopped" : <span style={{ color: "var(--bad)" }} title={r.error ?? undefined}>Error{r.error ? `: ${r.error}` : ""}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.processed}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.queued}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.skipped}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.durationMs == null ? "—" : `${(r.durationMs / 1000).toFixed(1)} s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Only authenticated runs from Vercel Cron are recorded; a refused request leaves no row. Kept for 60 days.</p>
      </Card>

      <Card
        title="Saved results"
        actions={
          projectId != null ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={onlyProject} onChange={(e) => setOnlyProject(e.target.checked)} />
              This project only
            </label>
          ) : undefined
        }
      >
        {entries.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-2 py-1.5 font-medium">Result</th>
                  <th className="px-2 py-1.5 font-medium">Project</th>
                  <th className="px-2 py-1.5 font-medium">Last successful fetch</th>
                  <th className="px-2 py-1.5 font-medium">Data through</th>
                  <th className="px-2 py-1.5 font-medium">Next refresh</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className="border-t border-border/60 align-top">
                    <td className="px-2 py-1.5">{e.label}</td>
                    <td className="px-2 py-1.5">{e.projectName ?? "—"}</td>
                    <td className="px-2 py-1.5">{when(e.fetchedAt)}</td>
                    <td className="px-2 py-1.5">{e.dataThrough ?? "—"}</td>
                    <td className="px-2 py-1.5">{e.dueAt ? (e.dueAt < data.generatedAt ? "due now" : when(e.dueAt)) : "—"}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {e.accessError ? (
                        <span style={{ color: "var(--bad)" }}>No access: {e.accessError}</span>
                      ) : e.job ? (
                        <span>
                          {e.job.status === "running" ? "Refreshing" : `Queued${e.job.runAfter > data.generatedAt ? ` until ${when(e.job.runAfter)}` : ""}`} ({e.job.reason})
                          {e.job.error ? <span className="block text-muted">Last try: {e.job.error}</span> : null}
                        </span>
                      ) : e.lastError ? (
                        <span title={e.lastError} style={{ color: "var(--bad)" }}>
                          Last refresh failed
                        </span>
                      ) : (
                        <span className="text-muted">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Nothing saved yet. Results appear here after dashboards are opened.</p>
        )}
      </Card>
    </>
  );
}
