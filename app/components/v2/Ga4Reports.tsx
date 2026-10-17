"use client";

// Analytics (GA4) → GA4 reports: five built-in templates and saved custom reports (Ga4ReportBuilder). Every
// number comes from the project's GA4 property through the shared cache; totals are GA4's own (users are never
// added up across rows), and each view states its period, comparison, source and freshness.

import { useState, type ReactNode } from "react";
import type { TemplateResult } from "@/lib/v2/ga4reports/templates";
import { TEMPLATES, type TemplateId } from "@/lib/v2/ga4reports/templateDefs";
import { usePeriodChoice } from "./summaryClient";
import { Delta, PeriodPicker, Stat, fmtInt } from "./summaryUi";
import { Card, DataTable, EmptyState, ErrorState, LoadingState, buttonClass, type Column } from "./ui";
import { Ga4ReportBuilder } from "./Ga4ReportBuilder";
import { ReportFooter, TrendChart, fmtMetric, useGaJson, type CacheMeta } from "./ga4Shared";

const TABS: { id: TemplateId | "custom"; label: string }[] = [
  { id: "leads", label: "Generate leads" },
  { id: "events", label: "Events" },
  { id: "landing-pages", label: "Landing pages" },
  { id: "traffic-acquisition", label: "Traffic acquisition" },
  { id: "user-acquisition", label: "User acquisition" },
  { id: "custom", label: "Custom reports" },
];

export const GA4_REPORT_SUBS = TABS.map((t) => t.id);

export function Ga4Reports({ projectId, sub, onSub, onOpenLeadSettings }: { projectId: number; sub: string; onSub: (s: string) => void; onOpenLeadSettings: () => void }) {
  const tab = TABS.find((t) => t.id === sub)?.id ?? "leads";
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="GA4 reports" className="flex flex-wrap items-center gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            onClick={() => onSub(t.id === "leads" ? "" : t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "custom" ? <Ga4ReportBuilder projectId={projectId} /> : <TemplateReport key={tab} projectId={projectId} template={tab} onOpenLeadSettings={onOpenLeadSettings} />}
    </div>
  );
}

type TemplateResponse =
  | { state: "live"; result: TemplateResult; cache: CacheMeta }
  | { state: "demo" | "not-connected" | "unavailable" | "error" | "pending"; message?: string };

type Row = TemplateResult["table"]["rows"][number];

function TemplateReport({ projectId, template, onOpenLeadSettings }: { projectId: number; template: TemplateId; onOpenLeadSettings: () => void }) {
  const def = TEMPLATES[template];
  const [period, setPeriod] = usePeriodChoice();
  const [view, setView] = useState(def.views[0].id);
  const [focus, setFocus] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const q = new URLSearchParams({ template, view, preset: period.preset, compare: period.compare, focus: focus.join(",") });
  const { data, error, loading } = useGaJson<TemplateResponse>(`/api/v2/ga4/${projectId}/template?${q}`, null, refresh);

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodPicker value={period} onChange={setPeriod} />
      {def.views.length > 1 && (
        <select aria-label="Breakdown" className="rounded-md border bg-background px-2 py-1.5 text-sm" value={view} onChange={(e) => setView(e.target.value)}>
          {def.views.map((v) => (
            <option key={v.id} value={v.id}>
              By {v.label.toLowerCase()}
            </option>
          ))}
        </select>
      )}
      <button className={buttonClass} onClick={() => setRefresh((n) => n + 1)} disabled={loading}>
        Refresh
      </button>
    </div>
  );

  let body: ReactNode;
  if (loading) body = <LoadingState label="Loading from GA4…" />;
  else if (error) body = <ErrorState title="Couldn't load this report." body={error} />;
  else if (!data) body = null;
  else if (data.state !== "live") {
    body =
      data.state === "error" ? (
        <ErrorState title="GA4 returned an error." body={data.message} />
      ) : (
        <EmptyState title={data.state === "demo" ? "Demo project" : data.state === "pending" ? "Still loading" : "Not available"} body={data.message} />
      );
  } else body = <TemplateBody r={data.result} cache={data.cache} focus={focus} setFocus={setFocus} onOpenLeadSettings={onOpenLeadSettings} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-lg font-semibold">{def.title}</h2>
          <p className="text-sm text-muted">{def.description}</p>
        </div>
        {controls}
      </div>
      {body}
    </div>
  );
}

function TemplateBody({
  r,
  cache,
  focus,
  setFocus,
  onOpenLeadSettings,
}: {
  r: TemplateResult;
  cache: CacheMeta;
  focus: string[];
  setFocus: (f: string[]) => void;
  onOpenLeadSettings: () => void;
}) {
  const hasPrev = r.period.previous != null;
  const leadsMissing = r.template === "leads" && r.leads && r.leads.events.length === 0;
  const columns: Column<Row>[] = [
    {
      key: "key",
      label: r.table.dimensionLabel,
      value: (row) => row.key,
      render: (row) => (
        <span className="break-all">
          {row.key || "(not set)"}
          {row.keyEvent && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium">Key event</span>}
        </span>
      ),
    },
    ...r.table.columns.map(
      (c, i): Column<Row> => ({
        key: c.metric,
        label: c.label,
        numeric: true,
        value: (row) => row.cur[i],
        render: (row) => (
          <span className="inline-flex flex-col items-end">
            <span>{fmtMetric(c.metric, row.cur[i], undefined, r.currency)}</span>
            {hasPrev && <Delta pair={{ current: row.cur[i], previous: row.prev?.[i] ?? null }} absolute={/Rate$/.test(c.metric)} />}
          </span>
        ),
      }),
    ),
  ];
  const isFocusable = r.template === "events" || r.template === "landing-pages";
  if (isFocusable) {
    columns.push({
      key: "focus",
      label: "Trend",
      render: (row) => {
        const on = focus.includes(row.key) || (r.template === "events" && !focus.length && r.trend.focus.includes(row.key));
        return (
          <button
            className="text-xs text-accent hover:underline"
            onClick={() => {
              const current = focus.length ? focus : r.trend.focus;
              if (r.template === "landing-pages") setFocus(on ? [] : [row.key]);
              else setFocus(on ? current.filter((k) => k !== row.key) : [...current, row.key].slice(-5));
            }}
          >
            {on ? "Hide" : "Show"}
          </button>
        );
      },
    });
  }

  return (
    <div className="space-y-4">
      {r.template === "leads" && r.leads && (
        <Card title="Lead events setup">
          {leadsMissing ? (
            <div className="space-y-2 text-sm">
              <p>No lead events are chosen for this project, so lead counts can&apos;t be shown. Key events (all) below still come from GA4.</p>
              <button className={buttonClass} onClick={onOpenLeadSettings}>
                Choose lead events
              </button>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-muted">
                {r.leads.source === "weekly-report" ? "Taken from the Weekly Report's saved selection (no project-level list saved yet). " : ""}
                Counted as events, separately from GA4 key events.{" "}
                <button className="text-accent hover:underline" onClick={onOpenLeadSettings}>
                  Change
                </button>
              </p>
              <ul className="divide-y rounded-md border">
                {r.leads.events.map((e) => {
                  const seen = r.leads!.seen.find((s) => s.event === e);
                  return (
                    <li key={e} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="font-mono text-xs">{e}</span>
                      <span className="flex items-center gap-3 text-xs">
                        {seen ? (
                          <>
                            <span className="tabular-nums">{fmtInt(seen.count)} events</span>
                            {hasPrev && <Delta pair={{ current: seen.count, previous: seen.prevCount }} />}
                            <span className={seen.keyEvent ? "" : "text-muted"}>{seen.keyEvent ? "Also a GA4 key event" : "Not a GA4 key event"}</span>
                          </>
                        ) : (
                          <span style={{ color: "var(--bad)" }}>Not recorded in this period: check the event name in GA4.</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {r.scorecards.map((s) => (
            <Stat
              key={s.metric}
              label={s.label}
              value={fmtMetric(s.metric, s.cur, undefined, r.currency)}
              pair={hasPrev ? { current: s.cur, previous: s.prev } : undefined}
              absolute={/Rate$/.test(s.metric)}
            />
          ))}
        </div>
      </Card>

      <Card title={`${r.trend.label} by day${r.template === "landing-pages" ? (r.trend.focus[0] ? `: ${r.trend.focus[0]}` : ": all landing pages") : ""}`}>
        {r.template === "leads" && leadsMissing ? (
          <p className="py-6 text-center text-sm text-muted">Choose lead events to see their trend.</p>
        ) : (
          <TrendChart cur={r.trend.cur} prev={r.template === "events" ? null : r.trend.prev} label={r.trend.label} split={r.template === "events"} />
        )}
        {r.template === "events" && <p className="mt-1 text-xs text-muted">Current period only, one line per event. Choose events with Show/Hide in the table (up to 5).</p>}
        {r.template !== "events" && hasPrev && <p className="mt-1 text-xs text-muted">The dashed line is the comparison period, aligned day by day.</p>}
      </Card>

      <Card title={`By ${r.table.dimensionLabel.toLowerCase()}`}>
        <DataTable
          columns={columns}
          rows={r.table.rows}
          rowKey={(row) => row.key}
          exportName={`ga4-${r.template}`}
          note={
            r.table.rowCount > r.table.rows.length
              ? `Top ${r.table.rows.length} of ${fmtInt(r.table.rowCount)} rows by ${r.table.columns[0].label.toLowerCase()}.`
              : undefined
          }
        />
      </Card>

      <ReportFooter period={r.period} propertyId={r.propertyId} timeZone={r.timeZone} currency={r.currency} fetchedAt={r.fetchedAt} cache={cache} notes={r.notes} />
    </div>
  );
}
