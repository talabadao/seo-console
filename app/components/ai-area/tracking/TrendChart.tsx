"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatShortDate } from "@/lib/ai-area/tracking/format";
import { useElementWidth } from "./useElementWidth";
import type { ChartView } from "./ui";

export interface TrendSeries {
  id: string;
  label: string;
  color: string;
  values: Array<number | null>;
  /** Label the series' last value at the line end (use for the one series the chart is about). */
  directLabel?: boolean;
}

interface TrendChartProps {
  dates: string[];
  series: TrendSeries[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  /** Lower is better (rank positions) - 1 renders at the top. */
  invert?: boolean;
  /** Fixed upper bound for non-inverted charts (e.g. 1 for percentages). */
  maxDomain?: number;
  height?: number;
  view?: ChartView;
  ariaLabel: string;
}

const M = { top: 14, right: 48, bottom: 26, left: 44 };

function niceStep(range: number, count: number): number {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function buildScale(values: number[], invert: boolean, maxDomain?: number) {
  if (invert) {
    // Ranks are whole numbers, so ticks step by 1/2/5/10/20/50 - never 2.5.
    const max = Math.max(10, ...values);
    const raw = (max - 1) / 4;
    const step = [1, 2, 5, 10, 20, 50, 100].find((c) => c >= raw) ?? 100;
    const hi = Math.ceil(max / step) * step;
    const ticks = [1];
    for (let v = step; v <= hi; v += step) ticks.push(v);
    return { lo: 1, hi, ticks };
  }
  const dataMax = Math.max(0, ...values);
  const target = maxDomain != null ? Math.min(maxDomain, dataMax > 0 ? dataMax * 1.15 : maxDomain) : dataMax * 1.1;
  const step = niceStep(target > 0 ? target : 1, 4);
  let hi = Math.ceil((target > 0 ? target : 1) / step) * step;
  if (maxDomain != null) hi = Math.min(hi, maxDomain);
  const ticks: number[] = [];
  for (let v = 0; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < hi - 1e-9) ticks.push(hi);
  return { lo: 0, hi, ticks };
}

export function TrendChart({
  dates,
  series,
  format,
  axisFormat,
  invert = false,
  maxDomain,
  height = 220,
  view = "chart",
  ariaLabel,
}: TrendChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = dates.length;
  const allValues = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const { lo, hi, ticks } = buildScale(allValues, invert, maxDomain);
  const iw = Math.max(1, width - M.left - M.right);
  const ih = height - M.top - M.bottom;
  const xFor = (i: number) => M.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yFor = (v: number) => {
    const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    return M.top + (invert ? t : 1 - t) * ih;
  };
  const fmtAxis = axisFormat ?? format;

  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72))));

  const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = n <= 1 ? 0 : Math.round((x / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n - 1) - 1));
    else if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? 0) + 1));
    else return;
    e.preventDefault();
  };

  const hoverRows =
    hover == null
      ? []
      : series
          .map((s) => ({ s, v: s.values[hover] }))
          .sort((a, b) => {
            if (a.v == null) return 1;
            if (b.v == null) return -1;
            return invert ? a.v - b.v : b.v - a.v;
          });

  return (
    <div className="flex flex-col gap-3">
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div
        ref={ref}
        className="relative w-full outline-none"
        tabIndex={view === "chart" && n > 0 ? 0 : -1}
        onKeyDown={onKeyDown}
        onFocus={() => setHover((h) => h ?? n - 1)}
        onBlur={() => setHover(null)}
      >
        {view === "table" ? (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--gridline)" }}>
                  <th className="py-1.5 pr-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                    Date
                  </th>
                  {series.map((s) => (
                    <th key={s.id} className="py-1.5 pl-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...dates].reverse().map((date) => {
                  const i = dates.indexOf(date);
                  return (
                    <tr key={date} className="border-b" style={{ borderColor: "var(--gridline)" }}>
                      <td className="py-1.5 pr-3" style={{ color: "var(--text-primary)" }}>
                        {formatShortDate(date)}
                      </td>
                      {series.map((s) => (
                        <td key={s.id} className="py-1.5 pl-3 text-right tabular" style={{ color: "var(--text-primary)" }}>
                          {s.values[i] != null ? format(s.values[i] as number) : "–"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : n === 0 ? (
          <div className="flex items-center justify-center text-sm" style={{ height, color: "var(--text-muted)" }}>
            No data in this period yet.
          </div>
        ) : width === 0 ? (
          <div style={{ height }} />
        ) : (
          <>
            <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={M.left}
                    x2={width - M.right}
                    y1={yFor(t)}
                    y2={yFor(t)}
                    stroke={!invert && t === lo ? "var(--baseline)" : "var(--gridline)"}
                    strokeWidth={1}
                  />
                  <text x={M.left - 8} y={yFor(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-muted)" className="tabular">
                    {fmtAxis(t)}
                  </text>
                </g>
              ))}

              {dates.map((d, i) =>
                i % labelStep === 0 || i === n - 1 ? (
                  (i === n - 1 || n - 1 - i >= labelStep * 0.6) ? (
                    <text key={d} x={xFor(i)} y={height - 7} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                      {formatShortDate(d)}
                    </text>
                  ) : null
                ) : null
              )}

              {hover != null ? (
                <line x1={xFor(hover)} x2={xFor(hover)} y1={M.top} y2={M.top + ih} stroke="var(--baseline)" strokeWidth={1} />
              ) : null}

              {series.map((s) => {
                let d = "";
                let drawing = false;
                const isolated: number[] = [];
                s.values.forEach((v, i) => {
                  if (v == null) {
                    drawing = false;
                    return;
                  }
                  d += `${drawing ? "L" : "M"}${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)} `;
                  const prevNull = i === 0 || s.values[i - 1] == null;
                  const nextNull = i === n - 1 || s.values[i + 1] == null;
                  if (prevNull && nextNull) isolated.push(i);
                  drawing = true;
                });
                let last = -1;
                s.values.forEach((v, i) => {
                  if (v != null) last = i;
                });
                return (
                  <g key={s.id}>
                    <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {isolated
                      .filter((i) => i !== last)
                      .map((i) => (
                        <circle key={i} cx={xFor(i)} cy={yFor(s.values[i] as number)} r={3} fill={s.color} />
                      ))}
                    {last >= 0 ? (
                      <circle cx={xFor(last)} cy={yFor(s.values[last] as number)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                    ) : null}
                    {s.directLabel && last >= 0 ? (
                      <text
                        x={xFor(last) + 8}
                        y={yFor(s.values[last] as number) + 3.5}
                        fontSize={11}
                        fontWeight={600}
                        fill="var(--text-primary)"
                        className="tabular"
                      >
                        {format(s.values[last] as number)}
                      </text>
                    ) : null}
                    {hover != null && s.values[hover] != null ? (
                      <circle cx={xFor(hover)} cy={yFor(s.values[hover] as number)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                    ) : null}
                  </g>
                );
              })}

              <rect
                x={M.left - 8}
                y={M.top}
                width={iw + 16}
                height={ih}
                fill="transparent"
                onPointerMove={onPointerMove}
                onPointerLeave={() => setHover(null)}
              />
            </svg>

            {hover != null ? (
              <div
                className="pointer-events-none absolute z-10 min-w-40 rounded-lg border px-3 py-2 text-xs shadow-md"
                style={{
                  top: M.top,
                  left: xFor(hover),
                  transform: xFor(hover) > width / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
                  background: "var(--surface-1)",
                  borderColor: "var(--border-hairline)",
                }}
              >
                <div className="mb-1.5 font-medium" style={{ color: "var(--text-secondary)" }}>
                  {formatShortDate(dates[hover])}
                </div>
                <ul className="flex flex-col gap-1">
                  {hoverRows.map(({ s, v }) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className="w-12 font-semibold tabular" style={{ color: "var(--text-primary)" }}>
                        {v != null ? format(v) : "–"}
                      </span>
                      <span aria-hidden className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: s.color }} />
                      <span className="truncate" style={{ color: "var(--text-secondary)" }}>
                        {s.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
