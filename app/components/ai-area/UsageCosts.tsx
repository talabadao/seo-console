"use client";

// Usage & Costs (AI Area). Keeps three kinds of figures apart and labels each:
// - provider-reported (account-wide: the SerpApi account, the OpenAI / Anthropic organisation, the DataForSEO
//   account), never shown as this project's allocation;
// - app-recorded (requests this app sent for this project, from the ledger);
// - estimated (USD from recorded tokens, with the pricing version).
// Units stay per provider: SerpApi searches are never added to model tokens or dollars.

import { useEffect, useState } from "react";
import type { UsageReport } from "@/lib/providers/usageReport";

const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(n < 1 ? 4 : 2)}`);
const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function useUsage(projectId: number, days: number, nonce = 0) {
  const [state, setState] = useState<{ key: string; report: UsageReport | null; error: string | null } | null>(null);
  const key = `${projectId}|${days}|${nonce}`;
  useEffect(() => {
    let live = true;
    fetch(`/api/ai-area/${projectId}/usage?days=${days}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
        if (live) setState({ key, report: body.report as UsageReport, error: null });
      })
      .catch((e) => live && setState({ key, report: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [key, projectId, days]);
  return state?.key === key ? state : null;
}

function Pill({ state }: { state: "live" | "unavailable" | "error" }) {
  const color = state === "live" ? "var(--good)" : state === "error" ? "var(--bad)" : "var(--muted)";
  const label = state === "live" ? "Provider-reported" : state === "error" ? "Error" : "Unavailable";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Compact line shown at the top of the AI Area screens. */
export function AiUsageSummary({ projectId, onOpen }: { projectId: number; onOpen: () => void }) {
  const s = useUsage(projectId, 30);
  const r = s?.report;
  const a = r?.serpapi.account.data;
  const left = a?.totalSearchesLeft ?? a?.planSearchesLeft ?? null;
  const p = r?.serpapi.policy;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border bg-surface px-4 py-2 text-xs text-muted">
      <span>
        <strong className="text-foreground">SerpApi account:</strong> {r ? (left != null ? `${fmt(left)} searches left` : (r.serpapi.account.message ?? "unavailable")) : "…"}
      </span>
      <span>
        <strong className="text-foreground">This project, 30 days:</strong> {r ? `${fmt(r.serpapi.recorded?.requests ?? 0)} SerpApi requests recorded` : "…"}
      </span>
      {p && (
        <span>
          <strong className="text-foreground">Limit:</strong> {p.allowed ? `${fmt(p.used)} of ${fmt(p.max)} used` : "SerpApi calls off here"}
        </span>
      )}
      <span>
        <strong className="text-foreground">Model spend (est.), 30 days:</strong>{" "}
        {r ? usd((r.openai.recorded?.estCostUsd ?? 0) + (r.anthropic.recorded?.estCostUsd ?? 0)) : "…"}
      </span>
      <button className="ml-auto text-accent hover:underline" onClick={onOpen}>
        Usage &amp; Costs
      </button>
    </div>
  );
}

export function UsageCostsPage({ projectId }: { projectId: number }) {
  const [days, setDays] = useState(30);
  const [nonce, setNonce] = useState(0);
  const s = useUsage(projectId, days, nonce);
  const r = s?.report;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <button className="rounded-md border bg-surface px-3 py-1.5 text-sm hover:bg-accent-soft" onClick={() => setNonce((n) => n + 1)}>
          Refresh
        </button>
        <p className="text-xs text-muted">
          Provider-reported figures cover the whole provider account. Recorded figures are what this app sent for this project. Estimates use pricing{" "}
          {r?.pricingVersion ?? "…"}.
        </p>
      </div>
      {!s ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !r ? (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {s.error}
        </p>
      ) : (
        <>
          {!r.ledger && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted">
              This database hasn&apos;t run migration 0003 yet, so nothing is recorded and paid provider calls from the AI Area are off.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border bg-surface p-4">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold">SerpApi</h2>
                <Pill state={r.serpapi.account.state} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Searches left (account)</dt>
                <dd className="tabular-nums">{fmt(r.serpapi.account.data?.totalSearchesLeft ?? r.serpapi.account.data?.planSearchesLeft)}</dd>
                <dt className="text-muted">Used this month (account)</dt>
                <dd className="tabular-nums">
                  {fmt(r.serpapi.account.data?.thisMonthUsage)} of {fmt(r.serpapi.account.data?.searchesPerMonth)}
                </dd>
                <dt className="text-muted">Recorded for this project</dt>
                <dd className="tabular-nums">
                  {fmt(r.serpapi.recorded?.requests ?? 0)} requests{r.serpapi.recorded?.failed ? ` (${r.serpapi.recorded.failed} failed)` : ""}
                </dd>
                <dt className="text-muted">Limit</dt>
                <dd>{r.serpapi.policy.allowed ? `${fmt(r.serpapi.policy.used)} of ${fmt(r.serpapi.policy.max)} used` : "Off here"}</dd>
              </dl>
              <p className="mt-2 text-xs text-muted">{r.serpapi.account.state === "live" ? r.serpapi.account.scope : r.serpapi.account.message}</p>
              <p className="mt-1 text-xs text-muted">{r.serpapi.policy.scope}.</p>
              <p className="mt-1 text-xs text-muted">
                Every request the app sends is counted, including retries and extra result pages. SerpApi doesn&apos;t charge for answers served from its own
                cache, so its account figure can be lower. No dollar estimate: the cost per search depends on your SerpApi plan.
              </p>
              {r.serpapi.account.fetchedAt ? <p className="mt-1 text-[11px] text-muted">Account checked {when(r.serpapi.account.fetchedAt)}.</p> : null}
            </section>

            <ModelCard title="OpenAI" recorded={r.openai.recorded} reported={r.openai.reported} amount={r.openai.reported.data ? usd(r.openai.reported.data.usd) : null} />
            <ModelCard
              title="Anthropic (Claude)"
              recorded={r.anthropic.recorded}
              reported={r.anthropic.reported}
              amount={r.anthropic.reported.data ? `${r.anthropic.reported.data.amount.toFixed(2)} ${r.anthropic.reported.data.currency}` : null}
            />

            <section className="rounded-xl border bg-surface p-4">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold">DataForSEO</h2>
                <Pill state={r.dataforseo.reported.state} />
              </div>
              {r.dataforseo.reported.data ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted">Balance (account)</dt>
                  <dd className="tabular-nums">{usd(r.dataforseo.reported.data.balance)}</dd>
                  <dt className="text-muted">Total spent (account)</dt>
                  <dd className="tabular-nums">{usd(r.dataforseo.reported.data.totalSpent)}</dd>
                </dl>
              ) : (
                <p className="text-sm text-muted">{r.dataforseo.reported.message}</p>
              )}
              <p className="mt-2 text-xs text-muted">Recorded for this project: {fmt(r.dataforseo.recorded?.requests ?? 0)} requests.</p>
            </section>
          </div>

          <section className="rounded-xl border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Model spending limit</h2>
            <p className="text-sm">{r.llmPolicy.allowed ? `${usd(r.llmPolicy.used)} of ${usd(r.llmPolicy.max)} estimated today` : r.llmPolicy.scope}</p>
            {r.llmPolicy.allowed && <p className="mt-1 text-xs text-muted">{r.llmPolicy.scope}. Each call&apos;s estimated cost is checked against it before the call.</p>}
          </section>

          <section className="rounded-xl border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Runs</h2>
            {r.runs.length ? (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-2 py-1.5 font-medium">Started</th>
                      <th className="px-2 py-1.5 font-medium">Kind</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 text-right font-medium">Estimated requests</th>
                      <th className="px-2 py-1.5 text-right font-medium">Requests sent</th>
                      <th className="px-2 py-1.5 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.runs.map((run) => {
                      const est = run.estimate as { total?: { min: number; max: number } } | null;
                      const act = run.actual as { searchesSent?: number } | null;
                      return (
                        <tr key={run.id} className="border-t border-border/60">
                          <td className="px-2 py-1.5">{when(run.startedAt)}</td>
                          <td className="px-2 py-1.5">{run.kind === "tracking" ? "Google Search Tracking" : run.kind === "brand" ? "Brand Mentions" : run.kind}</td>
                          <td className="px-2 py-1.5">{run.status}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{est?.total ? `${est.total.min}–${est.total.max}` : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmt(act?.searchesSent ?? null)}</td>
                          <td className="max-w-[24rem] truncate px-2 py-1.5 text-muted" title={run.error ?? ""}>
                            {run.error ?? ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">No runs in this period.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ModelCard({
  title,
  recorded,
  reported,
  amount,
}: {
  title: string;
  recorded: UsageReport["openai"]["recorded"];
  reported: UsageReport["openai"]["reported"] | UsageReport["anthropic"]["reported"];
  amount: string | null;
}) {
  return (
    <section className="rounded-xl border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Pill state={reported.state} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Provider-reported cost (organisation)</dt>
        <dd className="tabular-nums">{amount ?? "—"}</dd>
        <dt className="text-muted">Recorded calls (this project)</dt>
        <dd className="tabular-nums">
          {fmt(recorded?.requests ?? 0)}
          {recorded?.failed ? ` (${recorded.failed} failed)` : ""}
        </dd>
        <dt className="text-muted">Recorded tokens in / out</dt>
        <dd className="tabular-nums">
          {fmt(recorded?.inputTokens ?? 0)} / {fmt(recorded?.outputTokens ?? 0)}
        </dd>
        <dt className="text-muted">Estimated cost (this project)</dt>
        <dd className="tabular-nums">
          {usd(recorded?.estCostUsd ?? (recorded?.requests ? null : 0))}
          {recorded?.unpriced ? ` + ${recorded.unpriced} unpriced` : ""}
        </dd>
      </dl>
      <p className="mt-2 text-xs text-muted">{reported.state === "live" ? reported.scope : reported.message}</p>
    </section>
  );
}
