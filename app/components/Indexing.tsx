"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  indexed: boolean;
  lastCrawl: string | null;
  richResults: string | null;
  lastInspection: number | null;
  robotsTxtState: string | null;
  googleCanonical: string | null;
  submittedAt: number | null;
  submitResult: string | null;
  submittable: boolean;
  unknownToGoogle: boolean;
}

interface IndexData {
  total: number;
  inspected: number;
  indexed: number;
  notIndexed: number;
  pctIndexed: number;
  submittableCount: number;
  urls: IndexUrlRow[];
  history: { date: string; indexed: number; notIndexed: number; total: number }[];
  job: { status: string; checked: number; message: string | null; finished_at: number | null } | null;
  quotaLeft: number;
  dailyCap: number;
  indexing: { configured: boolean; serviceAccount: boolean };
}

export function Indexing({ property }: { property: string }) {
  const [data, setData] = useState<IndexData | null>(null);
  const [tab, setTab] = useState<"all" | "indexed" | "not">("all");
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

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
        body: JSON.stringify({
          property,
          discover,
          sitemapUrl: sitemapUrl.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (res.ok) {
        setMsg(
          `${j.discovered != null ? `Discovered ${j.discovered} URLs. ` : ""}Inspected ${j.checked}. Quota left today: ${j.quotaLeft}.${j.message ? ` (${j.message})` : ""}`,
        );
        await load();
      } else setMsg(j.error ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit(urls: string[]) {
    if (!urls.length) return;
    setSubmitting(urls.length === 1 ? urls[0] : "bulk");
    setMsg(null);
    try {
      const res = await fetch("/api/index/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property, urls }),
      });
      const j = await res.json();
      if (res.ok) {
        if (j.needsReconnect) {
          setMsg(
            "Google rejected the request — your account was connected before the indexing permission existed. Sign out and sign back in, then retry.",
          );
        } else {
          setMsg(
            `Submitted ${j.submitted} URL(s) to the Indexing API${j.failed ? `, ${j.failed} failed (${j.results.find((r: { ok: boolean; message: string }) => !r.ok)?.message ?? ""})` : ""}.`,
          );
        }
        await load();
      } else setMsg(j.error ?? "Submit failed");
    } finally {
      setSubmitting(null);
    }
  }

  const rows = useMemo(() => {
    let r = data?.urls ?? [];
    if (tab === "indexed") r = r.filter((x) => x.indexed);
    if (tab === "not") r = r.filter((x) => x.lastInspection && !x.indexed);
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.url.toLowerCase().includes(needle));
    return r;
  }, [data, tab, q]);

  const chartData = (data?.history ?? []).map((h) => ({
    label: format(parseISO(h.date), "MMM d"),
    Indexed: h.indexed,
    "Not indexed": h.notIndexed,
  }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border p-0.5 text-sm">
          {(
            [
              ["all", `All`],
              ["indexed", `${data?.indexed ?? 0} Indexed`],
              ["not", `${data?.notIndexed ?? 0} Not indexed`],
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
            className="w-52 rounded-md border bg-background px-2 py-1.5 text-sm"
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
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Run check
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 rounded-lg border bg-surface p-3 text-sm">{msg}</div>}
      {data && (
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            Inspection quota left today: {data.quotaLeft}/{data.dailyCap}
            {data.job?.finished_at
              ? ` · last run ${format(data.job.finished_at, "MMM d HH:mm")} (${data.job.checked} checked)`
              : ""}
          </span>
          {data.submittableCount > 0 && (
            <button
              onClick={() =>
                submit(data.urls.filter((u) => u.submittable && !u.submittedAt).map((u) => u.url))
              }
              disabled={submitting === "bulk"}
              className="rounded-md border border-accent px-2 py-1 font-medium text-accent disabled:opacity-50"
            >
              {submitting === "bulk"
                ? "Submitting…"
                : `Submit ${data.submittableCount} not-indexed to Google`}
            </button>
          )}
          <span className="text-muted">
            Indexing API via your Google login{data.indexing.serviceAccount ? " + service account" : ""}
          </span>
        </div>
      )}

      <div className="rounded-xl border bg-surface p-4">
        {chartData.length ? (
          <div className="h-56 w-full">
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
                    fontSize: 13,
                  }}
                />
                <Bar dataKey="Indexed" stackId="a" fill="var(--good)" />
                <Bar dataKey="Not indexed" stackId="a" fill="var(--position)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted">
            No index history yet. Run a check to start tracking.
          </p>
        )}
      </div>

      <div className="mt-4 rounded-xl border bg-surface">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <strong className="text-sm">PAGES</strong>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter URLs…"
            className="min-w-48 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
          />
          <span className="text-sm text-muted">{rows.length} URLs</span>
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
              {rows.map((r) => (
                <tr key={r.url} className="border-b border-border/60 hover:bg-accent-soft/40">
                  <td className="max-w-sm truncate px-4 py-2">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                      title={r.url}
                    >
                      {shortUrl(r.url)}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(r.clicks, "count")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(r.impressions, "count")}</td>
                  <td className="px-4 py-2">
                    <span className={r.indexed ? "text-good" : r.lastInspection ? "text-bad" : "text-muted"}>
                      {r.status ?? (r.lastInspection ? "—" : "not inspected")}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted">{crawl(r.lastCrawl)}</td>
                  <td className="px-4 py-2 text-muted">{r.richResults ?? "—"}</td>
                  <td className="px-4 py-2 text-muted">
                    {r.lastInspection ? format(r.lastInspection, "MMM d") : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {r.submittedAt ? (
                      <span
                        className={r.submitResult === "ok" ? "text-good" : "text-bad"}
                        title={r.submitResult ?? ""}
                      >
                        {r.submitResult === "ok" ? "sent " : "failed "}
                        {crawl(new Date(r.submittedAt).toISOString())}
                      </span>
                    ) : r.submittable && data?.indexing.configured ? (
                      <button
                        onClick={() => submit([r.url])}
                        disabled={submitting === r.url}
                        className="rounded border border-accent px-2 py-0.5 text-xs text-accent disabled:opacity-50"
                      >
                        {submitting === r.url ? "…" : "Submit"}
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    No URLs. Click “Discover + check”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.pathname + url.search || "/";
  } catch {
    return u;
  }
}

function crawl(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}
