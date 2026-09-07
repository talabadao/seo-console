export const METRICS = ["clicks", "impressions", "ctr", "position"] as const;
export type MetricKey = (typeof METRICS)[number];

export const METRIC_META: Record<
  MetricKey,
  { label: string; color: string; kind: "count" | "pct" | "pos" }
> = {
  clicks: { label: "Total clicks", color: "var(--clicks)", kind: "count" },
  impressions: { label: "Total impressions", color: "var(--impressions)", kind: "count" },
  ctr: { label: "Average CTR", color: "var(--ctr)", kind: "pct" },
  position: { label: "Average position", color: "var(--position)", kind: "pos" },
};

export function fmt(value: number, kind: "count" | "pct" | "pos"): string {
  if (!isFinite(value)) return "–";
  if (kind === "pct") return `${(value * 100).toFixed(1)}%`;
  if (kind === "pos") return value.toFixed(1);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(0)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

export function fmtFull(value: number, kind: "count" | "pct" | "pos"): string {
  if (!isFinite(value)) return "–";
  if (kind === "pct") return `${(value * 100).toFixed(2)}%`;
  if (kind === "pos") return value.toFixed(1);
  return Math.round(value).toLocaleString();
}

/** Signed delta between current and previous, respecting metric direction. */
export function delta(cur: number, prev: number, kind: "count" | "pct" | "pos") {
  if (!prev) return null;
  const diff = cur - prev;
  const pct = (diff / prev) * 100;
  // For position, lower is better -> flip the "good" sense.
  const good = kind === "pos" ? diff < 0 : diff > 0;
  return { diff, pct, good, kind };
}

/** Collapse very large / infinite percentage changes to a compact symbol. */
export function pctLabel(pct: number): string {
  if (!isFinite(pct) || Math.abs(pct) >= 999) return `${pct < 0 ? "-" : "+"}∞%`;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function deltaLabel(d: ReturnType<typeof delta>): string {
  if (!d) return "";
  return pctLabel(d.pct);
}
