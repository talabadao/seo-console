"use client";

// Usage & Costs (Settings → Account → Usage & Costs; also the compact line on AI Area screens and the project
// figure in Project settings → Budgets). One report, account-wide or filtered to a project. Keeps three kinds
// of figures apart and labels each:
// - provider-reported: the provider's own account figures (whole SerpApi account, OpenAI / Anthropic
//   organisation, DataForSEO account) — never shown as a project's share;
// - app-recorded: requests this app sent, for the account or the filtered project, attributed per project;
// - estimated: USD from recorded tokens, with the pricing version.
// Units stay per provider: SerpApi requests are never added to model tokens or dollars.

import { useEffect, useState } from "react";
import type { Project } from "../ProjectManager";
import type { UsageReport } from "@/lib/providers/usageReport";
import type { LimitLine } from "@/lib/providers/ledger";
import { Card, buttonClass } from "./ui";

const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(n !== 0 && Math.abs(n) < 1 ? 4 : 2)}`);
const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function useUsage(projectId: number | null, days: number, nonce = 0) {
  const [state, setState] = useState<{ key: string; report: UsageReport | null; error: string | null } | null>(null);
  const key = `${projectId ?? "all"}|${days}|${nonce}`;
  useEffect(() => {
    let live = true;
    fetch(`/api/account/usage?days=${days}&project=${projectId ?? "all"}`, { cache: "no-store" })
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

function Limits({ lines, unit, empty }: { lines: LimitLine[]; unit: "requests" | "USD"; empty: string }) {
  if (!lines.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ul className="space-y-1 text-xs">
      {lines.map((l) => {
        const pct = l.max > 0 ? Math.min(100, (l.used / l.max) * 100) : 100;
        return (
          <li key={l.label}>
            <div className="flex justify-between gap-2">
              <span className="text-muted">{l.label}</span>
              <span className="tabular-nums">{unit === "USD" ? `${usd(l.used)} used · ${usd(l.left)} left` : `${fmt(l.used)} used · ${fmt(l.left)} left`}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-border/60" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? "var(--bad)" : "var(--accent)" }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact line shown at the top of AI Area screens: allowance warning plus a link to Settings. */
export function AiUsageSummary({ projectId, onOpen }: { projectId: number; onOpen: () => void }) {
  const s = useUsage(projectId, 30);
  const r = s?.report;
  const a = r?.serpapi.account.data;
  const left = a?.totalSearchesLeft ?? a?.planSearchesLeft ?? null;
  const p = r?.serpapi.policy;
  const tight = p?.limits.length ? p.limits.reduce((x, y) => (y.left < x.left ? y : x)) : null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border bg-surface px-4 py-2 text-xs text-muted">
      <span>
        <strong className="text-foreground">SerpApi account:</strong> {r ? (left != null ? `${fmt(left)} searches left` : (r.serpapi.account.message ?? "unavailable")) : "…"}
      </span>
      <span>
        <strong className="text-foreground">This project, 30 days:</strong> {r ? `${fmt(r.serpapi.recorded?.requests ?? 0)} SerpApi requests recorded` : "…"}
      </span>
      {p && (
        <span style={{ color: tight && tight.left <= 0 ? "var(--bad)" : undefined }}>
          <strong className="text-foreground">Allowance:</strong> {!p.allowed ? "SerpApi calls off here" : tight ? `${fmt(tight.left)} requests left (${tight.label})` : "no limit set"}
        </span>
      )}
      <button className="ml-auto text-accent hover:underline" onClick={onOpen}>
        Manage usage and budget
      </button>
    </div>
  );
}

export function UsageCostsPage({
  projectId: initialProject,
  projects,
  onOpenBudgets,
}: {
  /** Pre-selected filter (the project open when Settings was reached); null = all projects. */
  projectId: number | null;
  projects: Project[];
  onOpenBudgets: () => void;
}) {
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<number | null>(initialProject);
  const [nonce, setNonce] = useState(0);
  const s = useUsage(filter, days, nonce);
  const r = s?.report;
  const scopeLabel = filter == null ? "all your projects" : (projects.find((p) => p.id === filter)?.name ?? "this project");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filter ?? "all"}
          onChange={(e) => setFilter(e.target.value === "all" ? null : Number(e.target.value))}
          aria-label="Project"
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">All projects (account)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <button className={buttonClass} onClick={() => setNonce((n) => n + 1)}>
          Refresh
        </button>
        <button className={`${buttonClass} ml-auto`} onClick={onOpenBudgets}>
          Budgets &amp; limits
        </button>
      </div>
      <p className="text-xs text-muted">
        <strong className="text-foreground">Provider-reported</strong> figures cover the whole provider account or organisation.{" "}
        <strong className="text-foreground">Recorded</strong> figures are what SEO Console sent for {scopeLabel}. <strong className="text-foreground">Estimated</strong>{" "}
        costs use pricing {r?.pricingVersion ?? "…"}; they aren&apos;t bills.
      </p>
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
          {r.serpapi.previewTest && (
            <p className="rounded-md border px-3 py-2 text-xs text-muted">
              Preview: SerpApi runs only for the smoke-test project
              {r.serpapi.previewTest.projectId ? ` (${projects.find((p) => p.id === r.serpapi.previewTest!.projectId)?.name ?? `#${r.serpapi.previewTest.projectId}`})` : " (none chosen)"}, at most{" "}
              {r.serpapi.previewTest.max} requests in total — {fmt(r.serpapi.previewTest.used)} used so far. Paid model calls are off.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border bg-surface p-4">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold">SerpApi</h2>
                <Pill state={r.serpapi.account.state} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Searches left (provider account)</dt>
                <dd className="tabular-nums">{fmt(r.serpapi.account.data?.totalSearchesLeft ?? r.serpapi.account.data?.planSearchesLeft)}</dd>
                <dt className="text-muted">Used this month (provider account)</dt>
                <dd className="tabular-nums">
                  {fmt(r.serpapi.account.data?.thisMonthUsage)} of {fmt(r.serpapi.account.data?.searchesPerMonth)}
                </dd>
                <dt className="text-muted">Recorded ({scopeLabel})</dt>
                <dd className="tabular-nums">
                  {fmt(r.serpapi.recorded?.requests ?? 0)} requests{r.serpapi.recorded?.failed ? ` (${r.serpapi.recorded.failed} failed)` : ""}
                </dd>
              </dl>
              <p className="mt-2 text-xs text-muted">{r.serpapi.account.state === "live" ? r.serpapi.account.scope : r.serpapi.account.message}</p>
              <h3 className="mt-3 text-xs font-semibold">Limits</h3>
              {r.serpapi.policy.allowed ? (
                <Limits lines={r.serpapi.policy.limits} unit="requests" empty={r.serpapi.policy.scope} />
              ) : (
                <p className="text-xs text-muted">{r.serpapi.policy.scope}</p>
              )}
              <p className="mt-2 text-xs text-muted">
                Every request is counted, including retries and extra result pages. SerpApi doesn&apos;t charge for answers served from its own cache, so its own
                figure can be lower. No dollar estimate: the cost per search depends on your SerpApi plan.
              </p>
              {r.serpapi.account.fetchedAt ? <p className="mt-1 text-[11px] text-muted">Account checked {when(r.serpapi.account.fetchedAt)}.</p> : null}
            </section>

            <ModelCard title="OpenAI" scopeLabel={scopeLabel} recorded={r.openai.recorded} reported={r.openai.reported} amount={r.openai.reported.data ? usd(r.openai.reported.data.usd) : null} />
            <ModelCard
              title="Anthropic (Claude)"
              scopeLabel={scopeLabel}
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
                  <dt className="text-muted">Balance (provider account)</dt>
                  <dd className="tabular-nums">{usd(r.dataforseo.reported.data.balance)}</dd>
                  <dt className="text-muted">Total spent (provider account)</dt>
                  <dd className="tabular-nums">{usd(r.dataforseo.reported.data.totalSpent)}</dd>
                </dl>
              ) : (
                <p className="text-sm text-muted">{r.dataforseo.reported.message}</p>
              )}
              <p className="mt-2 text-xs text-muted">Recorded ({scopeLabel}): {fmt(r.dataforseo.recorded?.requests ?? 0)} requests. No DataForSEO data module is connected yet.</p>
            </section>
          </div>

          <Card title="Model spending (estimated)">
            {r.llmPolicy.allowed ? (
              <Limits lines={r.llmPolicy.limits} unit="USD" empty={r.llmPolicy.scope} />
            ) : (
              <p className="text-sm text-muted">{r.llmPolicy.scope}</p>
            )}
            <div className="mt-3">
              <p className="text-xs font-medium text-muted">Last 14 days, all your projects (estimated from recorded tokens)</p>
              <div className="mt-1 flex h-16 items-end gap-1" role="img" aria-label="Estimated model spend per day, last 14 days">
                {r.modelDays.map((d) => {
                  const max = Math.max(0.01, ...r.modelDays.map((x) => x.totalUsd));
                  return (
                    <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${usd(d.totalUsd)} (${d.calls} calls)`}>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(2, (d.totalUsd / max) * 100)}%`, background: d.totalUsd ? "var(--accent)" : "var(--border)" }} />
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          {filter == null && (
            <Card title="By project (recorded)">
              {r.byProject.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="px-2 py-1.5 font-medium">Project</th>
                        <th className="px-2 py-1.5 text-right font-medium">SerpApi requests</th>
                        <th className="px-2 py-1.5 text-right font-medium">Model calls</th>
                        <th className="px-2 py-1.5 text-right font-medium">Estimated model cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byProject.map((p) => (
                        <tr key={p.projectId ?? "none"} className="border-t border-border/60">
                          <td className="px-2 py-1.5">
                            {p.projectId != null && projects.some((x) => x.id === p.projectId) ? (
                              <button className="text-accent hover:underline" onClick={() => setFilter(p.projectId)}>
                                {p.projectName}
                              </button>
                            ) : (
                              p.projectName
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {fmt(p.serpRequests)}
                            {p.serpFailed ? ` (${p.serpFailed} failed)` : ""}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmt(p.modelCalls)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {usd(p.estCostUsd ?? (p.modelCalls ? null : 0))}
                            {p.unpriced ? ` + ${p.unpriced} unpriced` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted">Nothing recorded in this period.</p>
              )}
            </Card>
          )}

          <Card title="Runs">
            {r.runs.length ? (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-2 py-1.5 font-medium">Started</th>
                      {filter == null && <th className="px-2 py-1.5 font-medium">Project</th>}
                      <th className="px-2 py-1.5 font-medium">Kind</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 text-right font-medium">Estimated requests</th>
                      <th className="px-2 py-1.5 text-right font-medium">Requests sent</th>
                      <th className="px-2 py-1.5 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.runs.map((run) => {
                      const est = run.estimate as { total?: { min: number; max: number }; serpRequests?: { min: number; max: number } } | null;
                      const range = est?.total ?? est?.serpRequests;
                      const act = run.actual as { searchesSent?: number; serpRequests?: number } | null;
                      return (
                        <tr key={run.id} className="border-t border-border/60">
                          <td className="px-2 py-1.5">{when(run.startedAt)}</td>
                          {filter == null && <td className="px-2 py-1.5">{run.projectName || `#${run.projectId}`}</td>}
                          <td className="px-2 py-1.5">{run.kind === "tracking" ? "Google Search Tracking" : run.kind === "brand" ? "Brand Mentions" : run.kind}</td>
                          <td className="px-2 py-1.5">{run.status}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{range ? `${range.min}–${range.max}` : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmt(act?.searchesSent ?? act?.serpRequests ?? null)}</td>
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
          </Card>
        </>
      )}
    </div>
  );
}

function ModelCard({
  title,
  scopeLabel,
  recorded,
  reported,
  amount,
}: {
  title: string;
  scopeLabel: string;
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
        <dt className="text-muted">Recorded calls ({scopeLabel})</dt>
        <dd className="tabular-nums">
          {fmt(recorded?.requests ?? 0)}
          {recorded?.failed ? ` (${recorded.failed} failed)` : ""}
        </dd>
        <dt className="text-muted">Recorded tokens in / out</dt>
        <dd className="tabular-nums">
          {fmt(recorded?.inputTokens ?? 0)} / {fmt(recorded?.outputTokens ?? 0)}
        </dd>
        <dt className="text-muted">Estimated cost ({scopeLabel})</dt>
        <dd className="tabular-nums">
          {usd(recorded?.estCostUsd ?? (recorded?.requests ? null : 0))}
          {recorded?.unpriced ? ` + ${recorded.unpriced} unpriced` : ""}
        </dd>
      </dl>
      <p className="mt-2 text-xs text-muted">{reported.state === "live" ? reported.scope : reported.message}</p>
    </section>
  );
}
