"use client";

import { useMemo, useState } from "react";
import {
  computeRankGrid,
  computeRankOverview,
  googleVia,
  subjectsInResult,
  type HitLookup,
  type RankCell,
  type Subject,
} from "@/lib/ai-area/tracking/analytics";
import { formatShortDate, formatWeekday, urlPath } from "@/lib/ai-area/tracking/format";
import type { KeywordHistory } from "@/lib/ai-area/tracking/types";
import { AiAnswerBlock, highlightSubjects } from "./AiAnswer";
import { Favicon } from "./Favicon";
import { RankOverviewCard } from "./RankOverviewCard";
import { EmptyState, IconHash, ModeMark, Panel, Segmented, SelectControl, SparkleMark, TrackButton, GoogleViaBadge } from "./ui";

interface RankTrackerViewProps {
  histories: KeywordHistory[];
  subjects: Subject[];
  hits: HitLookup;
  localeLabel: string;
  onTrack: (domain: string) => void;
}

type SerpTab = "serp" | "aiOverview" | "aiMode";

function ChangeBadge({ cell }: { cell: RankCell }) {
  if (cell.enteredTop) {
    return (
      <span className="text-[10px] font-semibold" style={{ color: "var(--success-text)" }} title="Entered the tracked results">
        new
      </span>
    );
  }
  if (cell.delta == null || cell.delta === 0) return null;
  const up = cell.delta > 0;
  return (
    <span
      className="text-[10px] font-semibold tabular"
      style={{ color: up ? "var(--success-text)" : "var(--status-critical)" }}
      title={up ? `Up ${cell.delta}` : `Down ${Math.abs(cell.delta)}`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(cell.delta)}
    </span>
  );
}

function AiMarks({ cell }: { cell: RankCell }) {
  if (!cell.aiOverviewShown && !cell.aiModeShown) return null;
  return (
    <span className="flex items-center gap-1">
      {cell.aiOverviewShown ? (
        <SparkleMark
          filled={cell.aiOverviewMatched}
          title={cell.aiOverviewMatched ? "In the AI Overview" : "AI Overview shown, brand not in it"}
        />
      ) : null}
      {cell.aiModeShown ? (
        <ModeMark filled={cell.aiModeMatched} title={cell.aiModeMatched ? "In the AI Mode answer" : "AI Mode answered, brand not in it"} />
      ) : null}
    </span>
  );
}

function PositionValue({ cell }: { cell: RankCell }) {
  if (cell.position == null) {
    const depth = cell.depth > 0 ? `top ${cell.depth}` : "the tracked results";
    return (
      <span style={{ color: "var(--text-muted)" }} title={cell.droppedOut ? `Dropped out of the ${depth}` : `Not in the ${depth}`}>
        {cell.depth >= 20 ? `${cell.depth}+` : "–"}
      </span>
    );
  }
  return <span className="font-semibold tabular">{cell.position}</span>;
}

function SuspectMark({ cell }: { cell: RankCell }) {
  if (!cell.lowRelevance && !cell.showingResultsFor) return null;
  const why = cell.lowRelevance
    ? "Google returned results that barely match this keyword (even on a fresh retry) - treat this day's position with caution"
    : `Google showed results for "${cell.showingResultsFor}" instead`;
  return (
    <span aria-label={why} title={why} className="text-[11px] font-bold" style={{ color: "var(--status-serious)" }}>
      ⚠
    </span>
  );
}

export function RankTrackerView({ histories, subjects, hits, localeLabel, onTrack }: RankTrackerViewProps) {
  const [subjectId, setSubjectId] = useState("you");
  const [selection, setSelection] = useState<{ keywordId: string; date: string } | null>(null);
  const [tab, setTab] = useState<SerpTab>("serp");

  const subjectIndex = Math.max(0, subjects.findIndex((s) => s.id === subjectId));
  const subject = subjects[subjectIndex];
  const grid = useMemo(() => computeRankGrid(histories, subjectIndex, hits), [histories, subjectIndex, hits]);
  const overview = useMemo(() => computeRankOverview(grid), [grid]);

  const selectionValid = !!selection && grid.rows.some((r) => r.keywordId === selection.keywordId && r.cells[selection.date]);
  const firstRow = grid.rows.find((r) => Object.keys(r.cells).length > 0);
  const firstDate = firstRow ? grid.dates.find((d) => firstRow.cells[d]) : undefined;
  const active = selectionValid ? selection : firstRow && firstDate ? { keywordId: firstRow.keywordId, date: firstDate } : null;

  const activeHistory = active ? histories.find((h) => h.keywordId === active.keywordId) ?? null : null;
  const activeDay = activeHistory?.days.find((d) => d.date === active?.date) ?? null;

  if (grid.rows.length === 0 || grid.dates.length === 0) {
    return <EmptyState title="No rankings yet" body="Add keywords in Settings and run tracking - positions appear here once a run completes." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <RankOverviewCard subject={subject} overview={overview} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Panel
        icon={<IconHash />}
        title="Rank tracker"
        subtitle={`Where ${subject.website || subject.name} ranks per keyword per day · ${localeLabel}`}
        actions={
          <SelectControl
            ariaLabel="Brand to track"
            value={subject.id}
            onChange={setSubjectId}
            icon={<Favicon domain={subject.website} label={subject.name} size={14} />}
            options={subjects.map((s) => ({ value: s.id, label: s.isYourBrand ? `${s.name} (you)` : s.name }))}
          />
        }
        bodyClassName="overflow-x-auto"
        footer={
          <>
            <span className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1">
                <SparkleMark filled title="" /> in AI Overview
              </span>
              <span className="flex items-center gap-1">
                <SparkleMark filled={false} title="" /> AI Overview without {subject.name}
              </span>
              <span className="flex items-center gap-1">
                <ModeMark filled title="" /> in AI Mode
              </span>
              <span>20+ = not in the tracked results</span>
              <span className="flex items-center gap-1">
                <span style={{ color: "var(--status-serious)" }}>⚠</span> suspicious SERP
              </span>
            </span>
            <span>Click a cell to inspect that day&apos;s SERP</span>
          </>
        }
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-xs" style={{ color: "var(--text-secondary)" }}>
              <th
                className="sticky left-0 z-10 min-w-56 border-b px-3 py-2 text-left font-medium"
                style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
              >
                Keyword
              </th>
              {grid.dates.map((d) => (
                <th key={d} className="min-w-20 border-b border-l px-2 py-2 text-center font-medium" style={{ borderColor: "var(--gridline)" }}>
                  <div style={{ color: "var(--text-primary)" }}>{formatShortDate(d)}</div>
                  <div className="text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
                    {formatWeekday(d)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => {
              const rowActive = active?.keywordId === row.keywordId;
              return (
                <tr key={row.keywordId}>
                  <td
                    className="sticky left-0 z-10 border-b px-3 py-2 align-top"
                    style={{
                      borderColor: "var(--gridline)",
                      background: rowActive ? "color-mix(in srgb, var(--series-1) 6%, var(--surface-1))" : "var(--surface-1)",
                    }}
                  >
                    <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                      {row.keyword}
                    </div>
                    <div className="max-w-56 truncate text-xs" style={{ color: "var(--text-muted)" }} title={row.landingUrl ?? undefined}>
                      {row.landingUrl ? urlPath(row.landingUrl) : `${subject.name} not in results`}
                    </div>
                  </td>
                  {grid.dates.map((d) => {
                    const cell = row.cells[d];
                    const selected = active?.keywordId === row.keywordId && active.date === d;
                    return (
                      <td key={d} className="border-b border-l p-0 align-top" style={{ borderColor: "var(--gridline)" }}>
                        {cell ? (
                          <button
                            type="button"
                            onClick={() => setSelection({ keywordId: row.keywordId, date: d })}
                            aria-pressed={selected}
                            aria-label={`${row.keyword}, ${formatShortDate(d)}: ${cell.position != null ? `position ${cell.position}` : "not ranking"}`}
                            className="flex h-full min-h-14 w-full flex-col items-center gap-1 px-2 py-2"
                            style={{
                              color: "var(--text-primary)",
                              background: selected ? "color-mix(in srgb, var(--series-1) 16%, transparent)" : undefined,
                              boxShadow: selected ? "inset 0 0 0 1.5px var(--series-1)" : undefined,
                            }}
                          >
                            <span className="flex items-baseline gap-1">
                              <PositionValue cell={cell} />
                              <ChangeBadge cell={cell} />
                              <SuspectMark cell={cell} />
                            </span>
                            <AiMarks cell={cell} />
                          </button>
                        ) : (
                          <div className="flex min-h-14 items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
                            ·
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {activeHistory && activeDay && active ? (
        <Panel
          icon={<Favicon domain="google.com" size={14} />}
          title={activeHistory.keyword}
          subtitle={formatShortDate(active.date)}
          className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]"
          bodyClassName="flex min-h-0 flex-col gap-4 overflow-y-auto p-4"
        >
          <Segmented
            ariaLabel="Result type"
            value={tab}
            onChange={setTab}
            options={[
              { value: "serp", label: "SERP" },
              { value: "aiOverview", label: `AI Overview${activeDay.aiOverview.present ? "" : " (none)"}` },
              { value: "aiMode", label: "AI Mode" },
            ]}
          />

          {tab === "serp" && (activeDay.showingResultsFor || activeDay.lowRelevance) ? (
            <p
              className="rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: "var(--status-serious)", color: "var(--text-primary)", background: "color-mix(in srgb, var(--status-serious) 8%, transparent)" }}
            >
              <span style={{ color: "var(--status-serious)" }}>⚠ </span>
              {activeDay.showingResultsFor
                ? `Google showed results for "${activeDay.showingResultsFor}" instead of the keyword.`
                : "These results barely match the keyword even after a fresh retry - Google may have served the wrong page, so treat this day's positions with caution."}
            </p>
          ) : null}

          {tab === "serp" ? (
            activeDay.organicResults.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No organic results captured.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Top {activeDay.organicResults.length} organic results
                  {activeDay.pagesFetched ? ` · ${activeDay.pagesFetched} page${activeDay.pagesFetched === 1 ? "" : "s"} fetched` : ""}
                </p>
                <ol className="flex flex-col gap-3">
                {activeDay.organicResults.map((r) => {
                  const tags = subjectsInResult(r, subjects);
                  const isTracked = tags.some((t) => t.owns && t.subject.id === subject.id);
                  const via = googleVia(r.link);
                  return (
                    <li
                      key={`${r.position}-${r.link}`}
                      className="flex gap-3 rounded-lg p-2"
                      style={{ background: isTracked ? "color-mix(in srgb, var(--series-1) 8%, transparent)" : undefined }}
                    >
                      <span className="w-7 shrink-0 pt-0.5 text-right text-sm tabular" style={{ color: "var(--text-muted)" }}>
                        {r.position}.
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                          <Favicon domain={r.domain} size={14} />
                          <span className="max-w-full truncate">{r.source && !/\.[a-z]{2,}$/i.test(r.source) ? `${r.source} · ${r.domain}` : r.domain}</span>
                          {via ? <GoogleViaBadge via={via} /> : null}
                          {tags.map(({ subject: o, owns }) => (
                            <span
                              key={o.id}
                              className="shrink-0 rounded border px-1 py-0.5 text-[10px] font-semibold"
                              style={
                                owns
                                  ? { background: "var(--gridline)", color: "var(--text-primary)", borderColor: "transparent" }
                                  : { background: "transparent", color: "var(--text-muted)", borderColor: "var(--border-hairline)" }
                              }
                              title={owns ? `${o.name}'s own site` : `Mentions ${o.name}`}
                            >
                              {owns ? (o.isYourBrand ? "your site" : o.name) : `mentions ${o.isYourBrand ? "you" : o.name}`}
                            </span>
                          ))}
                          {tags.some((t) => t.owns) ? null : (
                            <span className="ml-auto">
                              <TrackButton onClick={() => onTrack(r.domain)} />
                            </span>
                          )}
                        </span>
                        <a
                          href={r.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium hover:underline"
                          style={{ color: "var(--series-1)" }}
                        >
                          {r.title}
                        </a>
                        <span className="truncate text-[11px]" style={{ color: "var(--success-text)" }}>
                          {r.link}
                        </span>
                        {r.snippet ? (
                          <p className="line-clamp-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                            {highlightSubjects(r.snippet, subjects)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                </ol>
              </div>
            )
          ) : (
            <AiAnswerBlock
              answer={activeDay[tab]}
              subjects={subjects}
              emptyLabel={tab === "aiOverview" ? "Google showed no AI Overview for this search." : "No AI Mode answer was captured."}
              onTrack={onTrack}
            />
          )}
        </Panel>
      ) : null}
      </div>
    </div>
  );
}
