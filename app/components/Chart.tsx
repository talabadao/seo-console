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
import { METRIC_META, type MetricKey, fmtFull } from "./format";

export interface SeriesPoint {
  bucket: string;
  label: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export function Chart({
  series,
  prevSeries,
  active,
}: {
  series: SeriesPoint[];
  prevSeries?: SeriesPoint[] | null;
  active: MetricKey[];
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
    <div className="h-72 w-full">
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
