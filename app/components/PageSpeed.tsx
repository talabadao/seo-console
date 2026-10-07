"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { Recommendation, Strategy } from "@/lib/pagespeedParse";
import type { PageSummary, RunRow } from "@/lib/pagespeed";

type Status = "good" | "ni" | "poor" | "none";

const STATUS: Record<Status, { label: string; color: string }> = {
  good: { label: "Good", color: "var(--good)" },
  ni: { label: "Needs improvement", color: "var(--position)" },
  poor: { label: "Poor", color: "var(--bad)" },
  none: { label: "No data", color: "var(--border)" },
};

const DEVICE: Record<Strategy, { label: string; color: string }> = {
  mobile: { label: "Mobile", color: "var(--series-a)" },
  desktop: { label: "Desktop", color: "var(--series-b)" },
};

type MetricKey = "score" | "lcp" | "tbt" | "cls" | "fcp" | "inp" | "ttfb";

// Google's published thresholds: [good up to, needs-improvement up to].
// `score` is the only one where higher is better.
const METRIC: Record<MetricKey, { label: string; good: number; ni: number; kind: "score" | "ms" | "cls" }> = {
  score: { label: "Performance score", good: 90, ni: 50, kind: "score" },
  lcp: { label: "Largest Contentful Paint", good: 2500, ni: 4000, kind: "ms" },
  tbt: { label: "Total Blocking Time", good: 200, ni: 600, kind: "ms" },
  cls: { label: "Cumulative Layout Shift", good: 0.1, ni: 0.25, kind: "cls" },
  fcp: { label: "First Contentful Paint", good: 1800, ni: 3000, kind: "ms" },
  inp: { label: "Interaction to Next Paint", good: 200, ni: 500, kind: "ms" },
  ttfb: { label: "Time to First Byte", good: 800, ni: 1800, kind: "ms" },
};

function statusOf(m: MetricKey, v: number | null | undefined): Status {
  if (v == null) return "none";
  const t = METRIC[m];
  if (m === "score") return v >= t.good ? "good" : v >= t.ni ? "ni" : "poor";
  return v <= t.good ? "good" : v <= t.ni ? "ni" : "poor";
}

function show(m: MetricKey, v: number | null | undefined): string {
  if (v == null) return "—";
  const kind = METRIC[m].kind;
  if (kind === "score") return String(Math.round(v));
  if (kind === "cls") return v.toFixed(v < 0.1 ? 3 : 2);
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
}

function StatusDot({ status }: { status: Status }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: STATUS[status].color }}
      title={STATUS[status].label}
    />
  );
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" && !u.search ? u.hostname : u.hostname + u.pathname + u.search;
  } catch {
    return url;
  }
}

const day = (d: string) => format(parseISO(d), "MMM d");

export function PageSpeed({ projectId, websiteUrl }: { projectId: number; websiteUrl: string }) {
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [maxPages, setMaxPages] = useState(15);
  const [device, setDevice] = useState<Strategy>("mobile");
  const [selected, setSelected] = useState<number | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState<number[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pagespeed?projectId=${projectId}`);
    if (!res.ok) return;
    const j = (await res.json()) as { pages: PageSummary[]; maxPages: number };
    setPages(j.pages);
    setMaxPages(j.maxPages);
    setSelected((cur) => (cur && j.pages.some((p) => p.id === cur) ? cur : (j.pages[0]?.id ?? null)));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(pageId: number) {
    setRunning((r) => [...r, pageId]);
    setMsg(null);
    try {
      const res = await fetch("/api/pagespeed/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) setMsg(j.error ?? "The check didn't finish — try again.");
      await load();
      setRefresh((n) => n + 1);
    } finally {
      setRunning((r) => r.filter((id) => id !== pageId));
    }
  }

  async function add(url: string) {
    if (!url.trim()) return;
    setAdding(true);
    setMsg(null);
    try {
      const res = await fetch("/api/pagespeed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, url }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg(j.error ?? "Couldn't add the page.");
        return;
      }
      setNewUrl("");
      await load();
      setSelected(j.page.id);
      run(j.page.id); // first result, without waiting for tomorrow's daily run
    } finally {
      setAdding(false);
    }
  }

  async function remove(pageId: number) {
    await fetch(`/api/pagespeed?pageId=${pageId}`, { method: "DELETE" });
    await load();
  }

  const current = pages?.find((p) => p.id === selected) ?? null;
  const full = (pages?.length ?? 0) >= maxPages;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          className="flex min-w-72 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add(newUrl);
          }}
        >
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="Add a page to track, e.g. https://example.com/pricing"
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={adding || full || !newUrl.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add page"}
          </button>
        </form>
        <div className="flex rounded-md border p-0.5 text-sm">
          {(Object.keys(DEVICE) as Strategy[]).map((s) => (
            <button
              key={s}
              onClick={() => setDevice(s)}
              className={`rounded px-3 py-1 font-medium ${device === s ? "bg-accent text-white" : "text-muted"}`}
            >
              {DEVICE[s].label}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className="mb-3 flex items-center justify-between rounded-lg border bg-surface p-3 text-sm">
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} className="text-muted">
            ✕
          </button>
        </div>
      )}

      {pages && !pages.length ? (
        <div className="rounded-xl border bg-surface p-8 text-center text-sm">
          <p className="font-medium">No pages tracked yet.</p>
          <p className="mx-auto mt-1 max-w-md text-muted">
            Add the pages that matter most. Each one is measured with Google PageSpeed Insights on
            mobile and desktop once a day, so you can see how its speed changes over time.
          </p>
          {websiteUrl && (
            <button
              onClick={() => add(websiteUrl)}
              disabled={adding}
              className="mt-4 rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
              Track {pathOf(websiteUrl)}
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-surface">
          <table className="w-full border-collapse whitespace-nowrap text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b">
                <th className="px-4 py-2.5 font-medium">Page</th>
                <th className="px-4 py-2.5 font-medium">Score</th>
                <th className="px-4 py-2.5 font-medium">30-day trend</th>
                <th className="px-4 py-2.5 text-right font-medium">LCP</th>
                <th className="px-4 py-2.5 text-right font-medium">TBT</th>
                <th className="px-4 py-2.5 text-right font-medium">CLS</th>
                <th className="px-4 py-2.5 font-medium">Real users</th>
                <th className="px-4 py-2.5 font-medium">Last checked</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(pages ?? []).map((p) => {
                const r = p.latest[device];
                const busy = running.includes(p.id);
                return (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                    className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-accent-soft/40 ${
                      p.id === selected ? "bg-accent-soft/60" : ""
                    }`}
                  >
                    <td className="max-w-xs truncate px-4 py-2.5 font-medium" title={p.url}>
                      {pathOf(p.url)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 tabular-nums">
                        <StatusDot status={statusOf("score", r?.score)} />
                        <span className="text-base font-semibold">{show("score", r?.score)}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Sparkline points={p.trend[device] ?? []} color={DEVICE[device].color} />
                    </td>
                    {(["lcp", "tbt", "cls"] as const).map((m) => (
                      <td key={m} className="px-4 py-2.5 text-right tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          {show(m, r?.[m])}
                          <StatusDot status={statusOf(m, r?.[m])} />
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      <FieldVerdict category={r?.fieldCategory ?? null} />
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {busy ? (
                        "Checking… up to a minute"
                      ) : r ? (
                        <span title={r.error ?? undefined}>
                          {day(r.date)}
                          {r.error && r.score == null ? " · failed" : ""}
                        </span>
                      ) : (
                        "Not checked yet"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => run(p.id)}
                        disabled={busy}
                        className="rounded border px-2 py-0.5 text-xs hover:bg-accent-soft disabled:opacity-50"
                      >
                        Check now
                      </button>
                      <button
                        onClick={() => remove(p.id)}
                        className="ml-3 text-xs text-muted hover:text-bad"
                        title="Stop tracking this page and delete its history"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!pages && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pages && pages.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {pages.length} of {maxPages} pages · checked automatically once a day · LCP, TBT and CLS are
          lab measurements from Lighthouse; “Real users” is Chrome&apos;s field data for the last 28
          days.
        </p>
      )}

      {current && (
        <Detail
          key={`${current.id}-${refresh}`}
          page={current}
          device={device}
          latestError={current.latest[device]?.score == null ? (current.latest[device]?.error ?? null) : null}
        />
      )}
    </div>
  );
}

function FieldVerdict({ category }: { category: string | null }) {
  const status: Status =
    category === "FAST" ? "good" : category === "AVERAGE" ? "ni" : category === "SLOW" ? "poor" : "none";
  const text = { good: "Passed", ni: "Needs improvement", poor: "Failed", none: "No data" }[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot status={status} />
      <span className={status === "none" ? "text-muted" : ""}>{text}</span>
    </span>
  );
}

function Sparkline({ points, color }: { points: { date: string; score: number }[]; color: string }) {
  if (points.length < 2) return <span className="text-xs text-muted">—</span>;
  const w = 96;
  const h = 24;
  const x = (i: number) => (i / (points.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - (v / 100) * (h - 4);
  const first = points[0].score;
  const last = points[points.length - 1].score;
  return (
    <svg width={w} height={h} role="img" aria-label={`Score went from ${first} to ${last}`}>
      <title>{`${day(points[0].date)}: ${first} → ${day(points[points.length - 1].date)}: ${last}`}</title>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")}
      />
    </svg>
  );
}

interface History {
  runs: RunRow[];
  recommendations: Partial<Record<Strategy, Recommendation[]>>;
}

function Detail({
  page,
  device,
  latestError,
}: {
  page: PageSummary;
  device: Strategy;
  latestError: string | null;
}) {
  const [days, setDays] = useState(90);
  const [hist, setHist] = useState<History | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/pagespeed/history?pageId=${page.id}&days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: History | null) => {
        if (!ignore && j) setHist(j);
      });
    return () => {
      ignore = true;
    };
  }, [page.id, days]);

  // One row per day with a column per device, for the two-line charts.
  const series = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const r of hist?.runs ?? []) {
      if (r.score == null) continue;
      const row = byDate.get(r.date) ?? { date: r.date, label: day(r.date) };
      for (const m of ["score", "lcp", "tbt", "cls"] as const) row[`${r.strategy}_${m}`] = r[m];
      byDate.set(r.date, row);
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [hist]);

  const latest = page.latest[device];
  const recs = hist?.recommendations[device] ?? [];
  const hasField = latest?.fieldLcp != null || latest?.fieldInp != null || latest?.fieldCls != null;

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="min-w-0 truncate text-base font-semibold">
          <a href={page.url} target="_blank" rel="noreferrer" className="hover:underline">
            {pathOf(page.url)}
          </a>
        </h3>
        <span className="text-sm text-muted">{DEVICE[device].label}</span>
        <div className="ml-auto flex rounded-md border p-0.5 text-sm">
          {[30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded px-2.5 py-1 ${days === d ? "bg-accent text-white" : "text-muted"}`}
            >
              {d === 365 ? "12 months" : `${d} days`}
            </button>
          ))}
        </div>
      </div>

      {latestError && (
        <div className="mb-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          The last {DEVICE[device].label.toLowerCase()} check failed: {latestError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["score", "lcp", "tbt", "cls"] as const).map((m) => (
          <Tile key={m} metric={m} value={latest?.[m] ?? null} note="Lab" />
        ))}
      </div>

      <div className="mt-3 rounded-xl border bg-surface p-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h4 className="text-sm font-semibold">Real-user experience</h4>
          <span className="text-xs text-muted">
            75th percentile of Chrome users, last 28 days
            {hasField && latest?.fieldOrigin ? " · for the whole site (not enough visits to this page alone)" : ""}
          </span>
        </div>
        {hasField ? (
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {(
              [
                ["lcp", latest?.fieldLcp],
                ["inp", latest?.fieldInp],
                ["cls", latest?.fieldCls],
                ["fcp", latest?.fieldFcp],
                ["ttfb", latest?.fieldTtfb],
              ] as const
            ).map(([m, v]) => (
              <div key={m}>
                <div className="text-xs text-muted">{METRIC[m].label}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold tabular-nums">
                  {show(m, v)}
                  <StatusDot status={statusOf(m, v)} />
                </div>
                <div className="text-xs text-muted">{STATUS[statusOf(m, v)].label}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Google has no real-user data for this page yet — it needs enough Chrome visits. The lab
            numbers above still apply.
          </p>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {(["score", "lcp", "tbt", "cls"] as const).map((m) => (
          <TrendChart key={m} metric={m} data={series} />
        ))}
      </div>

      <Recommendations recs={recs} device={device} />
    </div>
  );
}

function Tile({ metric, value, note }: { metric: MetricKey; value: number | null; note: string }) {
  const status = statusOf(metric, value);
  return (
    <div className="rounded-xl border bg-surface p-4">
      <div className="text-sm text-muted">
        {METRIC[metric].label} <span className="text-xs">· {note}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{show(metric, value)}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        <StatusDot status={status} />
        {STATUS[status].label}
      </div>
    </div>
  );
}

function TrendChart({
  metric,
  data,
}: {
  metric: "score" | "lcp" | "tbt" | "cls";
  data: Record<string, number | string | null>[];
}) {
  const meta = METRIC[metric];
  const goodLine =
    metric === "score" ? "Good: 90 and above" : `Good: ${show(metric, meta.good)} or less`;
  return (
    <div className="rounded-xl border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h4 className="text-sm font-semibold">{meta.label}</h4>
        <span className="flex items-center gap-3 text-xs text-muted">
          {(Object.keys(DEVICE) as Strategy[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ background: DEVICE[s].color }} />
              {DEVICE[s].label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t border-dashed" style={{ borderColor: "var(--good)" }} />
            {goodLine}
          </span>
        </span>
      </div>
      {data.length < 2 ? (
        <p className="flex h-44 items-center justify-center text-center text-sm text-muted">
          {data.length ? "One check so far — the trend appears from the second day." : "No checks yet."}
        </p>
      ) : (
        <div className="mt-2 h-44 w-full">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                minTickGap={32}
                stroke="var(--border)"
              />
              <YAxis
                width={44}
                axisLine={false}
                tickLine={false}
                domain={metric === "score" ? [0, 100] : [0, (max: number) => Math.max(max, meta.good) * 1.1]}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickFormatter={(v: number) => (metric === "cls" ? v.toFixed(2) : show(metric, v))}
              />
              <ReferenceLine y={meta.good} stroke="var(--good)" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
                itemStyle={{ color: "var(--foreground)" }}
                formatter={((value: unknown, name: unknown) => [
                  show(metric, Number(value)),
                  DEVICE[String(name).split("_")[0] as Strategy]?.label ?? String(name),
                ]) as never}
              />
              {(Object.keys(DEVICE) as Strategy[]).map((s) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={`${s}_${metric}`}
                  stroke={DEVICE[s].color}
                  strokeWidth={2}
                  dot={data.length <= 14 ? { r: 3 } : false}
                  activeDot={{ r: 4 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function priorityOf(r: Recommendation): { label: string; status: Status } {
  if (r.savingsMs >= 1000) return { label: "High impact", status: "poor" };
  if (r.savingsMs >= 300) return { label: "Medium impact", status: "ni" };
  return { label: "Low impact", status: "none" };
}

function savingText(r: Recommendation): string {
  const parts: string[] = [];
  if (r.savingsMs > 0) {
    parts.push(`about ${r.savingsMs >= 1000 ? `${(r.savingsMs / 1000).toFixed(1)} s` : `${r.savingsMs} ms`} faster`);
  }
  if (r.savingsBytes > 0) parts.push(`${Math.round(r.savingsBytes / 1024).toLocaleString()} KiB smaller`);
  return parts.join(" · ");
}

function Recommendations({ recs, device }: { recs: Recommendation[]; device: Strategy }) {
  return (
    <div className="mt-3 rounded-xl border bg-surface">
      <div className="flex flex-wrap items-baseline gap-x-3 border-b px-4 py-3">
        <h4 className="text-sm font-semibold">Recommendations</h4>
        <span className="text-xs text-muted">
          from the latest {DEVICE[device].label.toLowerCase()} check, biggest estimated gain first
        </span>
      </div>
      {recs.length ? (
        <ul className="divide-y">
          {recs.map((r) => {
            const p = priorityOf(r);
            return (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{r.title}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <StatusDot status={p.status} />
                    {p.label}
                  </span>
                  <span className="ml-auto text-sm tabular-nums">{savingText(r) || r.displayValue || ""}</span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {r.description}{" "}
                  {r.learnMore && (
                    <a href={r.learnMore} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      How to fix ↗
                    </a>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-6 text-sm text-muted">
          Nothing to fix was reported for this device, or the page hasn&apos;t been checked yet.
        </p>
      )}
    </div>
  );
}
