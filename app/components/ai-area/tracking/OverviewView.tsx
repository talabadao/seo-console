"use client";

import { useMemo, useState } from "react";
import {
  SURFACES,
  SURFACE_LABEL,
  periodMetrics,
  seriesColor,
  type PeriodMetrics,
  type SubjectSeries,
  type SubjectSummary,
  type SurfaceSplit,
} from "@/lib/ai-area/tracking/analytics";
import { formatPct, formatPosition, trendTitle } from "@/lib/ai-area/tracking/format";
import { Favicon } from "./Favicon";
import { TrendChart, type TrendSeries } from "./TrendChart";
import {
  ChartTableToggle,
  Delta,
  Headline,
  IconBars,
  IconEye,
  IconHash,
  IconLayers,
  IconPie,
  Panel,
  Switch,
  type ChartView,
} from "./ui";

interface OverviewViewProps {
  dates: string[];
  series: SubjectSeries[];
  summaries: SubjectSummary[];
  surfaceSplit: SurfaceSplit | null;
  compare: boolean;
  onCompareChange: (v: boolean) => void;
  periodLabel: string;
}

const pts = (v: number) => `${(Math.round(v * 1000) / 10).toString()} pts`;


export function OverviewView({ dates, series, summaries, surfaceSplit, compare, onCompareChange, periodLabel }: OverviewViewProps) {
  const [visView, setVisView] = useState<ChartView>("chart");
  const [posView, setPosView] = useState<ChartView>("chart");
  const [surfaceView, setSurfaceView] = useState<ChartView>("chart");

  const hasCompetitors = series.length > 1;
  const shown = compare ? series : series.filter((s) => s.subject.isYourBrand);
  const metrics = periodMetrics(series, Math.max(0, series.findIndex((s) => s.subject.isYourBrand)));
  const { visibility, avgPosition: position } = metrics;
  const trend = trendTitle(metrics.halfDays);

  const toSeries = (pick: (d: SubjectSeries["days"][number]) => number | null, skipEmpty = false): TrendSeries[] =>
    shown
      .map((s) => ({
        id: s.subject.id,
        label: s.subject.name,
        color: seriesColor(s.subject.colorSlot),
        values: s.days.map(pick),
        directLabel: s.subject.isYourBrand,
      }))
      .filter((s) => !skipEmpty || s.values.some((v) => v != null));

  const compareSwitch = hasCompetitors ? (
    <Switch checked={compare} onChange={onCompareChange} label="Compare competitors" />
  ) : (
    <span>Add competitors in Settings to compare</span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          icon={<IconEye />}
          title="Visibility"
          subtitle="Share of tracked searches where your brand appears"
          actions={<ChartTableToggle view={visView} onChange={setVisView} />}
          footer={
            <>
              <span>{periodLabel}</span>
              {compareSwitch}
            </>
          }
        >
          <Headline
            label="Avg. visibility score"
            value={visibility.value != null ? formatPct(visibility.value) : "–"}
            delta={<Delta value={visibility.delta} format={pts} title={trend} />}
          />
          <TrendChart
            dates={dates}
            series={toSeries((d) => d.visibility)}
            format={formatPct}
            axisFormat={(v) => `${Math.round(v * 100)}%`}
            maxDomain={1}
            view={visView}
            ariaLabel="Visibility score over time"
          />
        </Panel>

        <RankingsPanel summaries={summaries} periodLabel={periodLabel} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          icon={<IconHash />}
          title="Avg. position"
          subtitle="Where your website ranks on days it appears"
          actions={<ChartTableToggle view={posView} onChange={setPosView} />}
          footer={
            <>
              <span>{periodLabel} · where your own site ranks in organic results</span>
              {compareSwitch}
            </>
          }
        >
          <Headline
            label="Avg. position"
            value={position.value != null ? formatPosition(Math.round(position.value * 10) / 10) : "–"}
            delta={
              <Delta
                value={position.delta}
                format={(v) => (Math.round(v * 10) / 10).toString()}
                higherIsBetter={false}
                title={trend}
              />
            }
          />
          <TrendChart
            dates={dates}
            series={toSeries((d) => d.avgPosition, true)}
            format={(v) => formatPosition(Math.round(v * 10) / 10)}
            axisFormat={(v) => `#${v}`}
            invert
            view={posView}
            ariaLabel="Average organic position over time"
          />
        </Panel>

        <ShareOfVoicePanel summaries={summaries} metrics={metrics} periodLabel={periodLabel} />
      </div>

      {surfaceSplit ? (
        <Panel
          icon={<IconLayers />}
          title="Visibility by surface"
          subtitle="Where on Google your brand shows up"
          actions={<ChartTableToggle view={surfaceView} onChange={setSurfaceView} />}
          footer={<span>{periodLabel}</span>}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {SURFACES.map((s, i) => (
              <div key={s} className="flex flex-col gap-1 rounded-lg border p-3" style={{ borderColor: "var(--border-hairline)" }}>
                <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: seriesColor(i + 1) }} />
                  {SURFACE_LABEL[s]}
                </span>
                <span className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
                  {formatPct(surfaceSplit.overall[s])}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {s === "organic"
                    ? "of searches rank your brand"
                    : `shown on ${formatPct(surfaceSplit.presence[s])} of searches`}
                </span>
              </div>
            ))}
          </div>
          <TrendChart
            dates={surfaceSplit.dates}
            series={SURFACES.map((s, i) => ({
              id: s,
              label: SURFACE_LABEL[s],
              color: seriesColor(i + 1),
              values: surfaceSplit.visibility[s],
            }))}
            format={formatPct}
            axisFormat={(v) => `${Math.round(v * 100)}%`}
            maxDomain={1}
            view={surfaceView}
            height={200}
            ariaLabel="Your visibility by surface over time"
          />
        </Panel>
      ) : null}
    </div>
  );
}

type SortKey = "visibility" | "avgPosition" | "share";

function RankingsPanel({ summaries, periodLabel }: { summaries: SubjectSummary[]; periodLabel: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("visibility");

  const sorted = useMemo(() => {
    const rows = [...summaries];
    rows.sort((a, b) => {
      if (sortKey === "avgPosition") {
        if (a.avgPosition == null) return 1;
        if (b.avgPosition == null) return -1;
        return a.avgPosition - b.avgPosition;
      }
      return b[sortKey] - a[sortKey];
    });
    return rows;
  }, [summaries, sortKey]);

  const header = (key: SortKey, label: string) => (
    <th className="px-3 py-2 text-right font-medium">
      <button
        type="button"
        onClick={() => setSortKey(key)}
        className="inline-flex items-center gap-1"
        style={{ color: sortKey === key ? "var(--text-primary)" : "var(--text-secondary)" }}
        aria-sort={sortKey === key ? (key === "avgPosition" ? "ascending" : "descending") : undefined}
      >
        {label}
        <span aria-hidden className="text-[9px]">
          {sortKey === key ? (key === "avgPosition" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );

  return (
    <Panel
      icon={<IconBars />}
      title="Rankings"
      subtitle="Your brand vs tracked competitors"
      bodyClassName="flex-1 overflow-auto"
      footer={<span>{periodLabel} · averaged over the period</span>}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs" style={{ borderColor: "var(--gridline)", color: "var(--text-secondary)" }}>
            <th className="w-10 px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Brand</th>
            {header("visibility", "Visibility")}
            {header("avgPosition", "Avg. pos")}
            {header("share", "Share")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => (
            <tr
              key={s.subject.id}
              className="border-b last:border-b-0"
              style={{
                borderColor: "var(--gridline)",
                background: s.subject.isYourBrand ? "color-mix(in srgb, var(--series-1) 6%, transparent)" : undefined,
              }}
            >
              <td className="px-3 py-2.5 tabular" style={{ color: "var(--text-muted)" }}>
                {i + 1}
              </td>
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <Favicon domain={s.subject.website} label={s.subject.name} size={18} />
                  <span className={`truncate ${s.subject.isYourBrand ? "font-semibold" : ""}`} style={{ color: "var(--text-primary)" }}>
                    {s.subject.name}
                  </span>
                  {s.subject.isYourBrand ? (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
                      You
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular" style={{ color: "var(--text-primary)" }}>
                {formatPct(s.visibility)}
              </td>
              <td className="px-3 py-2.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                {s.avgPosition != null ? formatPosition(Math.round(s.avgPosition * 10) / 10) : "–"}
              </td>
              <td className="px-3 py-2.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                {formatPct(s.share)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {summaries.length <= 1 ? (
        <p className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Add competitors in Settings to rank against them - they apply to history you&apos;ve already collected.
        </p>
      ) : null}
    </Panel>
  );
}

const SIZE = 180;
const STROKE = 26;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

// A donut is read all-pairs (any wedge against any other), which the palette validates for its first
// three hues only - so you plus the two biggest competitors get hues, the rest fold into neutral "Other".
function ShareOfVoicePanel({
  summaries,
  metrics,
  periodLabel,
}: {
  summaries: SubjectSummary[];
  metrics: PeriodMetrics;
  periodLabel: string;
}) {
  const you = summaries.find((s) => s.subject.isYourBrand);
  const others = summaries.filter((s) => !s.subject.isYourBrand).sort((a, b) => b.mentions - a.mentions);
  const total = summaries.reduce((n, s) => n + s.mentions, 0);

  const top = others.slice(0, 2);
  const rest = others.slice(2);
  const restMentions = rest.reduce((n, s) => n + s.mentions, 0);
  const segments = [
    ...(you ? [{ key: you.subject.id, label: you.subject.name, domain: you.subject.website, value: you.mentions, color: "var(--series-1)" }] : []),
    ...top.map((s, i) => ({ key: s.subject.id, label: s.subject.name, domain: s.subject.website, value: s.mentions, color: `var(--series-${i + 2})` })),
    ...(restMentions > 0 ? [{ key: "other", label: `Other (${rest.length})`, domain: "", value: restMentions, color: "var(--de-emphasis)" }] : []),
  ].filter((s) => s.value > 0);

  let offset = 0;
  const arcs = segments.map((s) => {
    const len = total > 0 ? (s.value / total) * CIRC : 0;
    const mid = total > 0 ? ((offset + len / 2) / CIRC) * 2 * Math.PI - Math.PI / 2 : 0;
    const arc = { ...s, dash: `${Math.max(0, len - 2)} ${CIRC - Math.max(0, len - 2)}`, dashOffset: -offset, mid };
    offset += len;
    return arc;
  });

  return (
    <Panel
      icon={<IconPie />}
      title="Share of voice"
      subtitle="Your mentions vs competitors"
      footer={
        <span>
          {you && total > 0 ? `${formatPct(you.mentions / total)} share of voice across ${summaries.length} brands` : periodLabel}
        </span>
      }
    >
      <Headline
        label="Avg. share of voice"
        value={metrics.share.value != null ? formatPct(metrics.share.value) : "–"}
        delta={<Delta value={metrics.share.delta} format={pts} title={trendTitle(metrics.halfDays)} />}
      />
      {total === 0 || summaries.length <= 1 ? (
        <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {summaries.length <= 1 ? "Add competitors in Settings to see share of voice." : "No brand mentions in this period yet."}
        </p>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
          <div className="relative shrink-0" style={{ width: SIZE + 40, height: SIZE + 40 }}>
            <svg width={SIZE + 40} height={SIZE + 40} role="img" aria-label="Share of voice across the period">
              <g transform="translate(20 20)">
                {arcs.map((a) => (
                  <circle
                    key={a.key}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={a.color}
                    strokeWidth={STROKE}
                    strokeDasharray={a.dash}
                    strokeDashoffset={a.dashOffset}
                    transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                  >
                    <title>{`${a.label}: ${formatPct(a.value / total)}`}</title>
                  </circle>
                ))}
              </g>
            </svg>
            {arcs
              .filter((a) => a.key !== "other")
              .map((a) => {
                const r = RADIUS + STROKE / 2 + 14;
                const cx = SIZE / 2 + 20 + Math.cos(a.mid) * r;
                const cy = SIZE / 2 + 20 + Math.sin(a.mid) * r;
                return (
                  <span
                    key={a.key}
                    className="absolute flex items-center justify-center rounded-full border"
                    style={{
                      left: cx - 11,
                      top: cy - 11,
                      width: 22,
                      height: 22,
                      background: "var(--surface-1)",
                      borderColor: "var(--border-hairline)",
                    }}
                  >
                    <Favicon domain={a.domain} label={a.label} size={14} />
                  </span>
                );
              })}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                {you ? formatPct(you.mentions / total) : "–"}
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                of all mentions
              </span>
            </div>
          </div>
          <ul className="flex w-full max-w-56 flex-col gap-2 text-xs">
            {segments.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                <span className="truncate" style={{ color: "var(--text-primary)" }}>
                  {s.label}
                </span>
                <span className="ml-auto tabular" style={{ color: "var(--text-secondary)" }}>
                  {formatPct(s.value / total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
