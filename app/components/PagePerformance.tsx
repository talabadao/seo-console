"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseISO, format as formatDate } from "date-fns";
import { fmtFull } from "./format";
import { ChannelSelect } from "./ChannelSelect";

interface GaProperty {
  propertyId: string;
  displayName: string;
  accountName: string;
}

interface PagePerfRow {
  page: string;
  total: number;
  byDate: Record<string, number>;
}

interface PagePerfData {
  range: { start: string; end: string };
  days: string[];
  rows: PagePerfRow[];
  total: number;
  channels: string[];
  sampled: boolean;
}

const TIMEFRAMES: { id: "1d" | "7d" | "14d" | "28d"; label: string }[] = [
  { id: "1d", label: "1 day" },
  { id: "7d", label: "7 days" },
  { id: "14d", label: "14 days" },
  { id: "28d", label: "28 days" },
];

function dayLabel(d: string, timeframe: string): string {
  const dt = parseISO(d);
  return formatDate(dt, timeframe === "1d" ? "EEE d" : "MMM d");
}

/** Background tint for one heatmap cell, scaled against that row's own max — a page's own
 * quiet vs. busy days stand out even when it's much smaller than the site's top page. */
function heatColor(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "transparent";
  const t = Math.max(0, Math.min(1, value / max));
  const pct = Math.round(8 + t * 77); // 8%..85%, never fully opaque
  return `color-mix(in srgb, var(--clicks) ${pct}%, transparent)`;
}

export function PagePerformance() {
  const [props, setProps] = useState<GaProperty[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [timeframe, setTimeframe] = useState<"1d" | "7d" | "14d" | "28d">("7d");
  const [channel, setChannel] = useState("");
  const [data, setData] = useState<PagePerfData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enableUrl, setEnableUrl] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [propsLoaded, setPropsLoaded] = useState(false);

  const loadProps = useCallback(async () => {
    const res = await fetch("/api/ga/properties");
    const j = await res.json();
    setPropsLoaded(true);
    if (j.needsReconnect) {
      setNeedsReconnect(true);
      return;
    }
    setProps(j.properties ?? []);
    setPropertyId((cur) =>
      cur && (j.properties ?? []).some((p: GaProperty) => p.propertyId === cur)
        ? cur
        : (j.properties?.[0]?.propertyId ?? ""),
    );
  }, []);

  useEffect(() => {
    loadProps();
  }, [loadProps]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setErr(null);
    setEnableUrl(null);
    try {
      const p = new URLSearchParams({ propertyId, timeframe, channel });
      const res = await fetch(`/api/opportunities/page-performance?${p}`);
      const j = await res.json();
      if (j.needsReconnect) setNeedsReconnect(true);
      else if (j.error) {
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

  const maxByRow = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.rows ?? []) {
      m.set(r.page, Math.max(0, ...Object.values(r.byDate)));
    }
    return m;
  }, [data]);

  if (needsReconnect) {
    return (
      <div className="rounded-xl border border-bad/40 bg-bad/10 p-6 text-sm">
        <p className="font-medium">Google Analytics isn&apos;t connected yet.</p>
        <p className="mt-1 text-muted">
          Your Google sign-in needs the Analytics read permission. Enable the{" "}
          <strong>Google Analytics Admin API</strong> and <strong>Data API</strong> in Google
          Cloud, then reconnect.
        </p>
        <a
          href="/api/auth/google"
          className="mt-3 inline-block rounded-md bg-accent px-4 py-2 font-medium text-white"
        >
          Connect Google Analytics
        </a>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className="max-w-xs rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          {!props.length && <option value="">No GA4 properties</option>}
          {props.map((p) => (
            <option key={p.propertyId} value={p.propertyId}>
              {p.accountName ? `${p.accountName} · ` : ""}
              {p.displayName}
            </option>
          ))}
        </select>

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
      {propsLoaded && !props.length && (
        <div className="mb-4 rounded-lg border bg-surface p-3 text-sm text-muted">
          No GA4 properties found for this Google account.
        </div>
      )}

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
                <th className="sticky left-0 z-20 bg-surface px-3 py-2.5 font-medium">Landing page</th>
                {(data?.days ?? []).map((d) => (
                  <th key={d} className="px-2 py-2.5 text-right font-medium whitespace-nowrap">
                    {dayLabel(d, timeframe)}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r) => {
                const max = maxByRow.get(r.page) ?? 0;
                return (
                  <tr key={r.page} className="border-b border-border/60 hover:bg-accent-soft/40">
                    <td
                      className="sticky left-0 z-10 max-w-xs truncate bg-surface px-3 py-2"
                      title={r.page}
                    >
                      {r.page || "/"}
                    </td>
                    {(data?.days ?? []).map((d) => {
                      const v = r.byDate[d] ?? 0;
                      return (
                        <td
                          key={d}
                          className="px-2 py-2 text-right tabular-nums"
                          style={{ background: heatColor(v, max) }}
                          title={`${d}: ${v.toLocaleString()} sessions`}
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
              {!data?.rows.length && (
                <tr>
                  <td
                    colSpan={(data?.days.length ?? 0) + 2}
                    className="px-4 py-10 text-center text-muted"
                  >
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
