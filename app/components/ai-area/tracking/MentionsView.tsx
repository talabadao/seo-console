"use client";

import { useState } from "react";
import { periodMetrics, seriesColor, type DomainRow, type SubjectSeries } from "@/lib/ai-area/tracking/analytics";
import { formatCount, formatPosition, trendTitle } from "@/lib/ai-area/tracking/format";
import { isGoogleHost } from "@/lib/ai-area/tracking/visibility";
import { Favicon } from "./Favicon";
import { TrendChart } from "./TrendChart";
import { ChartTableToggle, Delta, Headline, IconGlobe, IconLink, IconMessage, Panel, Switch, TrackButton, GoogleViaBadge, type ChartView } from "./ui";

interface MentionsViewProps {
  dates: string[];
  series: SubjectSeries[];
  domainRows: DomainRow[];
  excludedDomains: string[];
  compare: boolean;
  onCompareChange: (v: boolean) => void;
  onExclude: (domain: string) => void;
  onUnexclude: (domain: string) => void;
  onTrack: (domain: string) => void;
  periodLabel: string;
  surfaceLabel: string;
}

const VISIBLE_ROWS = 20;

export function MentionsView({
  dates,
  series,
  domainRows,
  excludedDomains,
  compare,
  onCompareChange,
  onExclude,
  onUnexclude,
  onTrack,
  periodLabel,
  surfaceLabel,
}: MentionsViewProps) {
  const [mentionsView, setMentionsView] = useState<ChartView>("chart");
  const [citationsView, setCitationsView] = useState<ChartView>("chart");
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const shown = compare ? series : series.filter((s) => s.subject.isYourBrand);
  const metrics = periodMetrics(series, Math.max(0, series.findIndex((s) => s.subject.isYourBrand)));
  const { mentions, citations } = metrics;
  const trend = trendTitle(metrics.halfDays);
  const canCompare = series.length > 1;
  const compareSwitch = canCompare ? <Switch checked={compare} onChange={onCompareChange} label="Compare competitors" /> : null;

  const chartSeries = (pick: "mentions" | "citations") =>
    shown.map((s) => ({
      id: s.subject.id,
      label: s.subject.name,
      color: seriesColor(s.subject.colorSlot),
      values: s.days.map((d) => d[pick]),
      directLabel: s.subject.isYourBrand,
    }));

  const maxTotal = domainRows[0]?.total ?? 1;
  const visible = showAll ? domainRows : domainRows.slice(0, VISIBLE_ROWS);
  const count = (v: number) => formatCount(Math.round(v));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          icon={<IconMessage />}
          title="Mentions"
          subtitle={`Times your brand appears across ${surfaceLabel.toLowerCase()}`}
          actions={<ChartTableToggle view={mentionsView} onChange={setMentionsView} />}
          footer={
            <>
              <span>{periodLabel}</span>
              {compareSwitch}
            </>
          }
        >
          <Headline
            label="Total mentions"
            value={mentions.value != null ? count(mentions.value) : "–"}
            delta={<Delta value={mentions.delta} format={count} title={trend} />}
          />
          <TrendChart
            dates={dates}
            series={chartSeries("mentions")}
            format={count}
            view={mentionsView}
            ariaLabel="Brand mentions per day"
          />
        </Panel>

        <Panel
          icon={<IconLink />}
          title="Citations"
          subtitle="Times your website is linked in results or AI sources"
          actions={<ChartTableToggle view={citationsView} onChange={setCitationsView} />}
          footer={
            <>
              <span>{periodLabel}</span>
              {compareSwitch}
            </>
          }
        >
          <Headline
            label="Total citations"
            value={citations.value != null ? count(citations.value) : "–"}
            delta={<Delta value={citations.delta} format={count} title={trend} />}
          />
          <TrendChart
            dates={dates}
            series={chartSeries("citations")}
            format={count}
            view={citationsView}
            ariaLabel="Website citations per day"
          />
        </Panel>
      </div>

      <Panel
        icon={<IconGlobe />}
        title="Cited websites"
        subtitle="Every domain in organic results or cited by AI answers"
        bodyClassName="overflow-x-auto"
        footer={
          <>
            <span className="flex items-center gap-2">
              {domainRows.length} domains · {periodLabel}
              {excludedDomains.length > 0 ? (
                <button type="button" onClick={() => setShowHidden((v) => !v)} className="font-medium" style={{ color: "var(--series-1)" }}>
                  {showHidden ? "Hide list" : `${excludedDomains.length} hidden`}
                </button>
              ) : null}
            </span>
            {domainRows.length > VISIBLE_ROWS ? (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="font-medium" style={{ color: "var(--series-1)" }}>
                {showAll ? "Show top 20" : `Show all ${domainRows.length}`}
              </button>
            ) : null}
          </>
        }
      >
        {showHidden && excludedDomains.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--gridline)" }}>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Hidden:
            </span>
            {excludedDomains.map((d) => (
              <span
                key={d}
                className="flex items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-1 text-xs"
                style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
              >
                <Favicon domain={d} size={14} />
                {d}
                <button
                  type="button"
                  onClick={() => onUnexclude(d)}
                  aria-label={`Show ${d} again`}
                  title="Show again"
                  className="flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ color: "var(--text-muted)" }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {domainRows.length === 0 ? (
          <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>
            No cited websites in this period yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs" style={{ borderColor: "var(--gridline)", color: "var(--text-secondary)" }}>
                <th className="w-10 px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 text-right font-medium">Organic</th>
                <th className="px-3 py-2 text-right font-medium">Avg. pos</th>
                <th className="px-3 py-2 text-right font-medium">AI Overview</th>
                <th className="px-3 py-2 text-right font-medium">AI Mode</th>
                <th className="px-3 py-2 text-right font-medium">Keywords</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row, i) => (
                <tr
                  key={row.domain}
                  className="group border-b last:border-b-0"
                  style={{
                    borderColor: "var(--gridline)",
                    background: row.owner?.isYourBrand ? "color-mix(in srgb, var(--series-1) 6%, transparent)" : undefined,
                  }}
                >
                  <td className="px-3 py-2 tabular" style={{ color: "var(--text-muted)" }}>
                    {i + 1}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Favicon domain={row.domain} size={16} />
                      <a
                        href={row.sampleLink ?? `https://${row.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`truncate hover:underline ${row.owner?.isYourBrand ? "font-semibold" : ""}`}
                        style={{ color: "var(--text-primary)" }}
                      >
                        {row.domain}
                      </a>
                      {row.owner ? (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
                          {row.owner.isYourBrand ? "You" : row.owner.name}
                        </span>
                      ) : null}
                      {Object.entries(row.googleVia).map(([via, n]) => (
                        <GoogleViaBadge key={via} via={via} count={n} />
                      ))}
                    </div>
                    <div className="mt-1.5 h-1 w-full max-w-48 rounded" style={{ background: "var(--gridline)" }}>
                      <div
                        className="h-1 rounded"
                        style={{
                          width: `${Math.max(3, (row.total / maxTotal) * 100)}%`,
                          background: row.owner?.isYourBrand ? "var(--series-1)" : "var(--de-emphasis)",
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.organicAppearances || "–"}
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.avgPosition != null ? formatPosition(Math.round(row.avgPosition * 10) / 10) : "–"}
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.aiOverviewCitations || "–"}
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.aiModeCitations || "–"}
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.keywords}
                  </td>
                  <td className="px-3 py-2">
                    {row.owner || isGoogleHost(row.domain) ? null : (
                      <span className="flex items-center justify-end gap-1.5">
                        <TrackButton onClick={() => onTrack(row.domain)} />
                        <button
                          type="button"
                          onClick={() => onExclude(row.domain)}
                          className="rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                          style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
                          title="Hide this blog / OTA from the leaderboard"
                        >
                          Hide
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
