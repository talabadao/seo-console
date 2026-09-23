"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseISO, format as formatDate } from "date-fns";
import { fmtFull } from "./format";
import { ChannelSelect } from "./ChannelSelect";

interface PagePerfRow {
  page: string;
  total: number;
  byDate: Record<string, number>;
}

interface HeatmapData {
  range: { start: string; end: string };
  days: string[];
  rows: PagePerfRow[];
  total: number;
  channels: string[];
  sampled: boolean;
}

const TIMEFRAMES: { id: "7d" | "14d" | "28d"; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "14d", label: "14 days" },
  { id: "28d", label: "28 days" },
];

function dayLabel(d: string): string {
  return formatDate(parseISO(d), "MMM d");
}

interface Column {
  key: string;
  label: string;
  days: string[];
}

/** Day columns as-is, or sequential 7-day buckets (not calendar-week-aligned) from the start
 * of the range — a 28-day range in "week" grain becomes 4 columns of 7 days each. */
function buildColumns(days: string[], grain: "day" | "week"): Column[] {
  if (grain === "day") return days.map((d) => ({ key: d, label: dayLabel(d), days: [d] }));
  const out: Column[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    out.push({
      key: chunk[0],
      label: chunk.length > 1 ? `${dayLabel(chunk[0])} – ${dayLabel(chunk[chunk.length - 1])}` : dayLabel(chunk[0]),
      days: chunk,
    });
  }
  return out;
}

/** Background tint for one heatmap cell, scaled against that row's own max — a page's own
 * quiet vs. busy days stand out even when it's much smaller than the site's top page. */
function heatColor(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "transparent";
  const t = Math.max(0, Math.min(1, value / max));
  const pct = Math.round(8 + t * 77); // 8%..85%, never fully opaque
  return `color-mix(in srgb, var(--clicks) ${pct}%, transparent)`;
}

export function LandingPagesHeatmap({ propertyId }: { propertyId: string }) {
  const [timeframe, setTimeframe] = useState<"7d" | "14d" | "28d">("7d");
  const [grain, setGrain] = useState<"day" | "week">("day");
  const [channel, setChannel] = useState("");
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enableUrl, setEnableUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setErr(null);
    setEnableUrl(null);
    try {
      const p = new URLSearchParams({ propertyId, timeframe, channel });
      const res = await fetch(`/api/ga/landing-heatmap?${p}`);
      const j = await res.json();
      if (j.needsReconnect) return; // Analytics' top-level state already covers reconnect
      if (j.error) {
        setErr(j.error);
        setEnableUrl(j.enableUrl ?? null);
      } else setData(j);
    } finally {
      setLoading(false);
    }
  }, [propertyId, timeframe, channel]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(() => buildColumns(data?.days ?? [], grain), [data, grain]);

  const rowCells = useMemo(() => {
    return (data?.rows ?? []).map((r) => ({
      page: r.page,
      total: r.total,
      cells: columns.map((c) => c.days.reduce((a, d) => a + (r.byDate[d] ?? 0), 0)),
    }));
  }, [data, columns]);

  const maxByRow = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rowCells) m.set(r.page, Math.max(0, ...r.cells));
    return m;
  }, [rowCells]);

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border p-0.5 text-sm">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTimeframe(t.id)}
              className={`rounded px-3 py-1 font-medium ${
                timeframe === t.id ? "bg-accent text-white" : "text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex rounded-md border p-0.5 text-sm">
          {(
            [
              ["day", "Day"],
              ["week", "Week"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setGrain(id)}
              className={`rounded px-3 py-1 font-medium ${
                grain === id ? "bg-accent text-white" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <ChannelSelect channels={data?.channels ?? []} value={channel} onChange={setChannel} />

        {loading && <span className="text-xs text-muted">Loading…</span>}
        {data?.sampled && (
          <span className="rounded bg-position/15 px-2 py-0.5 text-xs text-position">sampled</span>
        )}
        <span className="ml-auto text-xs text-muted">
          {data ? `${data.range.start} → ${data.range.end}` : ""}
        </span>
      </div>

      {err && <ErrorBanner message={err} enableUrl={enableUrl} onRetry={load} />}

      <div className="mb-4 rounded-xl border bg-surface p-4">
        <div className="text-sm text-muted">Total sessions from landing pages</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">
          {fmtFull(data?.total ?? 0, "count")}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {data ? `${data.rows.length} page${data.rows.length === 1 ? "" : "s"} shown, top by sessions` : ""}
        </div>
      </div>

      <div className="rounded-xl border bg-surface">
        <div className="max-h-[38rem] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface text-left text-muted">
              <tr className="border-b">
                <th className="sticky left-0 z-20 bg-surface px-3 py-2.5 font-medium">
                  Landing page + query string
                </th>
                {columns.map((c) => (
                  <th key={c.key} className="px-2 py-2.5 text-right font-medium whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rowCells.map((r) => {
                const max = maxByRow.get(r.page) ?? 0;
                return (
                  <tr key={r.page} className="border-b border-border/60 hover:bg-accent-soft/40">
                    <td
                      className="sticky left-0 z-10 max-w-xs truncate bg-surface px-3 py-2"
                      title={r.page}
                    >
                      {r.page || "/"}
                    </td>
                    {columns.map((c, i) => {
                      const v = r.cells[i];
                      return (
                        <td
                          key={c.key}
                          className="px-2 py-2 text-right tabular-nums"
                          style={{ background: heatColor(v, max) }}
                          title={`${c.label}: ${v.toLocaleString()} sessions`}
                        >
                          {v > 0 ? v.toLocaleString() : <span className="text-muted">–</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {r.total.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {!rowCells.length && (
                <tr>
                  <td colSpan={columns.length + 2} className="px-4 py-10 text-center text-muted">
                    No data.
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

function ErrorBanner({
  message,
  enableUrl,
  onRetry,
}: {
  message: string;
  enableUrl: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
      <span className="flex-1">{message}</span>
      {enableUrl && (
        <a
          href={enableUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-bad px-3 py-1.5 text-xs font-semibold text-white"
        >
          Enable in Google Cloud
        </a>
      )}
      <button onClick={onRetry} className="rounded-md border border-bad/40 px-3 py-1.5 text-xs font-medium">
        Retry
      </button>
    </div>
  );
}
