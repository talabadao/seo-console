"use client";

// Rank tracking → SE Ranking → Overview, adapted from AI Brand Mention's OverviewSection. Differences, for
// consistency with the dashboard card and the Rankings tab:
// - Headline Top 10 / average position / movers use the same view as the card: the engine with most keywords, all
//   keyword groups, the last 28 days compared with 28 days earlier (lib/seranking/metrics.ts viewReport). SE Ranking's
//   own summary (all engines) supplies only visibility, Domain Trust and indexed pages, and is labelled as such.
// - Site audit, competitors and backlinks are summaries of saved data with links to their own pages (Technical SEO,
//   Competitive research, Link Building); opening the overview never fetches those modules. The donor's AI prompts
//   panel isn't ported (not part of this module).

import { useMemo, useState } from "react";
import type { HistoryMetric, SeAudit, SeBacklinks, SeCompetition, SeEngine, SeSnapshot, SeSummary } from "@/lib/seranking/donor/types";
import { AVG_POSITION_DEFINITION, type SeKeywordView, type SeReportView } from "@/lib/seranking/metrics";
import { TrendChart } from "../ai-area/tracking/TrendChart";
import { ChartTableToggle, Delta, Headline, Panel, Segmented, type ChartView } from "../ai-area/tracking/ui";
import { BarList, Move, fmtInt, fmtPct } from "./shared";

const METRICS: Array<{ value: HistoryMetric; label: string }> = [
  { value: "visibility_percent", label: "Visibility %" },
  { value: "avg_pos", label: "Avg. position" },
  { value: "top10", label: "Keywords in top 10" },
];

const BUCKETS: Array<{ label: string; test: (p: number | null | undefined) => boolean }> = [
  { label: "1–3", test: (p) => p != null && p <= 3 },
  { label: "4–10", test: (p) => p != null && p > 3 && p <= 10 },
  { label: "11–20", test: (p) => p != null && p > 10 && p <= 20 },
  { label: "21–50", test: (p) => p != null && p > 20 && p <= 50 },
  { label: "51–100", test: (p) => p != null && p > 50 },
  { label: "Not in top 100", test: (p) => p === null },
  { label: "Not checked", test: (p) => p === undefined },
];

export interface OverviewData {
  summary: SeSummary | null;
  engines: SeEngine[];
  history: SeSnapshot["history"];
  backlinks: SeBacklinks | null;
  errors: SeSnapshot["errors"];
}

export function HostOverview({
  data,
  view,
  audit,
  competition,
  onOpen,
}: {
  data: OverviewData;
  view: SeReportView | null;
  audit: { audit: SeAudit | null } | "not-fetched" | null;
  competition: { competition: SeCompetition | null } | "not-fetched" | null;
  onOpen: (target: "rankings" | "audit" | "competitors" | "backlinks") => void;
}) {
  const [metric, setMetric] = useState<HistoryMetric>("visibility_percent");
  const [days, setDays] = useState<"30" | "90" | "180">("90");
  const [chartView, setChartView] = useState<ChartView>("chart");
  const s = data.summary;

  const { dates, series } = useMemo(() => {
    // Per-engine series only: SE Ranking's "Average for all" weighs engines equally regardless of keyword count.
    const rows = (data.history[metric] ?? []).filter((r) => r.engineId !== null);
    const all = [...new Set(rows.flatMap((r) => r.points.map((p) => p.date)))].sort();
    const cut = all.slice(-Number(days));
    return {
      dates: cut,
      series: rows.map((r, i) => {
        const byDate = new Map(r.points.map((p) => [p.date, p.value]));
        return { id: String(r.engineId), label: r.name, color: `var(--series-${(i % 8) + 1})`, values: cut.map((d) => byDate.get(d) ?? null) };
      }),
    };
  }, [data.history, metric, days]);

  const keywords: SeKeywordView[] = view?.keywords ?? [];
  const gains = keywords.filter((k) => (k.change7 ?? 0) > 0).sort((a, b) => (b.change7 ?? 0) - (a.change7 ?? 0)).slice(0, 6);
  const drops = keywords.filter((k) => (k.change7 ?? 0) < 0).sort((a, b) => (a.change7 ?? 0) - (b.change7 ?? 0)).slice(0, 6);
  const up = keywords.filter((k) => (k.change7 ?? 0) > 0).length;
  const down = keywords.filter((k) => (k.change7 ?? 0) < 0).length;
  const a = audit && audit !== "not-fetched" ? audit.audit : null;
  const comp = competition && competition !== "not-fetched" ? competition.competition : null;

  return (
    <div className="flex flex-col gap-4">
      <section
        className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border p-4 md:grid-cols-3 xl:grid-cols-6"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
        aria-label="Headline numbers"
      >
        <Headline
          label="Average position"
          value={view?.current.avgPosition != null ? `#${view.current.avgPosition.toFixed(1)}` : "–"}
          delta={
            view?.current.avgPosition != null && view.previous?.avgPosition != null ? (
              <Delta value={Math.round((view.previous.avgPosition - view.current.avgPosition) * 10) / 10} format={(v) => v.toFixed(1)} title={`positions gained since ${view.comparisonDate}`} />
            ) : undefined
          }
        />
        <Headline label="Keywords in top 10" value={view ? fmtInt(view.current.top10) : "–"} delta={view ? <span className="text-xs" style={{ color: "var(--text-muted)" }}>of {fmtInt(keywords.length)}</span> : undefined} />
        <Headline label="Moved up / down (7 days)" value={view ? `${fmtInt(up)} / ${fmtInt(down)}` : "–"} />
        <Headline label="Visibility (SE Ranking, all engines)" value={fmtPct(s?.visibilityPercent, 1)} />
        <Headline label="Domain Trust" value={fmtInt(s?.domainTrust)} />
        <Headline
          label="Site health"
          value={a?.score != null ? `${a.score}/100` : "–"}
          delta={a?.score != null && a.prevScore != null ? <Delta value={a.score - a.prevScore} format={(v) => String(v)} title="vs the previous audit" /> : undefined}
        />
      </section>
      {view && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Average position, Top 10 and movers: {view.engine.name}
          {view.engine.region ? ` · ${view.engine.region}` : ""}
          {view.engine.language ? ` · ${view.engine.language}` : ""}
          {view.engine.device ? ` · ${view.engine.device}` : ""}, all keyword groups, checked {view.latestDate}
          {view.comparisonDate ? ` vs ${view.comparisonDate}` : ""} — the same scope as the dashboard card. {AVG_POSITION_DEFINITION}
        </p>
      )}

      <Panel
        title="Rankings over time"
        subtitle="SE Ranking's daily rank checks, per search engine"
        actions={<ChartTableToggle view={chartView} onChange={setChartView} />}
        footer={
          <>
            <span>
              Domain Trust {fmtInt(s?.domainTrust)} · {fmtInt(s?.indexGoogle)} pages indexed in Google (SE Ranking)
            </span>
            <span>{data.engines.map((e) => `${e.name}: ${e.keywordCount} keywords`).join(" · ")}</span>
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented value={metric} options={METRICS} onChange={setMetric} ariaLabel="Metric" />
          <Segmented
            value={days}
            options={[
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "180", label: "6 months" },
            ]}
            onChange={setDays}
            ariaLabel="Period"
          />
        </div>
        {dates.length ? (
          <TrendChart
            dates={dates}
            series={series}
            format={metric === "visibility_percent" ? (v) => `${v.toFixed(1)}%` : metric === "avg_pos" ? (v) => `#${Math.round(v)}` : (v) => fmtInt(v)}
            axisFormat={metric === "visibility_percent" ? (v) => `${v}%` : metric === "avg_pos" ? (v) => `#${v}` : (v) => String(v)}
            invert={metric === "avg_pos"}
            maxDomain={metric === "visibility_percent" ? 100 : undefined}
            view={chartView}
            ariaLabel="Rankings over time"
          />
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {data.errors.history ? `SE Ranking didn't return the history: ${data.errors.history}` : "No ranking history yet."}
          </p>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Position spread" subtitle={view ? `${fmtInt(keywords.length)} keywords, ${view.engine.name}, latest check` : "latest check"}>
          {view ? <BarList rows={BUCKETS.map((b) => ({ key: b.label, label: b.label, value: keywords.filter((k) => b.test(k.current)).length }))} /> : <Muted text="Rankings aren't loaded." />}
        </Panel>
        <Panel title="Biggest gains" subtitle="positions gained in 7 days" actions={<OpenLink onClick={() => onOpen("rankings")} />}>
          <MoverList rows={gains} empty="No keyword moved up this week." />
        </Panel>
        <Panel title="Biggest drops" subtitle="positions lost in 7 days" actions={<OpenLink onClick={() => onOpen("rankings")} />}>
          <MoverList rows={drops} empty="No keyword dropped this week." />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Site audit" subtitle={a ? `${a.title} · ${a.status}` : "Technical SEO → Site audit"} actions={<OpenLink onClick={() => onOpen("audit")} label="Open site audit" />}>
          {a ? (
            <div className="grid grid-cols-4 gap-3 text-center">
              {(
                [
                  ["Errors", a.errors],
                  ["Warnings", a.warnings],
                  ["Notices", a.notices],
                  ["Pages", a.pages],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                    {fmtInt(value)}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Muted text={audit === "not-fetched" ? "Not loaded yet: open the site audit to read SE Ranking's latest audit." : audit ? "No site audit in SE Ranking for this site." : "Loading…"} />
          )}
        </Panel>
        <Panel title="Competitors" subtitle={comp ? `top-10 visibility, ${comp.date}` : "Competitive research → Competitor overview"} actions={<OpenLink onClick={() => onOpen("competitors")} label="Open competitors" />}>
          {comp ? (
            <BarList
              format={(v) => `${v.toFixed(1)}%`}
              rows={comp.domains.slice(0, 6).map((d) => ({ key: d.domain, label: d.isOwn ? `${d.domain} (you)` : d.domain, value: d.visibility, color: d.isOwn ? "var(--series-1)" : "var(--series-4)" }))}
            />
          ) : (
            <Muted text={competition === "not-fetched" ? "Not loaded yet: open Competitor overview to read SE Ranking's competitor data." : competition ? "SE Ranking returned no competition data." : "Loading…"} />
          )}
        </Panel>
        <Panel title="Backlinks" subtitle="SE Ranking Backlink Monitor" actions={<OpenLink onClick={() => onOpen("backlinks")} label="Open backlinks" />}>
          {data.backlinks && data.backlinks.total > 0 ? (
            <div className="grid grid-cols-3 gap-3 text-center">
              {(
                [
                  ["Backlinks", data.backlinks.total],
                  ["Ref. domains", data.backlinks.domains],
                  ["Dofollow", data.backlinks.dofollow],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                    {fmtInt(value)}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Muted text={data.errors.backlinks ? `SE Ranking didn't return Backlink Monitor stats: ${data.errors.backlinks}` : "No links tracked in SE Ranking's Backlink Monitor. The full backlink profile (Data API) is on the Backlinks page."} />
          )}
        </Panel>
      </div>
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return (
    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
      {text}
    </p>
  );
}

function OpenLink({ onClick, label = "Details" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
      {label}
    </button>
  );
}

function MoverList({ rows, empty }: { rows: SeKeywordView[]; empty: string }) {
  if (!rows.length) return <Muted text={empty} />;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((k) => (
        <li key={k.id} className="grid grid-cols-[minmax(0,1fr)_3rem_3.5rem] items-center gap-2 text-xs">
          <span className="truncate" style={{ color: "var(--text-primary)" }} title={k.name}>
            {k.name}
          </span>
          <span className="text-right tabular" style={{ color: "var(--text-secondary)" }}>
            {k.current ? `#${k.current}` : "–"}
          </span>
          <span className="text-right tabular">
            <Move value={k.change7} />
          </span>
        </li>
      ))}
    </ul>
  );
}
