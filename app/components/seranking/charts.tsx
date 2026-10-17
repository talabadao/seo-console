"use client";

import { useState } from "react";
import { useElementWidth } from "../ai-area/tracking/useElementWidth";
import type { ChartView } from "../ai-area/tracking/ui";
import { fmtInt } from "./shared";

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function ticksTo(max: number, count = 4): number[] {
  const step = niceMax(max / count);
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export type BubbleKind = "own" | "tracked" | "other";

export const BUBBLE_COLOR: Record<BubbleKind, string> = {
  own: "var(--series-1)",
  tracked: "var(--series-2)",
  other: "var(--text-muted)",
};

export const BUBBLE_LABEL: Record<BubbleKind, string> = {
  own: "Your site",
  tracked: "Tracked competitor",
  other: "Other domain",
};

export interface BubblePoint {
  key: string;
  label: string;
  kind: BubbleKind;
  /** Keywords in the top 10. */
  x: number;
  /** Average position of those top-10 results (1-10). */
  y: number;
  /** Visibility %, drives the bubble area. */
  size: number;
  top3: number;
}

/** Keywords in the top 10 against their average position, bubble area = visibility (SE Ranking's "Distribution of competitors"). */
export function BubbleChart({ points, keywordCount, height = 300 }: { points: BubblePoint[]; keywordCount: number; height?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const M = { top: 18, right: 28, bottom: 38, left: 46 };
  const iw = Math.max(1, width - M.left - M.right);
  const ih = height - M.top - M.bottom;
  const xMax = niceMax(Math.max(1, ...points.map((p) => p.x)) * 1.08);
  const xTicks = ticksTo(xMax);
  const yTicks = [1, 2, 4, 6, 8, 10];
  const sizeMax = Math.max(0.01, ...points.map((p) => p.size));
  const xFor = (v: number) => M.left + (v / xMax) * iw;
  const yFor = (v: number) => M.top + ((Math.min(10, Math.max(1, v)) - 1) / 9) * ih;
  const rFor = (s: number) => 4 + 16 * Math.sqrt(Math.max(0, s) / sizeMax);
  // Context first, the site last, so the site is never hidden under another bubble.
  const order: Record<BubbleKind, number> = { other: 0, tracked: 1, own: 2 };
  const drawn = [...points].sort((a, b) => order[a.kind] - order[b.kind] || b.size - a.size);

  // Label the site and tracked competitors (plus the biggest others when there's room), skipping labels that would collide.
  const placed: Array<{ x: number; y: number; w: number }> = [];
  const labels = new Map<string, { x: number; y: number }>();
  const candidates = [...points].sort((a, b) => order[b.kind] - order[a.kind] || b.size - a.size).slice(0, 10);
  for (const p of candidates) {
    if (p.kind === "other" && labels.size >= 7) continue;
    const r = rFor(p.size);
    const w = p.label.length * 5.6;
    let x = xFor(p.x) + r + 4;
    if (x + w > width - 4) x = xFor(p.x) - r - 4 - w;
    const y = yFor(p.y) + 3.5;
    if (placed.some((q) => Math.abs(q.y - y) < 11 && x < q.x + q.w && q.x < x + w)) continue;
    placed.push({ x, y, w });
    labels.set(p.key, { x, y });
  }
  const h = hover ? points.find((p) => p.key === hover) : null;

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        {(["own", "tracked", "other"] as BubbleKind[])
          .filter((k) => points.some((p) => p.kind === k))
          .map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: BUBBLE_COLOR[k] }} />
              {BUBBLE_LABEL[k]}
            </li>
          ))}
        <li style={{ color: "var(--text-muted)" }}>bubble size = visibility</li>
      </ul>
      <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
        {width > 0 ? (
          <svg width={width} height={height} role="img" aria-label={`Keywords in the top 10 against average position for ${points.length} domains`} className="block">
            {yTicks.map((t) => (
              <g key={`y${t}`}>
                <line x1={M.left} x2={width - M.right} y1={yFor(t)} y2={yFor(t)} stroke="var(--gridline)" />
                <text x={M.left - 8} y={yFor(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-muted)" className="tabular">
                  #{t}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={`x${t}`} x={xFor(t)} y={M.top + ih + 16} textAnchor="middle" fontSize={10} fill="var(--text-muted)" className="tabular">
                {fmtInt(t)}
              </text>
            ))}
            <line x1={M.left} x2={width - M.right} y1={M.top + ih} y2={M.top + ih} stroke="var(--baseline)" />
            <text x={M.left + iw / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
              Keywords in the top 10 (of {fmtInt(keywordCount)} checked)
            </text>
            <text x={12} y={M.top + ih / 2} textAnchor="middle" fontSize={10} fill="var(--text-secondary)" transform={`rotate(-90 12 ${M.top + ih / 2})`}>
              Avg. position in the top 10
            </text>
            {drawn.map((p) => {
              const active = hover === p.key;
              return (
                <g key={p.key} opacity={hover && !active ? 0.45 : 1}>
                  <circle
                    cx={xFor(p.x)}
                    cy={yFor(p.y)}
                    r={rFor(p.size)}
                    fill={BUBBLE_COLOR[p.kind]}
                    fillOpacity={p.kind === "other" ? 0.35 : 0.75}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  />
                  <circle cx={xFor(p.x)} cy={yFor(p.y)} r={rFor(p.size) + 4} fill="transparent" onPointerEnter={() => setHover(p.key)} />
                </g>
              );
            })}
            {[...labels.entries()].map(([key, l]) => {
              const p = points.find((q) => q.key === key);
              return p ? (
                <text key={key} x={l.x} y={l.y} fontSize={10} fontWeight={p.kind === "own" ? 600 : 400} fill={p.kind === "own" ? "var(--text-primary)" : "var(--text-secondary)"} pointerEvents="none">
                  {p.label}
                </text>
              ) : null;
            })}
          </svg>
        ) : (
          <div style={{ height }} />
        )}
        {h ? (
          <div
            className="pointer-events-none absolute z-10 min-w-44 rounded-lg border px-3 py-2 text-xs shadow-md"
            style={{
              top: yFor(h.y) > 110 ? yFor(h.y) - rFor(h.size) - 92 : yFor(h.y) + rFor(h.size) + 8,
              left: xFor(h.x),
              transform: xFor(h.x) > width / 2 ? "translateX(calc(-100% - 16px))" : "translateX(16px)",
              background: "var(--surface-1)",
              borderColor: "var(--border-hairline)",
              color: "var(--text-secondary)",
            }}
          >
            <div className="mb-1 flex items-center gap-1.5 font-semibold" style={{ color: "var(--text-primary)" }}>
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: BUBBLE_COLOR[h.kind] }} />
              {h.label}
            </div>
            <div>Visibility {h.size.toFixed(1)}%</div>
            <div>
              {fmtInt(h.x)} keywords in the top 10 · {fmtInt(h.top3)} in the top 3
            </div>
            <div>Average position #{h.y.toFixed(1)}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface NewLostRow {
  key: string;
  label: string;
  title: string;
  gained: number;
  lost: number;
}

/** Gains above the baseline, losses below, net change as a line - one axis, same unit. */
export function NewLostChart({ rows, unit, view, height = 220 }: { rows: NewLostRow[]; unit: string; view: ChartView; height?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const M = { top: 10, right: 12, bottom: 24, left: 44 };
  const iw = Math.max(1, width - M.left - M.right);
  const ih = height - M.top - M.bottom;
  const up = niceMax(Math.max(1, ...rows.map((r) => r.gained)));
  const down = niceMax(Math.max(1, ...rows.map((r) => r.lost)));
  const yFor = (v: number) => M.top + ((up - v) / (up + down)) * ih;
  const n = rows.length;
  const slot = n ? iw / n : 0;
  const barW = Math.max(4, Math.min(28, slot * 0.6));
  const xFor = (i: number) => M.left + slot * i + slot / 2;
  const net = rows.map((r, i) => `${xFor(i).toFixed(1)},${yFor(r.gained - r.lost).toFixed(1)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  const h = hover !== null ? rows[hover] : null;

  if (view === "table") {
    return (
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-1.5 pr-3 text-left font-medium">Week</th>
              <th className="py-1.5 pr-3 text-right font-medium">New</th>
              <th className="py-1.5 pr-3 text-right font-medium">Lost</th>
              <th className="py-1.5 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.key} className="border-t" style={{ borderColor: "var(--gridline)", color: "var(--text-primary)" }}>
                <td className="py-1.5 pr-3">{r.title}</td>
                <td className="py-1.5 pr-3 text-right tabular">+{fmtInt(r.gained)}</td>
                <td className="py-1.5 pr-3 text-right tabular">−{fmtInt(r.lost)}</td>
                <td className="py-1.5 text-right tabular">
                  {r.gained - r.lost > 0 ? "+" : r.gained - r.lost < 0 ? "−" : ""}
                  {fmtInt(Math.abs(r.gained - r.lost))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--sentiment-positive)" }} />
          New {unit}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--sentiment-negative)" }} />
          Lost {unit}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--text-primary)" }} />
          Net change
        </li>
      </ul>
      <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
        {width > 0 && n > 0 ? (
          <svg width={width} height={height} role="img" aria-label={`New and lost ${unit} per week`} className="block">
            {[up, up / 2, 0, -down / 2, -down]
              // Halfway ticks only where there's room - one side can be much smaller than the other.
              .filter((t) => t === up || t === 0 || t === -down || Math.abs(yFor(t) - yFor(0)) > 22)
              .map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={yFor(t)} y2={yFor(t)} stroke={t === 0 ? "var(--baseline)" : "var(--gridline)"} />
                <text x={M.left - 8} y={yFor(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-muted)" className="tabular">
                  {t > 0 ? "+" : t < 0 ? "−" : ""}
                  {fmtInt(Math.abs(t))}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const gainedTop = yFor(r.gained);
              const lostBottom = yFor(-r.lost);
              const zero = yFor(0);
              return (
                <g key={r.key} opacity={hover === null || hover === i ? 1 : 0.5}>
                  {r.gained > 0 ? <rect x={xFor(i) - barW / 2} y={gainedTop} width={barW} height={Math.max(1, zero - gainedTop - 1)} rx={2} fill="var(--sentiment-positive)" /> : null}
                  {r.lost > 0 ? <rect x={xFor(i) - barW / 2} y={zero + 1} width={barW} height={Math.max(1, lostBottom - zero - 1)} rx={2} fill="var(--sentiment-negative)" /> : null}
                  {i % labelEvery === 0 ? (
                    <text x={xFor(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                      {r.label}
                    </text>
                  ) : null}
                  <rect x={M.left + slot * i} y={M.top} width={slot} height={ih} fill="transparent" onPointerEnter={() => setHover(i)} />
                </g>
              );
            })}
            <polyline points={net} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} strokeLinejoin="round" pointerEvents="none" />
            {rows.map((r, i) => (
              <circle key={r.key} cx={xFor(i)} cy={yFor(r.gained - r.lost)} r={hover === i ? 4 : 2.5} fill="var(--text-primary)" stroke="var(--surface-1)" strokeWidth={1.5} pointerEvents="none" />
            ))}
          </svg>
        ) : (
          <div style={{ height }} />
        )}
        {h && hover !== null ? (
          <div
            className="pointer-events-none absolute z-10 min-w-40 rounded-lg border px-3 py-2 text-xs shadow-md"
            style={{
              top: 0,
              left: xFor(hover),
              transform: xFor(hover) > width / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
              background: "var(--surface-1)",
              borderColor: "var(--border-hairline)",
              color: "var(--text-secondary)",
            }}
          >
            <div className="mb-1 font-semibold" style={{ color: "var(--text-primary)" }}>
              {h.title}
            </div>
            <div className="tabular">New +{fmtInt(h.gained)}</div>
            <div className="tabular">Lost −{fmtInt(h.lost)}</div>
            <div className="tabular font-medium" style={{ color: "var(--text-primary)" }}>
              Net {h.gained - h.lost >= 0 ? "+" : "−"}
              {fmtInt(Math.abs(h.gained - h.lost))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
