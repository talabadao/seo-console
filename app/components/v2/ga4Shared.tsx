"use client";

// Shared pieces of the GA4 report pages (Ga4Reports, Ga4ReportBuilder): value formatting, the cached-endpoint
// loader, the trend chart and the period/source/freshness footer.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportNotes } from "@/lib/v2/ga4reports/run";
import type { PeriodInfo } from "@/lib/v2/summary/types";
import { fmtInt, fmtMoney, fmtPct, fmtTime } from "./summaryUi";
import { alignSeries, daysOf } from "@/lib/v2/ga4reports/days";

/** Formats a GA4 metric value by its name and type: rates as percentages, seconds as durations, currency. */
export function fmtMetric(name: string, value: number | null | undefined, type?: string, currency?: string | null): string {
  if (value == null || !isFinite(value)) return "—";
  if (/Rate$/.test(name) || /Rate:/.test(name)) return fmtPct(value);
  if (type === "TYPE_SECONDS" || name === "averageSessionDuration") {
    const t = Math.round(value);
    const m = Math.floor(t / 60);
    return m ? `${m}m ${t % 60}s` : `${t}s`;
  }
  if (type === "TYPE_MILLISECONDS") return `${(value / 1000).toFixed(1)}s`;
  if (type === "TYPE_CURRENCY" || /Revenue$/.test(name)) return fmtMoney(value, currency ?? null);
  if (type === "TYPE_FLOAT" || /PerUser$|PerSession$/.test(name)) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return fmtInt(value);
}

/**
 * Loads a cached GA4 endpoint and polls while it answers "pending" (the one shared job is still running).
 * A change of `nonce` is a manual refresh: only that first request asks the server to refresh.
 */
export function useGaJson<T>(url: string | null, init?: { method: string; body: string } | null, nonce = 0): { data: T | null; error: string | null; loading: boolean } {
  const key = `${url}|${init?.body ?? ""}|${nonce}`;
  const [res, setRes] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  const lastNonce = useRef(nonce);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const force = nonce !== lastNonce.current;
    lastNonce.current = nonce;
    const load = (polls: number, first: boolean) => {
      const refresh = first && force;
      const target = !init && refresh ? `${url}${url.includes("?") ? "&" : "?"}refresh=1` : url;
      const body = init ? JSON.stringify({ ...JSON.parse(init.body), refresh }) : undefined;
      fetch(target, init ? { method: init.method, headers: { "Content-Type": "application/json" }, body } : undefined)
        .then(async (r) => {
          const json = await r.json().catch(() => ({}));
          if (!live) return;
          if (json.state === "pending" && polls < 40) {
            timer = setTimeout(() => load(polls + 1, false), 3000);
            return;
          }
          if (!r.ok && !json.state) throw new Error(json.error ?? `Request failed (${r.status})`);
          setRes({ key, data: json as T, error: null });
        })
        .catch((e) => live && setRes({ key, data: null, error: e instanceof Error ? e.message : String(e) }));
    };
    load(0, true);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = res?.key === key ? res : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: Boolean(url) && !current };
}

export type CacheMeta = { state: "fresh" | "stale"; fetchedAt: number | null; refreshing: boolean; lastError: string | null };

/** Period, comparison, source and freshness, plus anything that changes how the numbers read. */
export function ReportFooter({
  period,
  propertyId,
  timeZone,
  currency,
  fetchedAt,
  cache,
  notes,
  extra,
}: {
  period: PeriodInfo;
  propertyId: string;
  timeZone: string | null;
  currency: string | null;
  fetchedAt: number;
  cache?: CacheMeta | null;
  notes: ReportNotes;
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-1 text-xs text-muted">
      <p>
        <strong className="font-medium text-foreground">{period.label}</strong>
        {period.compareLabel ? <> compared with {period.compareLabel}</> : " (no comparison)"}. Dates are the GA4 property&apos;s calendar days
        {timeZone ? ` (${timeZone})` : ""}
        {currency ? `; revenue in ${currency}` : ""}.
      </p>
      <p>
        Source: Google Analytics 4 Data API, property {propertyId.replace("properties/", "")}. Fetched {fmtTime(cache?.fetchedAt ?? fetchedAt)}
        {cache?.state === "stale" ? (cache.refreshing ? " (refreshing in the background)" : " (older than 2 hours)") : ""}. GA4 can revise the last 24–48 hours.
        {cache?.lastError ? ` Last refresh failed: ${cache.lastError}` : ""}
      </p>
      {notes.thresholded && <p>Some rows are withheld by GA4 thresholds (low user counts with Google signals or demographics); totals include them.</p>}
      {notes.sampled && <p>GA4 sampled this report: numbers are estimates.</p>}
      {notes.otherRow && <p>GA4 grouped some low-volume values into an &quot;(other)&quot; row.</p>}
      {notes.truncated && <p>Only the top rows are listed; totals cover every row.</p>}
      {extra}
    </div>
  );
}

export function TrendChart({
  cur,
  prev,
  label,
  split,
  period,
  fill = 0,
}: {
  cur: { date: string; key: string; value: number }[];
  prev: { date: string; key: string; value: number }[] | null;
  label: string;
  /** One line per key (current period only), e.g. per event. */
  split: boolean;
  period: PeriodInfo;
  /** Value for a day GA4 didn't return: 0 for counts, null for rates and averages. */
  fill?: number | null;
}) {
  const { data, keys } = useMemo(() => {
    // One slot per day of the period; the comparison's day N next to the current day N.
    const dates = daysOf(period.current);
    if (split) {
      const keys = [...new Set(cur.map((p) => p.key))];
      const series = keys.map((k) => alignSeries(cur.filter((p) => p.key === k), dates, fill));
      return { data: dates.map((date, i) => Object.fromEntries([["date", date], ...keys.map((k, j) => [k, series[j][i]])])), keys };
    }
    const c = alignSeries(cur, dates, fill);
    const prevDates = prev && period.previous ? daysOf(period.previous) : [];
    const p = prev ? alignSeries(prev, prevDates, fill) : [];
    return {
      data: dates.map((date, i) => ({ date, Current: c[i], ...(prev ? { Comparison: i < p.length ? p[i] : null, comparisonDate: prevDates[i] ?? "" } : {}) })),
      keys: prev ? ["Current", "Comparison"] : ["Current"],
    };
  }, [cur, prev, split, period.current, period.previous, fill]);
  const colors = ["var(--clicks)", "var(--impressions)", "var(--position)", "var(--ctr)", "var(--good)"];
  if (!cur.length) return <p className="py-6 text-center text-sm text-muted">No {label.toLowerCase()} in this period.</p>;
  return (
    <div className="h-56 w-full" role="img" aria-label={`${label} by day`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis tick={{ fontSize: 11 }} width={48} allowDecimals={false} />
          <Tooltip />
          {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeDasharray={k === "Comparison" ? "4 3" : undefined} dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
