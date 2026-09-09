"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { METRIC_META, type MetricKey, fmt, fmtFull } from "./format";
import type { Grain } from "@/lib/dateRanges";

export interface SeriesPoint {
  bucket: string;
  label: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function fullDate(bucket: string, grain: Grain): string {
  try {
    if (grain === "month") return format(parseISO(bucket + "-01"), "MMMM yyyy");
    const d = parseISO(bucket);
    if (grain === "week") return `Week of ${format(d, "EEE, d MMM yyyy")}`;
    return format(d, "EEE, d MMM yyyy");
  } catch {
    return bucket;
  }
}

/** Narrow per-bucket value column shown beside the chart (one metric). */
function SideColumn({
  metric,
  series,
  align,
}: {
  metric: MetricKey;
  series: SeriesPoint[];
  align: "left" | "right";
}) {
  const meta = METRIC_META[metric];
  const total = series.reduce((s, p) => s + p[metric], 0);
  return (
    <div
      className={`hidden w-24 shrink-0 flex-col md:flex ${align === "right" ? "border-l" : "border-r"}`}
    >
      <div className="px-2 py-1.5 text-right">
        <div className="text-[11px] font-medium" style={{ color: meta.color }}>
          {meta.label.replace("Total ", "")}
        </div>
        <div className="text-xs font-semibold tabular-nums">
          {fmt(total, meta.kind)}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {series.map((p) => (
          <div
            key={p.bucket}
            className="flex justify-between gap-1 px-2 py-[3px] text-[11px] tabular-nums even:bg-background/60"
          >
            <span className="text-muted">{p.label}</span>
            <span>{fmt(p[metric], meta.kind)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Chart({
  series,
  prevSeries,
  active,
  grain = "day",
}: {
  series: SeriesPoint[];
  prevSeries?: SeriesPoint[] | null;
  active: MetricKey[];
  grain?: Grain;
}) {
  const data = series.map((pt, i) => {
    const row: Record<string, number | string> = { ...pt };
    const prev = prevSeries?.[i];
    if (prev) {
      for (const m of Object.keys(METRIC_META) as MetricKey[]) row[`prev_${m}`] = prev[m];
      row.prevLabel = prev.label;
    }
    return row;
  });

  if (!series.length) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted">
        No data for this range.
      </div>
    );
  }

  return (
    <div className="flex h-72 w-full">
      <SideColumn metric="clicks" series={series} align="left" />
      <div className="min-w-0 flex-1">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "var(--muted)" }}
              minTickGap={28}
              stroke="var(--border)"
            />
            {active.map((m) => (
              <YAxis
                key={m}
                yAxisId={m}
                hide
                reversed={m === "position"}
                domain={m === "position" ? ["dataMin", "dataMax"] : [0, "dataMax"]}
              />
            ))}
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 13,
              }}
              labelFormatter={((_label: unknown, payload: unknown) => {
                const p = payload as { payload?: SeriesPoint }[] | undefined;
                const bucket = p?.[0]?.payload?.bucket;
                return bucket ? fullDate(bucket, grain) : String(_label);
              }) as never}
              formatter={((value: unknown, name: unknown) => {
                const n = String(name);
                if (n === "prevLabel") return [String(value), "Compared to"];
                const key = n.replace("prev_", "") as MetricKey;
                const meta = METRIC_META[key];
                if (!meta) return [String(value), n];
                const label = n.startsWith("prev_") ? `${meta.label} (prev)` : meta.label;
                return [fmtFull(Number(value) || 0, meta.kind), label];
              }) as never}
            />
            {active.map((m) => (
              <Line
                key={m}
                yAxisId={m}
                type="monotone"
                dataKey={m}
                stroke={METRIC_META[m].color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
            {prevSeries?.length
              ? active.map((m) => (
                  <Line
                    key={`prev_${m}`}
                    yAxisId={m}
                    type="monotone"
                    dataKey={`prev_${m}`}
                    stroke={METRIC_META[m].color}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))
              : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <SideColumn metric="impressions" series={series} align="right" />
    </div>
  );
}
