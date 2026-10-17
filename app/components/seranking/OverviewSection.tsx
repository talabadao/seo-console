"use client";

import { useMemo, useState } from "react";
import type { HistoryMetric, SeSnapshot } from "@/lib/seranking/donor/types";
import { ChartTableToggle, Delta, Headline, Panel, Segmented, type ChartView } from "../ai-area/tracking/ui";
import { TrendChart } from "../ai-area/tracking/TrendChart";
import { BarList, Move, fmtInt, fmtPct } from "./shared";

const METRICS: Array<{ value: HistoryMetric; label: string }> = [
  { value: "visibility_percent", label: "Visibility %" },
  { value: "avg_pos", label: "Avg. position" },
  { value: "top10", label: "Keywords in top 10" },
];

const BUCKETS: Array<{ label: string; test: (p: number | null) => boolean }> = [
  { label: "1–3", test: (p) => p !== null && p <= 3 },
  { label: "4–10", test: (p) => p !== null && p > 3 && p <= 10 },
  { label: "11–20", test: (p) => p !== null && p > 10 && p <= 20 },
  { label: "21–50", test: (p) => p !== null && p > 20 && p <= 50 },
  { label: "51–100", test: (p) => p !== null && p > 50 },
  { label: "Not ranking", test: (p) => p === null },
];

export function OverviewSection({ snap, onOpen }: { snap: SeSnapshot; onOpen: (section: "rankings" | "audit" | "ai") => void }) {
  const [metric, setMetric] = useState<HistoryMetric>("visibility_percent");
  const [days, setDays] = useState<"30" | "90" | "180">("90");
  const [view, setView] = useState<ChartView>("chart");
  const s = snap.summary;

  const { dates, series } = useMemo(() => {
    // Per-engine series only: SE Ranking's "Average for all" weighs engines equally regardless of keyword count.
    const rows = (snap.history[metric] ?? []).filter((r) => r.engineId !== null);
    const all = [...new Set(rows.flatMap((r) => r.points.map((p) => p.date)))].sort();
    const cut = all.slice(-Number(days));
    return {
      dates: cut,
      series: rows.map((r, i) => {
        const byDate = new Map(r.points.map((p) => [p.date, p.value]));
        return { id: String(r.engineId), label: r.name, color: `var(--series-${(i % 8) + 1})`, values: cut.map((d) => byDate.get(d) ?? null) };
      }),
    };
  }, [snap.history, metric, days]);

  const latestKeywords = snap.keywords;
  const gains = [...latestKeywords].filter((k) => (k.change7 ?? 0) > 0).sort((a, b) => (b.change7 ?? 0) - (a.change7 ?? 0)).slice(0, 6);
  const drops = [...latestKeywords].filter((k) => (k.change7 ?? 0) < 0).sort((a, b) => (a.change7 ?? 0) - (b.change7 ?? 0)).slice(0, 6);
  const total = latestKeywords.length;
  // With several search engines, the same keyword appears once per engine - name the engine.
  const engineNames = snap.engines.length > 1 ? Object.fromEntries(snap.engines.map((e) => [e.id, e.name.replace(/^Google\s+/, "")])) : {};
  const aiEngines = snap.ai?.engines ?? [];
  const aiMention = aiEngines.length ? aiEngines.reduce((sum, e) => sum + (e.mentionPct ?? 0), 0) / aiEngines.length : null;
  const aiMentionDiff = aiEngines.length ? aiEngines.reduce((sum, e) => sum + (e.mentionDiff ?? 0), 0) / aiEngines.length : null;

  return (
    <div className="flex flex-col gap-4">
      <section
        className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border p-4 md:grid-cols-3 xl:grid-cols-6"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
        aria-label="Headline numbers"
      >
        <Headline
          label="Average position"
          value={s?.todayAvg ? `#${fmtInt(s.todayAvg)}` : "–"}
          delta={s?.todayAvg && s.yesterdayAvg ? <Delta value={s.yesterdayAvg - s.todayAvg} format={(v) => String(Math.round(v))} title="positions gained since the previous check" /> : undefined}
        />
        <Headline label="Visibility" value={fmtPct(s?.visibilityPercent, 1)} />
        <Headline label="Keywords in top 10" value={s ? `${fmtInt(s.top10)}` : "–"} delta={total ? <span className="text-xs" style={{ color: "var(--text-muted)" }}>of {fmtInt(total)}</span> : undefined} />
        <Headline
          label="Moved up / down"
          value={s ? `${fmtInt(s.up)} / ${fmtInt(s.down)}` : "–"}
        />
        <Headline
          label="Site health"
          value={snap.audit?.score !== null && snap.audit?.score !== undefined ? `${snap.audit.score}/100` : "–"}
          delta={
            snap.audit?.score != null && snap.audit.prevScore != null ? <Delta value={snap.audit.score - snap.audit.prevScore} format={(v) => String(v)} title="vs the previous audit" /> : undefined
          }
        />
        <Headline
          label="AI mention rate"
          value={aiMention === null ? "–" : fmtPct(aiMention)}
          delta={aiMentionDiff !== null && aiEngines.length ? <Delta value={Math.round(aiMentionDiff)} format={(v) => `${v} pts`} title="change over 30 days" /> : undefined}
        />
      </section>

      <Panel
        title="Rankings over time"
        subtitle="SE Ranking's daily rank checks, per search engine"
        actions={<ChartTableToggle view={view} onChange={setView} />}
        footer={
          <>
            <span>
              Domain Trust {fmtInt(s?.domainTrust)} · {fmtInt(s?.indexGoogle)} pages indexed in Google
            </span>
            <span>{snap.engines.map((e) => `${e.name}: ${e.keywordCount} keywords`).join(" · ")}</span>
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
            view={view}
            ariaLabel="Rankings over time"
          />
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No ranking history yet.
          </p>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Position spread" subtitle={`${fmtInt(total)} keyword × engine pairs, latest check`}>
          <BarList rows={BUCKETS.map((b) => ({ key: b.label, label: b.label, value: latestKeywords.filter((k) => b.test(k.current)).length }))} />
        </Panel>
        <Panel title="Biggest gains" subtitle="positions gained in 7 days" actions={<OpenLink onClick={() => onOpen("rankings")} />}>
          <MoverList rows={gains} engines={engineNames} empty="No keyword moved up this week." />
        </Panel>
        <Panel title="Biggest drops" subtitle="positions lost in 7 days" actions={<OpenLink onClick={() => onOpen("rankings")} />}>
          <MoverList rows={drops} engines={engineNames} empty="No keyword dropped this week." />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Site audit" subtitle={snap.audit ? `${snap.audit.title} · ${snap.audit.status}` : "no audit found for this site"} actions={<OpenLink onClick={() => onOpen("audit")} />}>
          {snap.audit ? (
            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                ["Errors", snap.audit.errors],
                ["Warnings", snap.audit.warnings],
                ["Notices", snap.audit.notices],
                ["Pages", snap.audit.pages],
              ].map(([label, value]) => (
                <div key={label as string} className="flex flex-col">
                  <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                    {fmtInt(value as number)}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Run a website audit for this project in SE Ranking and it will appear here after the next sync.
            </p>
          )}
        </Panel>
        <Panel title="AI search presence" subtitle="SE Ranking AI Results Tracker, last 30 days" actions={<OpenLink onClick={() => onOpen("ai")} />}>
          {aiEngines.length ? (
            <BarList
              max={100}
              format={(v) => `${Math.round(v)}%`}
              rows={aiEngines.map((e) => ({ key: String(e.id), label: `${e.label}${e.country ? ` · ${e.country.toUpperCase()}` : ""}`, value: e.mentionPct ?? 0, title: "Share of prompts that mention the brand" }))}
            />
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              This SE Ranking project doesn&apos;t track AI engines yet (AI Results Tracker).
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function OpenLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
      Details
    </button>
  );
}

function MoverList({ rows, engines, empty }: { rows: SeSnapshot["keywords"]; engines: Record<number, string>; empty: string }) {
  if (!rows.length)
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {empty}
      </p>
    );
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((k) => (
        <li key={`${k.engineId}-${k.id}`} className="grid grid-cols-[minmax(0,1fr)_3rem_3.5rem] items-center gap-2 text-xs">
          <span className="truncate" style={{ color: "var(--text-primary)" }} title={k.name}>
            {k.name}
            {engines[k.engineId] ? <span style={{ color: "var(--text-muted)" }}> · {engines[k.engineId]}</span> : null}
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
