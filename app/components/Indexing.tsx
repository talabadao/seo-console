"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  requestIndexingUrl: string | null;
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

interface LiveInspection {
  url: string;
  ok: boolean;
  error: string | null;
  indexed: boolean;
  coverageState: string | null;
  stateLabel: string;
  verdict: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  crawledAs: string | null;
  richResults: string | null;
  richVerdict: string | null;
  inspectLink: string | null;
  inspectedAt: number;
}

const PAGE_SIZES = [25, 50, 100, 250];

export function Indexing({ property, neverSynced }: { property: string; neverSynced?: boolean }) {
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
  const [runProgress, setRunProgress] = useState<{ done: number; target: number } | null>(null);
  const [confirmSitemap, setConfirmSitemap] = useState<{ count: number; urls: string[] } | null>(null);
  const autoRunFor = useRef<string | null>(null);

  // Manual "inspect specific URLs" panel (live URL Inspection, on demand).
  const [showInspect, setShowInspect] = useState(false);
  const [inspectInput, setInspectInput] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [liveResults, setLiveResults] = useState<LiveInspection[] | null>(null);
  const [inspectProgress, setInspectProgress] = useState<{ done: number; total: number } | null>(null);
  const [inspectMsg, setInspectMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!property) return null;
    const res = await fetch(`/api/index?property=${encodeURIComponent(property)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as IndexData;
    setData(j);
    return j;
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  // Discovery pulls the sitemap straight from Search Console's API (falling
  // back to robots.txt / sitemap.xml) and shows it for confirmation before
  // any inspecting starts. Kick it off automatically the first time a
  // property has never been checked, instead of requiring a click. `job` is
  // persisted server-side, so this fires at most once per property, ever,
  // even across reloads.
  useEffect(() => {
    if (!property || !data || data.job || busy || autoRunFor.current === property) return;
    autoRunFor.current = property;
    discover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property, data, busy]);

  // A single /api/index/check request only inspects up to PER_RUN_CAP URLs —
  // kept modest server-side so one request finishes comfortably inside
  // Vercel's function time budget. A big sitemap (hundreds of URLs) needs
  // several such requests, so auto-continue here instead of making the user
  // click "Run check" repeatedly: the server tells us via `message` whether
  // there's more to do ("Run-limit reached — click again to keep going.").
  const CONTINUE_MESSAGE = "Run-limit reached — click again to keep going.";
  const MAX_ROUNDS = 20;

  /** Pulls the sitemap (via GSC's API, or the optional manual link) and shows it for
   * confirmation — inspection only starts once the user reviews and accepts it. */
  async function discover() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/index/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property,
          discover: true,
          discoverOnly: true,
          sitemapUrl: sitemapUrl.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg(j.error ?? "Failed");
        return;
      }
      const fresh = await load();
      setConfirmSitemap({
        count: j.discovered ?? fresh?.total ?? 0,
        urls: (fresh?.urls ?? []).map((u) => u.url),
      });
    } finally {
      setBusy(false);
    }
  }

  function startInspecting() {
    setConfirmSitemap(null);
    runInspection();
  }

  async function runInspection() {
    setBusy(true);
    setMsg(null);
    // Progress estimate for the bar: how many of the site's known sitemap URLs
    // aren't inspected yet, as of the moment the run started.
    const startInspected = data?.inspected ?? 0;
    setRunProgress(
      data && data.total > startInspected ? { done: 0, target: data.total - startInspected } : null,
    );
    try {
      let checkedTotal = 0;
      let quota = 0;
      let lastMessage: string | undefined;
      let round = 0;
      while (round < MAX_ROUNDS) {
        round++;
        // A round's request is one real Google API round trip per URL (~40ms
        // delay + actual network latency each), so a full batch can take
        // 10-30+s before this fetch resolves and `checkedTotal` updates below
        // — nudge the bar forward in the meantime so it doesn't look stalled,
        // then snap to the real count once the response lands.
        let optimisticDone = checkedTotal;
        const ticker = setInterval(() => {
          optimisticDone++;
          setRunProgress((cur) => (cur ? { ...cur, done: Math.min(cur.target - 1, optimisticDone) } : cur));
        }, 600);
        let res: Response;
        let j: { checked?: number; quotaLeft?: number; message?: string; error?: string };
        try {
          res = await fetch("/api/index/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ property }),
          });
          j = await res.json();
        } catch {
          // Likely the function got killed mid-run (large batch, platform time
          // limit) rather than a real failure — each URL it did reach was
          // already saved server-side, so just try another round.
          clearInterval(ticker);
          await load();
          continue;
        }
        clearInterval(ticker);
        if (!res.ok) {
          setMsg(j.error ?? "Failed");
          break;
        }
        checkedTotal += j.checked ?? 0;
        quota = j.quotaLeft ?? quota;
        lastMessage = j.message;
        await load(); // refresh counts live between rounds
        setRunProgress((cur) => {
          const target = Math.max(cur?.target ?? 0, checkedTotal);
          return target > 0 ? { done: checkedTotal, target } : null;
        });
        if (lastMessage !== CONTINUE_MESSAGE) break;
      }
      setMsg(
        `Inspected ${checkedTotal}. Quota left: ${quota}.${
          lastMessage && lastMessage !== CONTINUE_MESSAGE ? ` (${lastMessage})` : ""
        }`,
      );
    } finally {
      setBusy(false);
      setRunProgress(null);
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

  // Live, on-demand inspection of a pasted list of URLs. Sent in small batches
  // (each a real round trip to Google per URL) so no single request runs long;
  // results stream in as each batch returns.
  async function inspectManual() {
    const urls = [...new Set(inspectInput.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
    if (!urls.length) return;
    setInspecting(true);
    setInspectMsg(null);
    setLiveResults([]);
    setInspectProgress({ done: 0, total: urls.length });

    const BATCH = 20;
    const collected: LiveInspection[] = [];
    let quota = data?.quotaLeft ?? 0;
    let stopMsg: string | null = null;
    try {
      for (let i = 0; i < urls.length; i += BATCH) {
        const chunk = urls.slice(i, i + BATCH);
        const res = await fetch("/api/index/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ property, urls: chunk }),
        });
        const j = await res.json();
        if (!res.ok) {
          stopMsg = j.error ?? "Inspection failed.";
          break;
        }
        collected.push(...((j.results ?? []) as LiveInspection[]));
        setLiveResults([...collected]);
        quota = j.quotaLeft ?? quota;
        setInspectProgress({ done: Math.min(urls.length, i + chunk.length), total: urls.length });
        if (j.needsReconnect) {
          stopMsg = "Reconnect Google — your sign-in can't inspect URLs for this property.";
          break;
        }
      }
      const okCount = collected.filter((r) => r.ok).length;
      setInspectMsg(
        stopMsg
          ? stopMsg
          : `Inspected ${okCount}/${collected.length} live. Inspection quota left today: ${quota}.`,
      );
      await load(); // manually-inspected URLs now show in the table below
    } finally {
      setInspecting(false);
      setInspectProgress(null);
    }
  }

  function exportLive() {
    if (!liveResults?.length) return;
    downloadCsv(
      `url-inspection-manual-${slug(property)}-${today()}.csv`,
      [
        "URL",
        "Result",
        "Indexed",
        "Coverage state",
        "Verdict",
        "Indexing allowed",
        "robots.txt",
        "Page fetch",
        "Crawled as",
        "Google canonical",
        "Declared canonical",
        "Rich results",
        "Rich verdict",
        "Last crawl",
        "Inspected at",
        "Search Console link",
        "Error",
      ],
      liveResults.map((r) => [
        r.url,
        r.ok ? "ok" : "failed",
        r.ok ? (r.indexed ? "yes" : "no") : "",
        r.stateLabel,
        r.verdict,
        r.indexingState,
        r.robotsTxtState,
        r.pageFetchState,
        r.crawledAs,
        r.googleCanonical,
        r.userCanonical,
        r.richResults,
        r.richVerdict,
        r.lastCrawlTime ? new Date(r.lastCrawlTime).toISOString() : "",
        new Date(r.inspectedAt).toISOString(),
        r.inspectLink,
        r.error,
      ]),
    );
  }

  function exportTable() {
    if (!filtered.length) return;
    downloadCsv(
      `url-inspections-${slug(property)}-${today()}.csv`,
      [
        "URL",
        "Clicks 30d",
        "Impressions 30d",
        "Status",
        "Indexed",
        "At risk",
        "Coverage state",
        "Indexing allowed",
        "robots.txt",
        "Page fetch",
        "Crawled as",
        "Google canonical",
        "Declared canonical",
        "Rich results",
        "Rich verdict",
        "Last crawl",
        "Last inspection",
        "Submitted at",
        "Submit result",
      ],
      filtered.map((r) => [
        r.url,
        r.clicks,
        r.impressions,
        r.status ?? (r.lastInspection ? "" : "not inspected"),
        r.lastInspection ? (r.indexed ? "yes" : "no") : "",
        r.atRisk ? "yes" : "",
        r.stateLabel,
        r.indexingState,
        r.robotsTxtState,
        r.pageFetchState,
        r.crawledAs,
        r.googleCanonical,
        r.userCanonical,
        r.richResults,
        r.richVerdict,
        r.lastCrawl ? new Date(r.lastCrawl).toISOString() : "",
        r.lastInspection ? new Date(r.lastInspection).toISOString() : "",
        r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
        r.submitResult,
      ]),
    );
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
            title="Falls back automatically to robots.txt / sitemap.xml if this is left blank"
            className="w-48 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <button
            onClick={discover}
            disabled={busy || !property}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-50"
          >
            {busy ? "Working…" : "Discover sitemap"}
          </button>
          <button
            onClick={runInspection}
            disabled={busy || !property}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-50"
          >
            Run check
          </button>
          <button
            onClick={() =>
              submit(
                (data?.urls ?? [])
                  .filter((u) => u.submittable)
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

      {/* Manual, live URL inspection */}
      <div className="mb-3 rounded-xl border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <strong className="text-sm">Inspect specific URLs</strong>
            <p className="text-xs text-muted">
              Live URL Inspection straight from Google — results are generated on request, not read
              from stored data.
            </p>
          </div>
          <button
            onClick={() => setShowInspect((v) => !v)}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent-soft"
          >
            {showInspect ? "Hide" : "Open"}
          </button>
        </div>

        {showInspect && (
          <div className="mt-3">
            <textarea
              value={inspectInput}
              onChange={(e) => setInspectInput(e.target.value)}
              placeholder={
                "Paste URLs to inspect, one per line…\nhttps://example.com/page-a\nhttps://example.com/page-b"
              }
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={inspectManual}
                disabled={inspecting || !inspectInput.trim() || !property}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {inspecting ? "Inspecting…" : "Inspect URLs"}
              </button>
              {liveResults && liveResults.length > 0 && (
                <button
                  onClick={exportLive}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent-soft"
                >
                  Export results (CSV)
                </button>
              )}
              <span className="text-xs text-muted">
                Uses your daily inspection quota · {data?.quotaLeft ?? "…"} left today
              </span>
            </div>

            {inspectProgress && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-medium">Inspecting…</span>
                  <span className="tabular-nums text-muted">
                    {inspectProgress.done} / {inspectProgress.total}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full border bg-background">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{
                      width: `${Math.max(3, Math.round((inspectProgress.done / inspectProgress.total) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {inspectMsg && (
              <div className="mt-2 rounded-lg border bg-background p-2 text-sm">{inspectMsg}</div>
            )}

            {liveResults && liveResults.length > 0 && (
              <div className="mt-3 max-h-80 overflow-auto rounded-lg border">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-surface text-left text-muted">
                    <tr className="border-b">
                      <th className="px-3 py-2 font-medium">URL</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Last crawl</th>
                      <th className="px-3 py-2 font-medium">Rich results</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveResults.map((r, i) => (
                      <tr key={`${r.url}-${i}`} className="border-b border-border/60 align-top">
                        <td className="max-w-xs truncate px-3 py-2" title={r.url}>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                          >
                            {shortUrl(r.url)}
                          </a>
                        </td>
                        <td className="px-3 py-2">
                          {r.ok ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  background: r.indexed ? "var(--good)" : "var(--bad)",
                                }}
                              />
                              <span style={{ color: r.indexed ? "var(--good)" : "var(--bad)" }}>
                                {r.coverageState ?? (r.indexed ? "Indexed" : "Not indexed")}
                              </span>
                            </span>
                          ) : (
                            <span className="text-bad">{r.error ?? "failed"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted">{crawl(r.lastCrawlTime)}</td>
                        <td className="px-3 py-2 text-muted">
                          {r.richResults || (r.richVerdict === "PASS" ? "OK" : "—")}
                        </td>
                        <td className="px-3 py-2">
                          {r.inspectLink && (
                            <a
                              href={r.inspectLink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-accent hover:underline"
                              title="Open in Search Console"
                            >
                              View ↗
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {confirmSitemap && (
        <div className="mb-3 rounded-xl border border-accent/40 bg-accent-soft/30 p-4">
          <p className="text-sm font-medium">
            Found {confirmSitemap.count.toLocaleString()} URL
            {confirmSitemap.count === 1 ? "" : "s"} in the sitemap. Review before inspecting:
          </p>
          <div className="mt-2 max-h-48 overflow-auto rounded-md border bg-background p-2 text-xs">
            {confirmSitemap.urls.slice(0, 300).map((u) => (
              <div key={u} className="truncate py-0.5">
                {u}
              </div>
            ))}
            {!confirmSitemap.urls.length && <p className="text-muted">No URLs found.</p>}
            {confirmSitemap.urls.length > 300 && (
              <div className="pt-1 text-muted">…and {confirmSitemap.urls.length - 300} more</div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={startInspecting}
              disabled={!confirmSitemap.urls.length}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Looks good — start inspecting
            </button>
            <button
              onClick={() => setConfirmSitemap(null)}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {runProgress && (
        <div className="mb-3 rounded-lg border bg-surface p-3">
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium">Inspecting URLs from the sitemap…</span>
            <span className="tabular-nums text-muted">
              {runProgress.done.toLocaleString()} / {runProgress.target.toLocaleString()} ·{" "}
              {Math.min(100, Math.round((runProgress.done / runProgress.target) * 100))}%
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full border bg-background">
            <div
              className={`h-full rounded-full bg-accent transition-all ${
                runProgress.done === 0 ? "animate-pulse" : ""
              }`}
              style={{
                width: `${Math.max(3, Math.min(100, Math.round((runProgress.done / runProgress.target) * 100)))}%`,
              }}
            />
          </div>
        </div>
      )}

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
      {neverSynced && (
        <div className="mt-4 rounded-lg border border-position/40 bg-position/10 p-3 text-sm">
          <strong>Clicks/Impressions below will show 0</strong> until you run{" "}
          <strong>Sync history</strong> (top of the page) at least once — those columns come from
          locally-synced Search Console history, not a live fetch.
        </div>
      )}
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
          <button
            onClick={exportTable}
            disabled={!filtered.length}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-50"
            title="Download the URLs shown (current filter) as a CSV"
          >
            Export CSV
          </button>
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
      {!r.indexed && r.requestIndexingUrl && (
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
  const canSubmit = r.submittable && scopeOk;
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function slug(s: string): string {
  return s.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "property";
}
function csvCell(v: string | number | null): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Builds a CSV (UTF-8 BOM so Excel reads it correctly) and triggers a download. */
function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
