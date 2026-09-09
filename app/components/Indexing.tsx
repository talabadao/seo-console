"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { fmt } from "./format";

interface IndexUrlRow {
  url: string;
  clicks: number;
  impressions: number;
  status: string | null;
  stateLabel: string;
  indexed: boolean;
  atRisk: boolean;
  lastCrawl: string | null;
  richResults: string | null;
  richVerdict: string | null;
  lastInspection: number | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  crawledAs: string | null;
  submittedAt: number | null;
  submitResult: string | null;
  submittable: boolean;
  unknownToGoogle: boolean;
  requestIndexingUrl: string;
}

interface IndexData {
  total: number;
  inspected: number;
  indexed: number;
  notIndexed: number;
  pctIndexed: number;
  submittableCount: number;
  atRiskCount: number;
  urls: IndexUrlRow[];
  stateBreakdown: { label: string; count: number; color: string }[];
  stateHistory: { date: string; states: Record<string, number> | null; indexed: number; notIndexed: number }[];
  movements: {
    changedAt: number;
    url: string;
    before: string | null;
    after: string | null;
    indexingChange: number;
    firstSeen: number | null;
    recentlyPublished: boolean;
  }[];
  job: { status: string; checked: number; message: string | null; finished_at: number | null } | null;
  quotaLeft: number;
  dailyCap: number;
  submitQuotaLeft: number;
  indexing: {
    configured: boolean;
    serviceAccount: boolean;
    hasScope: boolean;
    permissionLevel: string | null;
    isOwner: boolean;
  };
}

const PAGE_SIZES = [25, 50, 100, 250];

export function Indexing({ property }: { property: string }) {
  const [data, setData] = useState<IndexData | null>(null);
  const [tab, setTab] = useState<"all" | "indexed" | "not" | "risk">("all");
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [reconnect, setReconnect] = useState(false);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!property) return;
    const res = await fetch(`/api/index?property=${encodeURIComponent(property)}`);
    if (res.ok) setData(await res.json());
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(discover: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/index/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property, discover, sitemapUrl: sitemapUrl.trim() || undefined }),
      });
      const j = await res.json();
      setMsg(
        res.ok
          ? `${j.discovered != null ? `Discovered ${j.discovered} URLs. ` : ""}Inspected ${j.checked}. Quota left: ${j.quotaLeft}.${j.message ? ` (${j.message})` : ""}`
          : (j.error ?? "Failed"),
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function submit(all: string[]) {
    const urls = [...new Set(all)];
    if (!urls.length) return;
    setSubmitting(urls.length === 1 ? urls[0] : "bulk");
    setMsg(null);

    // The API takes 100 URLs per request — send in chunks.
    const chunks: string[][] = [];
    for (let i = 0; i < urls.length; i += 100) chunks.push(urls.slice(i, i + 100));

    let submitted = 0;
    let failed = 0;
    let skipped = 0;
    let quotaLeft = data?.submitQuotaLeft ?? 0;
    let firstFail = "";
    let stopReason: "reconnect" | "owner" | "quota" | null = null;

    try {
      for (const chunk of chunks) {
        const res = await fetch("/api/index/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ property, urls: chunk }),
        });
        const j = await res.json();
        if (!res.ok) {
          setMsg(j.error ?? "Submit failed");
          break;
        }
        submitted += j.submitted ?? 0;
        failed += j.failed ?? 0;
        skipped += j.skipped ?? 0;
        quotaLeft = j.quotaLeft ?? quotaLeft;
        if (!firstFail) {
          firstFail =
            j.results?.find((r: { ok: boolean; message: string }) => !r.ok)?.message ?? "";
        }
        if (j.needsReconnect) stopReason = "reconnect";
        else if (j.notOwner) stopReason = "owner";
        else if (skipped > 0) stopReason = "quota";
        if (stopReason) break;
      }

      setReconnect(stopReason === "reconnect");
      if (stopReason === "reconnect") {
        setMsg("Not authorised — reconnect Google to grant the Indexing permission.");
      } else if (stopReason === "owner") {
        setMsg(firstFail || "This Google account isn't an Owner of the property.");
      } else {
        setMsg(
          `Submitted ${submitted}` +
            (failed ? `, ${failed} failed (${firstFail})` : "") +
            (skipped ? `, ${skipped} left for tomorrow (daily quota)` : "") +
            `. Indexing quota left today: ${quotaLeft}.`,
        );
      }
      await load();
    } finally {
      setSubmitting(null);
    }
  }

  const filtered = useMemo(() => {
    let r = data?.urls ?? [];
    if (tab === "indexed") r = r.filter((x) => x.indexed);
    if (tab === "not") r = r.filter((x) => x.lastInspection && !x.indexed);
    if (tab === "risk") r = r.filter((x) => x.atRisk);
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.url.toLowerCase().includes(needle));
    return r;
  }, [data, tab, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage(1);
  }, [tab, q, pageSize]);

  const chartData = (data?.stateHistory ?? []).map((h) => ({
    label: format(parseISO(h.date), "MMM d"),
    ...(h.states ?? { Indexed: h.indexed, "Not indexed": h.notIndexed }),
  }));
  const chartKeys = data?.stateBreakdown.length
    ? data.stateBreakdown.map((s) => s.label)
    : ["Indexed", "Not indexed"];

  // Submit only makes sense with the scope granted AND Owner-level access.
  const submitAllowed =
    !data ||
    (data.indexing.hasScope !== false && data.indexing.isOwner !== false);

  return (
    <div>
      {/* controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border p-0.5 text-sm">
          {(
            [
              ["all", "All"],
              ["indexed", `${data?.indexed ?? 0} Indexed`],
              ["not", `${data?.notIndexed ?? 0} Not indexed`],
              ["risk", `${data?.atRiskCount ?? 0} At risk`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded px-3 py-1 ${tab === id ? "bg-accent text-white" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Donut pct={data?.pctIndexed ?? 0} />
        <span className="text-sm text-muted">
          {data ? `${data.pctIndexed}% of ${data.total} known URLs indexed` : "…"}
          {data && data.inspected < data.total
            ? ` · ${data.total - data.inspected} not yet inspected`
            : ""}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <input
            value={sitemapUrl}
            onChange={(e) => setSitemapUrl(e.target.value)}
            placeholder="optional sitemap URL"
            className="w-48 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => run(true)}
            disabled={busy || !property}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-50"
          >
            {busy ? "Working…" : "Discover + check"}
          </button>
          <button
            onClick={() => run(false)}
            disabled={busy || !property}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-50"
          >
            Run check
          </button>
          <button
            onClick={() =>
              submit(
                (data?.urls ?? [])
                  .filter((u) => u.submittable && u.submitResult !== "ok")
                  .map((u) => u.url),
              )
            }
            disabled={submitting === "bulk" || !data?.submittableCount || !submitAllowed}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            title={
              submitAllowed
                ? ""
                : data?.indexing.hasScope === false
                  ? "Reconnect Google to grant the Indexing permission"
                  : "You must be an Owner of this property in Search Console"
            }
          >
            {submitting === "bulk"
              ? "Submitting…"
              : `Submit Index Now (${Math.min(data?.submittableCount ?? 0, data?.submitQuotaLeft ?? 0)}${
                  (data?.submittableCount ?? 0) > (data?.submitQuotaLeft ?? 0)
                    ? ` of ${data?.submittableCount}`
                    : ""
                })`}
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 rounded-lg border bg-surface p-3 text-sm">{msg}</div>}

      {data?.indexing.hasScope === false || reconnect ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          <span>
            <strong>Submit to Index isn&apos;t authorised.</strong> Enable{" "}
            <strong>Web Search Indexing API</strong> in Google Cloud and add the{" "}
            <code>.../auth/indexing</code> scope on the OAuth consent screen, then reconnect.
          </span>
          <a
            href="/api/auth/google"
            className="rounded-md bg-bad px-3 py-1.5 text-xs font-semibold text-white"
          >
            Reconnect Google
          </a>
        </div>
      ) : data && data.indexing.isOwner === false ? (
        <div className="mb-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          <strong>Submit to Index needs Owner access.</strong> Your Search Console role for
          this property is{" "}
          <code>{data.indexing.permissionLevel ?? "unknown"}</code>, not{" "}
          <code>siteOwner</code>. In Search Console → Settings → Users and permissions, have an
          owner set your role to <strong>Owner</strong> — or add &amp; verify the site under
          your own account. (Inspection and everything else still works.)
        </div>
      ) : null}
      {data && (
        <div className="mb-2 text-xs text-muted">
          Inspection quota left today: {data.quotaLeft}/{data.dailyCap} · Indexing submissions
          left: {data.submitQuotaLeft}
          {data.job?.finished_at
            ? ` · last check ${format(data.job.finished_at, "MMM d HH:mm")} (${data.job.checked} URLs)`
            : ""}
        </div>
      )}

      {/* coverage-state stacked chart */}
      <div className="rounded-xl border bg-surface p-4">
        {chartData.length ? (
          <>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted)" }} />
                  <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  {chartKeys.map((k) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="a"
                      fill={data?.stateBreakdown.find((s) => s.label === k)?.color ?? "#9aa0a6"}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {(data?.stateBreakdown ?? []).map((s) => (
                <span key={s.label} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label} <span className="text-muted">{s.count}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted">
            No index history yet. Run a check to start tracking.
          </p>
        )}
      </div>

      {/* PAGES table */}
      <div className="mt-4 rounded-xl border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <strong className="text-sm">PAGES</strong>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter URLs…"
            className="min-w-40 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
          />
          <span className="text-sm text-muted">{filtered.length} URLs</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[36rem] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-surface text-left text-muted">
              <tr className="border-b">
                <th className="px-4 py-2.5 font-medium">URL</th>
                <th className="px-4 py-2.5 text-right font-medium">Clicks 30d</th>
                <th className="px-4 py-2.5 text-right font-medium">Impr 30d</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last crawl</th>
                <th className="px-4 py-2.5 font-medium">Rich results</th>
                <th className="px-4 py-2.5 font-medium">Last inspection</th>
                <th className="px-4 py-2.5 font-medium">Submit</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RowGroup
                  key={r.url}
                  r={r}
                  open={expanded === r.url}
                  onToggle={() => setExpanded(expanded === r.url ? null : r.url)}
                  onSubmit={() => submit([r.url])}
                  submitting={submitting === r.url}
                  scopeOk={submitAllowed}
                />
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    No URLs. Click “Discover + check”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-sm">
            <span className="text-muted">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of{" "}
              {filtered.length}
            </span>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded border px-2 py-0.5 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              {page} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page === pageCount}
              className="rounded border px-2 py-0.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <RecentMovements movements={data?.movements ?? []} />
    </div>
  );
}

function Donut({ pct }: { pct: number }) {
  const color = pct >= 80 ? "var(--good)" : pct >= 50 ? "var(--position)" : "var(--bad)";
  return (
    <div
      className="grid h-9 w-9 place-items-center rounded-full text-[10px] font-semibold"
      style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, var(--border) 0deg)` }}
    >
      <span className="grid h-7 w-7 place-items-center rounded-full bg-surface">{pct}%</span>
    </div>
  );
}

function StatusPill({ r }: { r: IndexUrlRow }) {
  const color = r.indexed ? "var(--good)" : r.lastInspection ? "var(--bad)" : "var(--muted)";
  return (
    <span className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span style={{ color }}>{r.status ?? (r.lastInspection ? "—" : "not inspected")}</span>
        {r.atRisk && (
          <span className="rounded bg-bad/15 px-1 text-[10px] font-semibold text-bad">AT RISK</span>
        )}
      </span>
      {!r.indexed && (
        <a
          href={r.requestIndexingUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-fit text-xs text-accent hover:underline"
          title="Open this URL's inspection page in Search Console, then click “Request indexing”"
        >
          Request Indexing ↗
        </a>
      )}
    </span>
  );
}

function RowGroup({
  r,
  open,
  onToggle,
  onSubmit,
  submitting,
  scopeOk,
}: {
  r: IndexUrlRow;
  open: boolean;
  onToggle: () => void;
  onSubmit: () => void;
  submitting: boolean;
  scopeOk: boolean;
}) {
  const canSubmit = r.submittable && r.submitResult !== "ok" && scopeOk;
  return (
    <>
      <tr
        className={`cursor-pointer border-b border-border/60 hover:bg-accent-soft/40 ${
          !r.indexed && r.lastInspection ? "bg-bad/5" : ""
        }`}
        onClick={onToggle}
      >
        <td className="max-w-sm truncate px-4 py-2">
          <span className="mr-1 text-muted">{open ? "▾" : "▸"}</span>
          {shortUrl(r.url)}
        </td>
        <td className="px-4 py-2 text-right tabular-nums">{fmt(r.clicks, "count")}</td>
        <td className="px-4 py-2 text-right tabular-nums">{fmt(r.impressions, "count")}</td>
        <td className="px-4 py-2">
          <StatusPill r={r} />
        </td>
        <td className="px-4 py-2 text-muted">{crawl(r.lastCrawl)}</td>
        <td className="px-4 py-2 text-muted">
          {r.richResults || (r.richVerdict === "PASS" ? "OK" : "—")}
        </td>
        <td className="px-4 py-2 text-muted">
          {r.lastInspection ? `${format(r.lastInspection, "MMM d")}` : "—"}
        </td>
        <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
          {r.submitResult === "ok" && !canSubmit ? (
            <span className="text-xs text-good">sent {crawl(iso(r.submittedAt))}</span>
          ) : canSubmit ? (
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="rounded border border-accent px-2 py-0.5 text-xs text-accent disabled:opacity-50"
              title={r.submitResult && r.submitResult !== "ok" ? r.submitResult : ""}
            >
              {submitting ? "…" : r.submittedAt ? "Retry" : "Submit"}
            </button>
          ) : (
            <span className="text-muted">—</span>
          )}
          {r.submitResult && r.submitResult !== "ok" && (
            <div className="mt-0.5 max-w-[10rem] truncate text-[10px] text-bad" title={r.submitResult}>
              {r.submitResult}
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/60 bg-background/50">
          <td colSpan={8} className="px-8 py-3">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs md:grid-cols-3">
              <Detail k="Full URL" v={<a href={r.url} target="_blank" rel="noreferrer" className="text-accent">{r.url}</a>} />
              <Detail k="Coverage state" v={r.status} />
              <Detail k="Indexing allowed" v={r.indexingState} />
              <Detail k="robots.txt" v={r.robotsTxtState} />
              <Detail k="Page fetch" v={r.pageFetchState} />
              <Detail k="Crawled as" v={r.crawledAs} />
              <Detail k="Google canonical" v={r.googleCanonical} />
              <Detail k="Declared canonical" v={r.userCanonical} />
              <Detail k="Rich results" v={r.richResults ? `${r.richResults} (${r.richVerdict ?? "?"})` : "none"} />
              <Detail k="Last crawl" v={r.lastCrawl ? new Date(r.lastCrawl).toLocaleString() : "—"} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-muted">{k}</span>
      <span className="break-all">{v || "—"}</span>
    </div>
  );
}

function RecentMovements({
  movements,
}: {
  movements: IndexData["movements"];
}) {
  const [onlyIndexing, setOnlyIndexing] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [page, setPage] = useState(1);
  const size = 25;

  const rows = useMemo(() => {
    let r = movements;
    if (onlyIndexing) r = r.filter((m) => m.indexingChange === 1);
    if (onlyNew) r = r.filter((m) => m.recentlyPublished);
    return r;
  }, [movements, onlyIndexing, onlyNew]);

  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const shown = rows.slice((page - 1) * size, page * size);

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent movements</h3>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyIndexing} onChange={(e) => setOnlyIndexing(e.target.checked)} />
          Only indexing changes
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
          Recently published and not indexed
        </label>
      </div>
      <div className="rounded-xl border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead className="text-left text-muted">
            <tr className="border-b">
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">URL</th>
              <th className="px-4 py-2.5 font-medium">Before</th>
              <th className="px-4 py-2.5 font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m, i) => (
              <tr
                key={`${m.url}-${m.changedAt}-${i}`}
                className={`border-b border-border/60 ${m.indexingChange ? "bg-bad/5" : ""}`}
              >
                <td className="whitespace-nowrap px-4 py-2 text-muted">
                  {format(m.changedAt, "MMM d, yyyy")}
                </td>
                <td className="max-w-sm truncate px-4 py-2">
                  <a href={m.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {shortUrl(m.url)}
                  </a>
                </td>
                <td className="px-4 py-2 text-muted">{m.before ?? "—"}</td>
                <td className="px-4 py-2">{m.after ?? "—"}</td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted">
                  No status changes recorded yet — they appear after the second inspection of a URL.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {pageCount > 1 && (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded border px-2 py-0.5 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              {page} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page === pageCount}
              className="rounded border px-2 py-0.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return (url.pathname + url.search) || "/";
  } catch {
    return u;
  }
}
function iso(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}
function crawl(isoStr: string | null): string {
  if (!isoStr) return "—";
  const days = Math.round((Date.now() - new Date(isoStr).getTime()) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}
