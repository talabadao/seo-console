"use client";

import { useMemo, useState } from "react";
import { belongsTo, hostOf, rankDays, rankOf } from "@/lib/seranking/donor/rank";
import type { SeCompetition, SeRival, SeRivalDomain, SeSnapshot } from "@/lib/seranking/donor/types";
import { Favicon } from "../ai-area/tracking/Favicon";
import { TrendChart } from "../ai-area/tracking/TrendChart";
import { ChartTableToggle, Delta, EmptyState, Headline, Panel, Segmented, SelectControl, type ChartView } from "../ai-area/tracking/ui";
import { BubbleChart, type BubblePoint } from "./charts";
import { Move, SectionError, Th, fmtDate, fmtInt } from "./shared";

type Scope = "tracked" | "market";
type TrendMetric = "visibility" | "top10" | "avgPos";
type KeywordFilter = "all" | "lead" | "trail" | "gap";
const KEYWORD_PAGE = 40;
/** Categorical slots after the site's own series-1; series-8 stays reserved. */
const MAX_RIVAL_SERIES = 6;

function DomainCell({ domain, isOwn, tracked }: { domain: string; isOwn: boolean; tracked: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Favicon domain={domain} size={14} />
      <a href={`https://${domain}`} target="_blank" rel="noreferrer" className="truncate hover:underline" style={{ color: "var(--text-primary)", fontWeight: isOwn ? 600 : undefined }} title={domain}>
        {domain}
      </a>
      {isOwn ? (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "color-mix(in srgb, var(--series-1) 14%, transparent)", color: "var(--text-primary)" }}>
          you
        </span>
      ) : tracked ? (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "color-mix(in srgb, var(--series-2) 14%, transparent)", color: "var(--text-primary)" }}>
          tracked
        </span>
      ) : null}
    </span>
  );
}

/** Visibility points gained or lost: arrow + sign, compact for table cells. */
function PointsChange({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: "var(--text-muted)" }}>–</span>;
  if (Math.abs(value) < 0.05) return <span style={{ color: "var(--text-muted)" }}>±0</span>;
  return (
    <span className="whitespace-nowrap font-medium" style={{ color: value > 0 ? "var(--success-text)" : "var(--status-critical)" }}>
      {value > 0 ? "▲ +" : "▼ −"}
      {Math.abs(value).toFixed(1)}
    </span>
  );
}

/** Visibility as a value with a thin bar, so the table reads like SE Ranking's competitor list. */
function VisibilityCell({ value, max, isOwn }: { value: number; max: number; isOwn: boolean }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 rounded sm:block" style={{ background: "var(--page-plane)" }}>
        <span className="block h-1.5 rounded" style={{ width: `${Math.max(value > 0 ? 3 : 0, (value / Math.max(1, max)) * 100)}%`, background: isOwn ? "var(--series-1)" : "var(--text-muted)" }} />
      </span>
      <span className="tabular" style={{ color: "var(--text-primary)" }}>
        {value.toFixed(1)}%
      </span>
    </span>
  );
}

export function CompetitorsSection({ snap }: { snap: SeSnapshot }) {
  const competition = snap.competition;
  const rivals = snap.rivals;
  const [scope, setScope] = useState<Scope>(snap.competitors.length ? "tracked" : "market");
  const [showAll, setShowAll] = useState(false);

  if (!competition && rivals.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SectionError message={snap.errors.competition ?? snap.errors.rivals} />
        <EmptyState
          title="No competitor data yet"
          body="SE Ranking keeps the top-10 results of each check for 14 days. Run a sync after the next ranking check, and add competitors to the SE Ranking project to compare their rankings keyword by keyword."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionError message={snap.errors.competition} />
      <SectionError message={snap.errors.rivals} />
      {competition ? <CompetitionOverview competition={competition} scope={scope} onScope={setScope} showAll={showAll} onShowAll={setShowAll} hasTracked={snap.competitors.length > 0} /> : null}
      <CompetitorTrends snap={snap} scope={scope} />
      <KeywordHeadToHead snap={snap} />
    </div>
  );
}

function CompetitionOverview({
  competition,
  scope,
  onScope,
  showAll,
  onShowAll,
  hasTracked,
}: {
  competition: SeCompetition;
  scope: Scope;
  onScope: (s: Scope) => void;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  hasTracked: boolean;
}) {
  const own = competition.domains.find((d) => d.isOwn) ?? null;
  const ranked = competition.domains.filter((d) => d.visibility > 0 || d.top10 > 0);
  const rank = own ? ranked.findIndex((d) => d.isOwn) + 1 : 0;
  const tracked = competition.domains.filter((d) => d.competitorId !== null);
  const ahead = (scope === "tracked" ? tracked : ranked.filter((d) => !d.isOwn)).filter((d) => own && d.visibility > own.visibility);
  const leader = competition.domains.filter((d) => !d.isOwn).sort((a, b) => b.top10 - a.top10)[0];
  const marketRows = showAll ? competition.domains : competition.domains.slice(0, 15);
  const rows = scope === "tracked" ? competition.domains.filter((d) => d.isOwn || d.competitorId !== null) : own && !marketRows.includes(own) ? [...marketRows, own] : marketRows;
  const maxVisibility = Math.max(1, ...rows.map((d) => d.visibility));
  const bubbles: BubblePoint[] = (scope === "tracked" ? competition.domains.filter((d) => d.isOwn || d.competitorId !== null || competition.domains.indexOf(d) < 5) : competition.domains.slice(0, 20).concat(own && competition.domains.indexOf(own) >= 20 ? [own] : []))
    .filter((d) => d.top10 > 0 && d.avgPos !== null)
    .map((d) => ({ key: d.domain, label: d.domain, kind: d.isOwn ? "own" : d.competitorId !== null ? "tracked" : "other", x: d.top10, y: d.avgPos as number, size: d.visibility, top3: d.top3 }));
  const visDelta = (d: SeRivalDomain) => (d.visibilityPrev === null ? null : Math.round((d.visibility - d.visibilityPrev) * 10) / 10);

  return (
    <>
      <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border p-4 md:grid-cols-4" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }} aria-label="Competition summary">
        <Headline
          label="Your search visibility"
          value={own ? `${own.visibility.toFixed(1)}%` : "–"}
          delta={own && visDelta(own) !== null ? <Delta value={visDelta(own)} format={(v) => `${v.toFixed(1)} pts`} title={`since ${fmtDate(competition.prevDate)}`} /> : undefined}
        />
        <Headline
          label="Visibility rank"
          value={rank > 0 ? `#${rank}` : "–"}
          delta={
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              of {fmtInt(ranked.length)} domains
            </span>
          }
        />
        <Headline
          label="Your keywords in the top 10"
          value={fmtInt(own?.top10 ?? 0)}
          delta={
            leader ? (
              <span className="text-xs" style={{ color: "var(--text-muted)" }} title={`${leader.domain} has the most`}>
                most: {fmtInt(leader.top10)}
              </span>
            ) : undefined
          }
        />
        <Headline
          label={scope === "tracked" ? "Tracked competitors ahead" : "Domains ahead of you"}
          value={fmtInt(ahead.length)}
          delta={
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              by visibility
            </span>
          }
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={scope}
          onChange={onScope}
          ariaLabel="Compare with"
          options={[
            { value: "tracked", label: `Tracked competitors (${tracked.length})` },
            { value: "market", label: `All top-10 domains (${fmtInt(ranked.length)})` },
          ]}
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {competition.engineName} · checked {fmtDate(competition.date)}
          {competition.prevDate ? ` · change since ${fmtDate(competition.prevDate)}` : ""} · top 10 of {fmtInt(competition.keywordCount)} keywords
        </span>
      </div>
      {scope === "tracked" && !hasTracked ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          This SE Ranking project has no competitors yet. Add them in SE Ranking (My Competitors) to track them here - meanwhile, see all top-10 domains.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel title="Search visibility" subtitle="share of possible clicks across your keywords, from SE Ranking">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <Th>Domain</Th>
                  <Th align="right">Visibility</Th>
                  <Th align="right">Change</Th>
                  <Th align="right">Top 10</Th>
                  <Th align="right">Top 3</Th>
                  <Th align="right">Avg. pos.</Th>
                  <Th align="right">Ref. domains</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const delta = visDelta(d);
                  return (
                    <tr key={d.domain} className="border-t" style={{ borderColor: "var(--gridline)", background: d.isOwn ? "color-mix(in srgb, var(--series-1) 6%, transparent)" : undefined }}>
                      <td className="max-w-[14rem] py-1.5 pr-3">
                        <DomainCell domain={d.domain} isOwn={d.isOwn} tracked={d.competitorId !== null} />
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <VisibilityCell value={d.visibility} max={maxVisibility} isOwn={d.isOwn} />
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular">
                        <PointsChange value={delta} />
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-primary)" }}>
                        {fmtInt(d.top10)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {fmtInt(d.top3)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {d.avgPos === null ? "–" : `#${d.avgPos.toFixed(1)}`}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }} title={d.backlinks !== null ? `${fmtInt(d.backlinks)} backlinks` : undefined}>
                        {fmtInt(d.refDomains)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {scope === "market" && competition.domains.length > 15 ? (
            <button type="button" onClick={() => onShowAll(!showAll)} className="self-start rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
              {showAll ? "Show top 15" : `Show all ${competition.domains.length}`}
            </button>
          ) : null}
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Change is in visibility points. Top 10, top 3 and average position count the {fmtInt(competition.keywordCount)} highest-volume keywords at the latest check; average position is over the keywords where the domain is in the top 10.
          </p>
        </Panel>
        <Panel title="Distribution of competitors" subtitle="reach (keywords in the top 10) against how high they rank">
          {bubbles.length ? (
            <BubbleChart points={bubbles} keywordCount={competition.keywordCount} />
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              None of these domains is in the top 10 for the keywords checked.
            </p>
          )}
          {own && own.top10 === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Your site isn&apos;t in the top 10 for any of the keywords checked, so it isn&apos;t on the chart.
            </p>
          ) : null}
        </Panel>
      </div>
    </>
  );
}

interface Entity {
  key: string;
  label: string;
  color: string;
  isOwn: boolean;
  rival: SeRival | null;
}

function CompetitorTrends({ snap, scope }: { snap: SeSnapshot; scope: Scope }) {
  const competition = snap.competition;
  const hasRivals = snap.rivals.length > 0;
  const [metric, setMetric] = useState<TrendMetric>(competition ? "visibility" : "top10");
  const [engineId, setEngineId] = useState(String(snap.engines[0]?.id ?? ""));
  const [view, setView] = useState<ChartView>("chart");
  const ownHost = ownHostOf(snap);

  // Color follows the entity: the site is always series-1 and each tracked competitor keeps its slot (project order)
  // in every view; other leading domains take the slots left over.
  const entities = useMemo<Entity[]>(() => {
    const slots = new Map(snap.rivals.slice(0, MAX_RIVAL_SERIES).map((r, i) => [r.domain, i + 2]));
    const list: Entity[] = [{ key: ownHost, label: `${ownHost} (you)`, color: "var(--series-1)", isOwn: true, rival: null }];
    if (scope === "tracked" || metric !== "visibility") {
      for (const r of snap.rivals.slice(0, MAX_RIVAL_SERIES)) list.push({ key: r.domain, label: r.domain, color: `var(--series-${slots.get(r.domain)})`, isOwn: false, rival: r });
      return list;
    }
    const inTrend = new Set(Object.keys(competition?.visibilityTrend.at(-1)?.values ?? {}));
    const free = Array.from({ length: MAX_RIVAL_SERIES }, (_, i) => i + 2).filter((n) => ![...slots.values()].includes(n));
    for (const d of (competition?.domains ?? []).filter((x) => !x.isOwn && inTrend.has(x.domain))) {
      if (list.length > MAX_RIVAL_SERIES) break;
      const slot = slots.get(d.domain) ?? free.shift();
      if (slot === undefined) continue;
      list.push({ key: d.domain, label: d.domain, color: `var(--series-${slot})`, isOwn: false, rival: snap.rivals.find((r) => r.domain === d.domain) ?? null });
    }
    return list;
  }, [competition, snap.rivals, scope, metric, ownHost]);

  const { dates, series } = useMemo(() => {
    if (metric === "visibility") {
      const trend = competition?.visibilityTrend ?? [];
      return {
        dates: trend.map((t) => t.date),
        series: entities.map((e) => ({ id: e.key, label: e.label, color: e.color, values: trend.map((t) => t.values[e.key] ?? null) })),
      };
    }
    const own = rankDays(snap.keywords.filter((k) => String(k.engineId) === engineId).map((k) => k.positions));
    const byEntity = entities.map((e) => (e.isOwn ? own : (e.rival?.trend[engineId] ?? [])));
    const allDates = [...new Set(byEntity.flatMap((rows) => rows.map((r) => r.date)))].sort();
    return {
      dates: allDates,
      series: entities.map((e, i) => {
        const rows = new Map(byEntity[i].map((r) => [r.date, r]));
        return { id: e.key, label: e.label, color: e.color, values: allDates.map((d) => rows.get(d)?.[metric] ?? null) };
      }),
    };
  }, [metric, entities, competition, snap.keywords, engineId]);

  const metricOptions: Array<{ value: TrendMetric; label: string }> = [
    ...(competition ? [{ value: "visibility" as const, label: "Visibility (14 days)" }] : []),
    ...(hasRivals
      ? [
          { value: "top10" as const, label: "Keywords in top 10 (30 days)" },
          { value: "avgPos" as const, label: "Avg. position (30 days)" },
        ]
      : []),
  ];

  return (
    <Panel
      title="Compared over time"
      subtitle={metric === "visibility" ? `${competition?.engineName ?? ""} · SE Ranking keeps 14 days of competitor visibility` : "from SE Ranking's daily checks of your tracked competitors"}
      actions={<ChartTableToggle view={view} onChange={setView} />}
      footer={
        snap.rivals.length > MAX_RIVAL_SERIES && (scope === "tracked" || metric !== "visibility") ? <span>Showing the first {MAX_RIVAL_SERIES} of {snap.rivals.length} tracked competitors.</span> : undefined
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {metricOptions.length > 1 ? <Segmented value={metric} onChange={setMetric} ariaLabel="Metric" options={metricOptions} /> : <span />}
        {metric !== "visibility" && snap.engines.length > 1 ? (
          <SelectControl ariaLabel="Search engine" value={engineId} onChange={setEngineId} options={snap.engines.map((e) => ({ value: String(e.id), label: e.name }))} />
        ) : null}
      </div>
      {series.length > 1 && dates.length ? (
        <TrendChart
          dates={dates}
          series={series}
          format={metric === "visibility" ? (v) => `${v.toFixed(1)}%` : metric === "avgPos" ? (v) => `#${v.toFixed(1)}` : (v) => fmtInt(v)}
          axisFormat={metric === "visibility" ? (v) => `${v}%` : metric === "avgPos" ? (v) => `#${v}` : (v) => String(v)}
          invert={metric === "avgPos"}
          view={view}
          ariaLabel="Your site against competitors over time"
        />
      ) : (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {hasRivals || competition ? "Not enough history yet." : "Add competitors to the SE Ranking project to compare rankings over time."}
        </p>
      )}
      {metric === "avgPos" ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Average position over all tracked keywords, counting a keyword outside the top 100 as 100 - the way SE Ranking averages positions.
        </p>
      ) : null}
      {!hasRivals && competition ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Add competitors to the SE Ranking project to also compare keywords in the top 10 and average position over 30 days.
        </p>
      ) : null}
    </Panel>
  );
}

function KeywordHeadToHead({ snap }: { snap: SeSnapshot }) {
  const competition = snap.competition;
  const rivals = snap.rivals.slice(0, MAX_RIVAL_SERIES);
  const [engineId, setEngineId] = useState(String(competition?.engineId ?? snap.engines[0]?.id ?? ""));
  const [filter, setFilter] = useState<KeywordFilter>("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(KEYWORD_PAGE);
  const serps = competition && String(competition.engineId) === engineId ? competition.serps : null;
  const ownHost = ownHostOf(snap);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return snap.keywords
      .filter((k) => String(k.engineId) === engineId && (!term || k.name.toLowerCase().includes(term)))
      .map((k) => {
        const theirs = rivals.map((r) => ({ rival: r, pos: rankOf(r.latest[`${k.engineId}:${k.id}`]), prev: rankOf(r.prev7[`${k.engineId}:${k.id}`]) }));
        const top = serps?.[k.id] ?? null;
        const leader = top?.find((r) => !belongsTo(r.domain, ownHost)) ?? null;
        const above = top && k.current ? top.filter((r) => r.pos < (k.current as number) && !belongsTo(r.domain, ownHost)).length : null;
        // Compare with the tracked competitors, or with the top 10 when none are tracked.
        const best = rivals.length ? Math.min(...theirs.map((t) => t.pos ?? 1000)) : (leader?.pos ?? 1000);
        const mine = k.current ?? 1000;
        const status: KeywordFilter = mine < best ? "lead" : mine === 1000 && best < 1000 ? "gap" : mine > best ? "trail" : "all";
        return { k, theirs, leader, above, best, status };
      })
      .filter((r) => filter === "all" || r.status === filter || (filter === "trail" && r.status === "gap"))
      .sort((a, b) => (b.k.volume ?? 0) - (a.k.volume ?? 0) || a.k.name.localeCompare(b.k.name));
  }, [snap, engineId, rivals, serps, filter, search, ownHost]);

  const counts = useMemo(() => {
    const all = snap.keywords.filter((k) => String(k.engineId) === engineId);
    let lead = 0;
    let trail = 0;
    let gap = 0;
    for (const k of all) {
      const best = rivals.length
        ? Math.min(...rivals.map((r) => rankOf(r.latest[`${k.engineId}:${k.id}`]) ?? 1000))
        : (serps?.[k.id]?.find((r) => !belongsTo(r.domain, ownHost))?.pos ?? 1000);
      const mine = k.current ?? 1000;
      if (mine < best) lead++;
      else if (mine === 1000 && best < 1000) gap++;
      else if (mine > best) trail++;
    }
    return { lead, trail, gap, total: all.length };
  }, [snap, engineId, rivals, serps, ownHost]);

  if (!rivals.length && !competition) return null;
  const versus = rivals.length ? "your tracked competitors" : "the top result";

  return (
    <Panel
      title="Keyword head-to-head"
      subtitle={`your position against ${versus}, latest check`}
      actions={
        snap.engines.length > 1 && rivals.length ? (
          <SelectControl
            ariaLabel="Search engine"
            value={engineId}
            onChange={(v) => {
              setEngineId(v);
              setShown(KEYWORD_PAGE);
            }}
            options={snap.engines.map((e) => ({ value: String(e.id), label: e.name }))}
          />
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShown(KEYWORD_PAGE);
          }}
          placeholder="Search keyword"
          className="w-48 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
          style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" }}
        />
        <Segmented
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setShown(KEYWORD_PAGE);
          }}
          ariaLabel="Filter keywords"
          options={[
            { value: "all", label: `All (${counts.total})` },
            { value: "lead", label: `You lead (${counts.lead})` },
            { value: "trail", label: `You trail (${counts.trail + counts.gap})` },
            { value: "gap", label: `Not ranking (${counts.gap})`, title: "A competitor ranks and you're not in the top 100" },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 420 + rivals.length * 96 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <Th>Keyword</Th>
              <Th align="right">Volume</Th>
              <Th align="right">You</Th>
              {rivals.length ? (
                rivals.map((r) => (
                  <th key={r.id} className="max-w-[7rem] py-1.5 pr-3 text-right font-medium" title={r.domain}>
                    <span className="inline-flex max-w-[7rem] items-center justify-end gap-1">
                      <Favicon domain={r.domain} size={12} />
                      <span className="truncate">{r.domain.replace(/\.[a-z.]+$/, "")}</span>
                    </span>
                  </th>
                ))
              ) : (
                <>
                  <Th>Top result</Th>
                  <Th align="right">Sites above you</Th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map(({ k, theirs, leader, above, best }) => {
              const mine = k.current ?? 1000;
              return (
                <tr key={`${k.engineId}-${k.id}`} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                  <td className="max-w-[16rem] truncate py-1.5 pr-3 font-medium" style={{ color: "var(--text-primary)" }} title={k.name}>
                    {k.name}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                    {fmtInt(k.volume)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular" style={{ background: "color-mix(in srgb, var(--series-1) 6%, transparent)" }}>
                    <span className="inline-flex items-center gap-1.5">
                      <span style={{ color: k.current ? "var(--text-primary)" : "var(--text-muted)", fontWeight: k.current && mine <= best ? 700 : 500 }}>{k.current ? `#${k.current}` : "–"}</span>
                      {k.current && k.change7 ? (
                        <span className="text-[10px]" title="positions moved in 7 days">
                          <Move value={k.change7} />
                        </span>
                      ) : null}
                    </span>
                  </td>
                  {rivals.length ? (
                    theirs.map((t) => (
                      <td
                        key={t.rival.id}
                        className="py-1.5 pr-3 text-right tabular"
                        title={t.prev !== null || t.pos !== null ? `7 days ago: ${t.prev ? `#${t.prev}` : "not in the top 100"}` : undefined}
                        style={{ color: t.pos ? "var(--text-primary)" : "var(--text-muted)", fontWeight: t.pos !== null && t.pos === best && best < mine ? 700 : 400 }}
                      >
                        {t.pos ? `#${t.pos}` : "–"}
                      </td>
                    ))
                  ) : (
                    <>
                      <td className="max-w-[14rem] py-1.5 pr-3">
                        {leader ? (
                          <a href={leader.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 hover:underline" style={{ color: "var(--text-secondary)" }} title={leader.url}>
                            <span className="tabular" style={{ color: "var(--text-muted)" }}>
                              #{leader.pos}
                            </span>
                            <Favicon domain={leader.domain} size={12} />
                            <span className="truncate">{leader.domain}</span>
                          </a>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>–</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {above === null ? (k.current ? "–" : "all 10") : fmtInt(above)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No keywords match.
        </p>
      ) : null}
      {shown < rows.length ? (
        <button type="button" onClick={() => setShown((n) => n + KEYWORD_PAGE * 2)} className="self-center rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
          Show more ({rows.length - shown} left)
        </button>
      ) : null}
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Bold marks the best position on each keyword. – means not in the top 100{rivals.length ? "; hover a competitor's position to see where it was 7 days earlier" : ""}.
        {snap.rivals.length > MAX_RIVAL_SERIES ? ` Showing ${MAX_RIVAL_SERIES} of ${snap.rivals.length} tracked competitors.` : ""}
      </p>
    </Panel>
  );
}

function ownHostOf(snap: SeSnapshot): string {
  return hostOf(snap.siteUrl);
}
