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

// Which side each metric's axis sits on, GSC-style.
const AXIS_SIDE: Record<MetricKey, "left" | "right"> = {
  clicks: "left",
  position: "left",
  impressions: "right",
  ctr: "right",
};

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

  // Search Console only shows the numeric axis scales for 1–2 selected metrics;
  // with 3+ on, the stacked axes get noisy, so we hide them (lines only).
  const showScales = active.length > 0 && active.length <= 2;
  const scaleMetrics = showScales ? active : [];
  const allMetrics: MetricKey[] = ["clicks", "impressions", "ctr", "position"];

  return (
    <div className="relative h-72 w-full">
      {/* corner metric labels, like the real Search Console chart */}
      {showScales && active.includes("clicks") && (
        <div
          className="pointer-events-none absolute left-1 top-0 z-10 text-xs"
          style={{ color: METRIC_META.clicks.color }}
        >
          Clicks
        </div>
      )}
      {showScales && active.includes("impressions") && (
        <div
          className="pointer-events-none absolute right-1 top-0 z-10 text-right text-xs"
          style={{ color: METRIC_META.impressions.color }}
        >
          Impressions
        </div>
      )}

      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 28, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "var(--muted)" }}
            minTickGap={28}
            stroke="var(--border)"
          />
          {allMetrics.map((m) => {
            const meta = METRIC_META[m];
            const visible = scaleMetrics.includes(m);
            return (
              <YAxis
                key={m}
                yAxisId={m}
                hide={!visible}
                orientation={AXIS_SIDE[m]}
                width={46}
                axisLine={false}
                tickLine={false}
                reversed={m === "position"}
                domain={m === "position" ? ["dataMin", "dataMax"] : [0, "dataMax"]}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickFormatter={(v: number) => fmt(v, meta.kind)}
              />
            );
          })}

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
  );
}
