"use client";

// Presentation helpers for summary sections: state badges, deltas, number
// formats, the section card with its source/freshness footer, and the period
// picker. Missing values render as "—" with an explanation, never as 0.

import type { ReactNode } from "react";
import type { MetricPair, Section, SectionMeta, SectionState } from "@/lib/v2/summary/types";
import { COMPARE_MODES, RANGE_PRESETS, pctChange, type CompareMode, type RangePreset } from "@/lib/v2/summary/period";
import { ATTAINMENT_LABEL } from "@/lib/v2/summary/kpi";
import type { KpiAttainment } from "@/lib/v2/summary/types";

const STATE: Record<SectionState, { label: string; color: string; title: string }> = {
  live: { label: "Live", color: "var(--good)", title: "Real data from a connected source" },
  demo: { label: "Demo", color: "var(--position)", title: "Invented sample data, not a measurement" },
  "not-connected": { label: "Not connected", color: "var(--bad)", title: "This project is missing the connection this needs" },
  unavailable: { label: "Unavailable", color: "var(--muted)", title: "Connected, but there's nothing to show yet" },
  error: { label: "Error", color: "var(--bad)", title: "The request to the source failed" },
  pending: { label: "Loading", color: "var(--muted)", title: "Fetching from the source for the first time" },
};

export function StateBadge({ state, small = false }: { state: SectionState; small?: boolean }) {
  const s = STATE[state];
  return (
    <span
      title={s.title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium text-foreground ${small ? "px-1.5 py-0 text-[11px]" : "px-2 py-0.5 text-xs"}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function StaleBadge() {
  return (
    <span title="The source's latest data is older than usual" className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium" style={{ borderColor: "var(--position)" }}>
      Stale
    </span>
  );
}

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const fmtCompact = (n: number | null | undefined) =>
  n == null ? "—" : Math.abs(n) >= 10_000 ? Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) : fmtInt(n);
export const fmtPct = (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);
export const fmtPos = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));
export function fmtMoney(n: number | null | undefined, currency: string | null) {
  if (n == null || !currency) return "—";
  try {
    return Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${fmtInt(n)} ${currency}`;
  }
}
export function fmtTime(ms: number | undefined) {
  if (!ms) return null;
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Change vs the comparison period. `lowerIsBetter` for positions; `absolute` shows the difference instead of a
 * percentage (`integer` for counts). A zero comparison value reads "New", never an infinite percentage.
 */
export function Delta({
  pair,
  lowerIsBetter = false,
  absolute = false,
  integer = false,
}: {
  pair: MetricPair | null | undefined;
  lowerIsBetter?: boolean;
  absolute?: boolean;
  integer?: boolean;
}) {
  if (!pair || pair.current == null || pair.previous == null) {
    return <span className="text-xs text-muted" title="No comparison value">—</span>;
  }
  const diff = pair.current - pair.previous;
  const pct = pctChange(pair.current, pair.previous);
  if (!absolute && pct == null) {
    return pair.current > 0 ? (
      <span className="text-xs font-medium" style={{ color: "var(--good)" }} title="Nothing in the comparison period">
        New
      </span>
    ) : (
      <span className="text-xs text-muted">±0%</span>
    );
  }
  const value = absolute ? diff : pct!;
  if (Math.abs(value) < (absolute ? (integer ? 0.5 : 0.05) : 0.5)) return <span className="text-xs text-muted">±0{absolute ? "" : "%"}</span>;
  const good = lowerIsBetter ? value < 0 : value > 0;
  return (
    <span className="whitespace-nowrap text-xs font-medium tabular-nums" style={{ color: good ? "var(--good)" : "var(--bad)" }}>
      <span aria-hidden="true">{value > 0 ? "▲" : "▼"}</span>
      <span className="sr-only">{value > 0 ? "up" : "down"}</span>{" "}
      {absolute ? (integer ? Math.round(Math.abs(value)) : Math.abs(value).toFixed(1)) : `${Math.abs(value).toFixed(0)}%`}
    </span>
  );
}

export function Stat({
  label,
  value,
  pair,
  lowerIsBetter,
  absolute,
  integer,
  hint,
  scope,
}: {
  label: string;
  value: string;
  pair?: MetricPair | null;
  lowerIsBetter?: boolean;
  absolute?: boolean;
  integer?: boolean;
  hint?: string;
  /** Short traffic scope shown under the label, e.g. "Organic Search". */
  scope?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-muted" title={hint ?? label}>
        {label}
      </div>
      {scope && <div className="text-[11px] leading-tight text-muted">{scope}</div>}
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {pair !== undefined && <Delta pair={pair} lowerIsBetter={lowerIsBetter} absolute={absolute} integer={integer} />}
      </div>
    </div>
  );
}

/** Footer line: where the numbers come from and how fresh they are. */
export function SourceLine({ meta }: { meta: SectionMeta }) {
  const parts = [`Source: ${meta.source}`];
  if (meta.dataThrough) parts.push(`data through ${meta.dataThrough}`);
  const t = fmtTime(meta.cache?.fetchedAt ?? meta.fetchedAt);
  if (t) parts.push(`fetched ${t}`);
  const c = meta.cache;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2 text-xs text-muted">
      <span>{parts.join(" · ")}</span>
      {meta.state === "demo" && <span className="font-medium text-foreground">Demo data — not a measurement.</span>}
      {c?.state === "stale" && <span className="font-medium text-foreground">Saved result{c.refreshing ? "; refreshing in the background" : ""}.</span>}
      {c?.cooldown && <span>Refreshed a few minutes ago, so it wasn&apos;t fetched again.</span>}
      {c?.lastError && <span title={c.lastError}>Last refresh failed; showing the last successful result.</span>}
    </p>
  );
}

/**
 * A dashboard section. Renders `children` only for live or demo data; other
 * states show their reason, with an optional action (e.g. open settings).
 */
export function SectionCard<T>({
  title,
  section,
  loading,
  children,
  action,
  headerExtra,
  className = "",
}: {
  title: string;
  section: Section<T> | undefined;
  loading?: boolean;
  children: (data: T) => ReactNode;
  action?: ReactNode;
  headerExtra?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-xl border bg-surface ${className}`} aria-busy={loading || undefined}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {section && !loading && <StateBadge state={section.state} />}
        {section?.stale && <StaleBadge />}
        {headerExtra && <div className="ml-auto flex items-center gap-2">{headerExtra}</div>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-4">
        {loading || !section || section.state === "pending" ? (
          <div role="status" className="space-y-3" aria-label={`Loading ${title}`}>
            {[80, 65, 50].map((w) => (
              <div key={w} className="h-4 animate-pulse rounded bg-border/70" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (section.state === "live" || section.state === "demo") && section.data !== undefined ? (
          <div className="min-w-0 flex-1">{children(section.data)}</div>
        ) : section.state === "error" ? (
          <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
            <p className="font-medium">Couldn&apos;t load this from {section.source}.</p>
            {section.message && <p className="mt-1 break-words text-muted">{section.message}</p>}
            <p className="mt-1 text-xs text-muted">No numbers are shown instead.</p>
          </div>
        ) : (
          <div className="text-sm text-muted">
            <p>{section.message ?? "Nothing to show."}</p>
            {action && <div className="mt-3">{action}</div>}
          </div>
        )}
        {section && !loading && (section.state === "live" || section.state === "demo") && <SourceLine meta={section} />}
      </div>
    </section>
  );
}

export function PeriodPicker({
  value,
  onChange,
}: {
  value: { preset: RangePreset; compare: CompareMode };
  onChange: (v: { preset: RangePreset; compare: CompareMode }) => void;
}) {
  const sel = "rounded-md border bg-background px-2 py-1.5 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="period-preset">
        Date range
      </label>
      <select id="period-preset" className={sel} value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value as RangePreset })}>
        {RANGE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="period-compare">
        Compare with
      </label>
      <select id="period-compare" className={sel} value={value.compare} onChange={(e) => onChange({ ...value, compare: e.target.value as CompareMode })}>
        {COMPARE_MODES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id === "none" ? c.label : `vs ${c.label.toLowerCase()}`}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ProgressBar({ pct, tone = "neutral" }: { pct: number; tone?: "good" | "bad" | "neutral" | "demo" }) {
  const color = tone === "good" ? "var(--good)" : tone === "bad" ? "var(--bad)" : tone === "demo" ? "var(--position)" : "var(--accent)";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-border/70" role="presentation">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

/** KPI attainment pill: target attainment only, never a project delivery status. */
export function AttainmentPill({ attainment }: { attainment: KpiAttainment }) {
  const color =
    attainment === "achieved" ? "var(--good)" : attainment === "below" || attainment === "above" ? "var(--bad)" : attainment === "in-progress" ? "var(--accent)" : "var(--muted)";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {ATTAINMENT_LABEL[attainment]}
    </span>
  );
}

export const KPI_DEFINITION =
  "Attainment compares the month-to-date value with the full-month target; while the month is running a KPI below its target is “In progress”. The projection estimates the month end from the last 30 days' daily rate.";

/** Tiny trend line for a headline number. Decorative; the number and its change carry the meaning. */
export function Sparkline({ values, color = "var(--clicks)", width = 96, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0">
      <polygon points={`0,${height} ${pts.join(" ")} ${width},${height}`} fill={color} opacity={0.12} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
