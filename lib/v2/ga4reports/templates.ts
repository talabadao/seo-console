// Built-in GA4 report templates (Analytics (GA4) → GA4 reports). Server only; definitions shared with the UI
// through TEMPLATES (labels and wording). Same number rules as run.ts: totals from their own query, users
// never added up, rates never averaged, comparisons queried separately.
//
// Lead events are the project's own list (Project settings → Analytics / Key events). They are counted with
// `eventCount` filtered to those event names, and always shown apart from GA4 `keyEvents`, which counts every
// event the property marks as a key event.

import { runReport, Semaphore, inFilter, eqFilter } from "@/lib/ga4";
import type { PeriodInfo } from "@/lib/v2/summary/types";
import { gaDate, rangeOf, totalsFor, type ReportNotes } from "./run";
import { METRIC_LABELS, TEMPLATES, type TemplateId, type TemplateView } from "./templateDefs";

export * from "./templateDefs";

export interface TemplateQuery {
  template: TemplateId;
  view: string;
  /** Events template: the events in the trend (empty: the top 3). Landing pages: the page in the trend (or ""). */
  focus: string[];
}

export interface TemplateRow {
  key: string;
  cur: (number | null)[];
  prev: (number | null)[] | null;
  /** Events template: the event is marked as a key event in the property. */
  keyEvent?: boolean;
}

export interface LeadSetup {
  /** The project's lead events (empty: none chosen). */
  events: string[];
  source: "project" | "weekly-report" | "none";
  /** Lead events recorded in the period, with whether GA4 marks each as a key event. */
  seen: { event: string; count: number; prevCount: number | null; keyEvent: boolean }[];
}

export interface TemplateResult {
  template: TemplateId;
  view: TemplateView;
  scorecards: { metric: string; label: string; cur: number | null; prev: number | null }[];
  trend: { label: string; focus: string[]; cur: { date: string; key: string; value: number }[]; prev: { date: string; key: string; value: number }[] | null };
  table: { dimensionLabel: string; columns: { metric: string; label: string }[]; rows: TemplateRow[]; rowCount: number };
  leads: LeadSetup | null;
  notes: ReportNotes;
  currency: string | null;
  timeZone: string | null;
  period: PeriodInfo;
  propertyId: string;
  fetchedAt: number;
}

const TABLE_ROWS = 250;

export async function runTemplate(opts: {
  token: string;
  propertyId: string;
  period: PeriodInfo;
  query: TemplateQuery;
  leadEvents: { events: string[]; source: LeadSetup["source"] };
}): Promise<TemplateResult> {
  const { token, propertyId, period, query } = opts;
  const def = TEMPLATES[query.template];
  const view = def.views.find((v) => v.id === query.view) ?? def.views[0];
  const leadEvents = opts.leadEvents.events.slice(0, 50);
  const withLeads = def.leadColumn && leadEvents.length > 0;
  const leadFilter = withLeads ? inFilter("eventName", leadEvents) : undefined;
  const sem = new Semaphore(3);
  const notes: ReportNotes = { thresholded: false, sampled: false, otherRow: false, truncated: false };
  const note = <R extends { flags: { thresholded: boolean; otherRow: boolean }; sampled: boolean }>(r: R): R => {
    notes.thresholded ||= r.flags.thresholded;
    notes.otherRow ||= r.flags.otherRow;
    notes.sampled ||= r.sampled;
    return r;
  };
  const report = (o: Parameters<typeof runReport>[2]) => sem.run(() => runReport(token, propertyId, o)).then(note);
  const ranges = [period.current, ...(period.previous ? [period.previous] : [])];

  // Table: current period (top rows by the first metric), and the comparison period separately.
  const tableQuery = (range: { start: string; end: string }, limit: number) =>
    report({ dimensions: [view.dimension], metrics: def.metrics, dateRanges: [rangeOf(range)], orderBys: [{ metric: { metricName: def.metrics[0] }, desc: true }], limit });
  const leadsBy = (dimension: string | null) =>
    withLeads
      ? report({ dimensions: dimension ? [dimension] : [], metrics: ["eventCount"], dateRanges: ranges.map(rangeOf), dimensionFilter: leadFilter, limit: 10000 })
      : Promise.resolve(null);

  // Trend focus: events (Events template), a landing page (Landing pages), else the whole property.
  let focus = query.focus.filter(Boolean).slice(0, 5);
  const [totals, cur, prev, leadRows, leadTotals, keyFlags, leadSeen] = await Promise.all([
    sem.run(() => totalsFor(token, propertyId, def.metrics, period)).then((t) => {
      notes.thresholded ||= t.flags.thresholded;
      notes.sampled ||= t.sampled;
      return t;
    }),
    tableQuery(period.current, TABLE_ROWS),
    period.previous ? tableQuery(period.previous, 10000) : Promise.resolve(null),
    leadsBy(view.dimension),
    leadsBy(null),
    query.template === "events"
      ? report({ dimensions: ["eventName", "isKeyEvent"], metrics: ["eventCount"], dateRanges: [rangeOf(period.current)], limit: 10000 })
      : Promise.resolve(null),
    query.template === "leads" && leadEvents.length
      ? report({ dimensions: ["eventName", "isKeyEvent"], metrics: ["eventCount"], dateRanges: ranges.map(rangeOf), dimensionFilter: leadFilter, limit: 1000 })
      : Promise.resolve(null),
  ]);

  if (query.template === "events" && !focus.length) focus = cur.rows.slice(0, 3).map((r) => r.dims[0]);
  const trendMetric = def.trend === "leads" ? "eventCount" : def.trend;
  const trendFilter =
    def.trend === "leads"
      ? leadFilter
      : query.template === "events" && focus.length
        ? inFilter("eventName", focus)
        : query.template === "landing-pages" && focus.length
          ? eqFilter("landingPage", focus[0])
          : undefined;
  const trendDims = query.template === "events" ? ["date", "eventName"] : ["date"];
  const trendQuery = (range: { start: string; end: string }) =>
    def.trend === "leads" && !withLeads
      ? Promise.resolve(null)
      : report({ dimensions: trendDims, metrics: [trendMetric], dateRanges: [rangeOf(range)], dimensionFilter: trendFilter, orderBys: [{ dimension: { dimensionName: "date" } }], limit: 10000 });
  const [trendCur, trendPrev] = await Promise.all([trendQuery(period.current), period.previous ? trendQuery(period.previous) : Promise.resolve(null)]);
  const points = (r: Awaited<ReturnType<typeof trendQuery>>) => (r?.rows ?? []).map((x) => ({ date: gaDate(x.dims[0]), key: x.dims[1] ?? "", value: x.metrics[0] }));

  // Lead-event column by row (both periods in one query: the counts are additive event counts).
  const leadCur = new Map<string, number>();
  const leadPrev = new Map<string, number>();
  for (const r of leadRows?.rows ?? []) (r.range === 0 ? leadCur : leadPrev).set(r.dims[0], r.metrics[0]);
  const leadTotal = (range: number) => (withLeads ? (leadTotals?.rows.find((r) => r.range === range)?.metrics[0] ?? 0) : null);

  const keyEvent = new Set((keyFlags?.rows ?? []).filter((r) => r.dims[1] === "true").map((r) => r.dims[0]));
  const prevBy = new Map((prev?.rows ?? []).map((r) => [r.dims[0], r.metrics]));
  const rows: TemplateRow[] = cur.rows.map((r) => {
    const key = r.dims[0];
    const p = period.previous ? (prevBy.get(key) ?? def.metrics.map(() => null)) : null;
    return {
      key,
      cur: withLeads ? [...r.metrics, leadCur.get(key) ?? 0] : r.metrics,
      prev: p == null ? null : withLeads ? [...p, prevBy.has(key) || leadPrev.has(key) ? (leadPrev.get(key) ?? 0) : null] : p,
      ...(query.template === "events" ? { keyEvent: keyEvent.has(key) } : {}),
    };
  });
  if (cur.rowCount > cur.rows.length) notes.truncated = true;

  const totalOf = (m: string, range: 0 | 1) => {
    if (m === "leads") return leadTotal(range);
    const i = def.metrics.indexOf(m);
    const src = range === 0 ? totals.cur : totals.prev;
    return src && i >= 0 ? src[i] : null;
  };

  let leads: LeadSetup | null = null;
  if (query.template === "leads") {
    const seen = new Map<string, LeadSetup["seen"][number]>();
    for (const r of leadSeen?.rows ?? []) {
      const s = seen.get(r.dims[0]) ?? { event: r.dims[0], count: 0, prevCount: period.previous ? 0 : null, keyEvent: false };
      if (r.range === 0) s.count += r.metrics[0];
      else if (s.prevCount != null) s.prevCount += r.metrics[0];
      if (r.dims[1] === "true") s.keyEvent = true;
      seen.set(r.dims[0], s);
    }
    leads = { events: leadEvents, source: opts.leadEvents.source, seen: [...seen.values()].sort((a, b) => b.count - a.count) };
  }

  return {
    template: def.id,
    view,
    scorecards: def.scorecards
      .filter((m) => m !== "leads" || withLeads)
      .map((m) => ({ metric: m, label: METRIC_LABELS[m] ?? m, cur: totalOf(m, 0), prev: period.previous ? totalOf(m, 1) : null })),
    trend: {
      label: METRIC_LABELS[def.trend] ?? def.trend,
      focus,
      cur: points(trendCur),
      prev: period.previous ? points(trendPrev) : null,
    },
    table: {
      dimensionLabel: view.label,
      columns: [...def.metrics, ...(withLeads ? ["leads"] : [])].map((m) => ({ metric: m, label: METRIC_LABELS[m] ?? m })),
      rows,
      rowCount: cur.rowCount,
    },
    leads,
    notes,
    currency: totals.flags.currency,
    timeZone: totals.flags.timeZone,
    period,
    propertyId,
    fetchedAt: Date.now(),
  };
}

