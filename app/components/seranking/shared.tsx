"use client";

import type { ReactNode } from "react";

export const fmtInt = (v: number | null | undefined) => (v === null || v === undefined ? "–" : Math.round(v).toLocaleString("en-US"));
export const fmtPct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "–" : `${v.toFixed(digits)}%`);
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso.replace(" ", "T")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "–";

/** Movement in positions: positive = moved up (better). Arrow + sign, so it never depends on color alone. */
export function Move({ value, unit = "" }: { value: number | null; unit?: string }) {
  if (value === null) return <span style={{ color: "var(--text-muted)" }}>–</span>;
  if (value === 0) return <span style={{ color: "var(--text-muted)" }}>0</span>;
  const up = value > 0;
  return (
    <span className="whitespace-nowrap font-medium" style={{ color: up ? "var(--success-text)" : "var(--status-critical)" }}>
      {up ? "▲" : "▼"} {Math.abs(value)}
      {unit}
    </span>
  );
}

/** Daily positions as a tiny line; rank 1 at the top, gaps where the keyword wasn't ranking. */
export function PositionSpark({ positions, width = 84, height = 22 }: { positions: Array<{ date: string; pos: number }>; width?: number; height?: number }) {
  const ranked = positions.filter((p) => p.pos > 0).map((p) => p.pos);
  if (ranked.length === 0) return <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>not ranking</span>;
  const lo = Math.min(...ranked);
  const hi = Math.max(lo + 4, ...ranked);
  const x = (i: number) => (positions.length > 1 ? (i / (positions.length - 1)) * (width - 4) + 2 : width / 2);
  const y = (pos: number) => 2 + ((pos - lo) / (hi - lo)) * (height - 4);
  const segments: string[] = [];
  let current = "";
  positions.forEach((p, i) => {
    if (p.pos > 0) current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p.pos).toFixed(1)}`;
    else if (current) {
      segments.push(current);
      current = "";
    }
  });
  if (current) segments.push(current);
  const last = positions.at(-1);
  return (
    <svg width={width} height={height} role="img" aria-label={`Position ${ranked[0]} to ${last && last.pos > 0 ? last.pos : "not ranking"}`}>
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--series-1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {last && last.pos > 0 ? <circle cx={x(positions.length - 1)} cy={y(last.pos)} r={2.5} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={1} /> : null}
    </svg>
  );
}

/** One horizontal bar per row, a single hue; labels and values stay in text ink. */
export function BarList({
  rows,
  max,
  format = (v) => fmtInt(v),
  color = "var(--series-1)",
}: {
  rows: Array<{ label: ReactNode; value: number; key: string; title?: string; color?: string }>;
  max?: number;
  format?: (v: number) => string;
  color?: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4rem] items-center gap-2 text-xs" title={r.title}>
          <span className="truncate" style={{ color: "var(--text-secondary)" }}>
            {r.label}
          </span>
          <span className="h-2.5 rounded" style={{ background: "var(--page-plane)" }}>
            <span className="block h-2.5 rounded" style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / top) * 100)}%`, background: r.color ?? color }} />
          </span>
          <span className="text-right tabular" style={{ color: "var(--text-primary)" }}>
            {format(r.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SectionError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border px-3 py-2 text-xs" role="status" style={{ borderColor: "var(--status-warning)", color: "var(--text-secondary)" }}>
      SE Ranking didn&apos;t return this part: {message}
    </p>
  );
}

export function Th({ children, align = "left", className = "" }: { children: ReactNode; align?: "left" | "right"; className?: string }) {
  return <th className={`py-1.5 pr-3 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</th>;
}
