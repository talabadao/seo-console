"use client";

// Custom GA4 reports: a small report builder inspired by GA4 Explorations' free-form table (not an import of
// Explorations; no segments or other techniques). Fields come from the property's own metadata, combinations
// are checked with GA4's compatibility check, and a report runs only on an explicit action (Run, or opening a
// saved report), through the shared cache and the GA4 quota windows.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_TYPES, DEFAULT_SPEC, FILTER_OPS, LIMITS, ADDITIVE_METRICS, type ChartType, type FilterOp, type ReportSpec } from "@/lib/v2/ga4reports/spec";
import type { CustomResult } from "@/lib/v2/ga4reports/run";
import type { SavedReport } from "@/lib/v2/ga4reports/saved";
import type { GaFieldMeta } from "@/lib/ga4";
import { SearchableSelect } from "../SearchableSelect";
import { Delta, PeriodPicker, Stat, fmtTime } from "./summaryUi";
import { Card, DataTable, EmptyState, ErrorState, LoadingState, buttonClass, primaryButtonClass, type Column } from "./ui";
import { ReportFooter, fmtMetric, useGaJson, type CacheMeta } from "./ga4Shared";
import { alignSeries, daysOf, fillFor } from "@/lib/v2/ga4reports/days";

type MetaResponse =
  | { state: "live"; propertyId: string; timeZone: string | null; currency: string | null; dimensions: GaFieldMeta[]; metrics: GaFieldMeta[] }
  | { state: string; message?: string };
type ListResponse = { state: "live"; currentPropertyId: string | null; reports: SavedReport[] } | { state: string; message?: string };
type RunResponse =
  | { state: "live"; result: CustomResult; cache: CacheMeta }
  | { state: "property-changed"; savedPropertyId: string; currentPropertyId: string }
  | { state: "invalid"; errors: string[] }
  | { state: string; message?: string };

interface Draft {
  id: number | null;
  name: string;
  spec: ReportSpec;
  propertyId: string | null;
}

const NEW_DRAFT: Draft = { id: null, name: "", spec: DEFAULT_SPEC, propertyId: null };
const COLORS = ["var(--clicks)", "var(--impressions)", "var(--ctr)", "var(--position)", "var(--good)", "var(--bad)", "var(--accent)", "var(--muted)"];
const sel = "rounded-md border bg-background px-2 py-1.5 text-sm";

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

export function Ga4ReportBuilder({ projectId }: { projectId: number }) {
  const meta = useGaJson<MetaResponse>(`/api/v2/ga4/${projectId}/metadata`);
  const [listNonce, setListNonce] = useState(0);
  const list = useGaJson<ListResponse>(`/api/v2/ga4/${projectId}/reports`, null, listNonce);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [run, setRun] = useState<{ body: string; nonce: number } | null>(null);
  const [messages, setMessages] = useState<{ tone: "good" | "bad"; text: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const result = useGaJson<RunResponse>(run ? `/api/v2/ga4/${projectId}/run` : null, run ? { method: "POST", body: run.body } : null, run?.nonce ?? 0);

  const m = meta.data && meta.data.state === "live" ? (meta.data as Extract<MetaResponse, { state: "live" }>) : null;
  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of [...(m?.dimensions ?? []), ...(m?.metrics ?? [])]) out[f.apiName] = f.uiName;
    return out;
  }, [m]);
  const label = (n: string) => labels[n] ?? n;
  const saved = list.data && list.data.state === "live" ? (list.data as Extract<ListResponse, { state: "live" }>) : null;
  const currentProperty = saved?.currentPropertyId ?? m?.propertyId ?? null;
  const propertyChanged = draft.id != null && draft.propertyId != null && currentProperty != null && draft.propertyId !== currentProperty;

  const setSpec = (patch: Partial<ReportSpec>) => setDraft((d) => ({ ...d, spec: { ...d.spec, ...patch } }));
  const runNow = (d: Draft, refresh = false) => {
    setMessages(null);
    setRun((r) => ({ body: JSON.stringify({ spec: d.spec, reportId: d.id ?? undefined }), nonce: refresh ? (r?.nonce ?? 0) + 1 : (r?.nonce ?? 0) }));
  };
  const open = (rep: SavedReport) => {
    const d = { id: rep.id, name: rep.name, spec: rep.spec, propertyId: rep.propertyId };
    setDraft(d);
    if (!currentProperty || rep.propertyId === currentProperty) runNow(d);
    else setRun(null);
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const errorsOf = (json: { errors?: string[]; error?: string; message?: string }) => json.errors ?? [json.error ?? json.message ?? "The request failed."];

  const check = () =>
    act(async () => {
      const r = await send(`/api/v2/ga4/${projectId}/check`, "POST", { spec: draft.spec });
      setMessages(r.json.ok ? { tone: "good", text: ["GA4 accepts this combination of fields and filters."] } : { tone: "bad", text: errorsOf(r.json) });
    });
  const save = (asCopy: boolean) =>
    act(async () => {
      const name = asCopy ? (draft.name ? `Copy of ${draft.name}` : "") : draft.name;
      const r =
        draft.id != null && !asCopy
          ? await send(`/api/v2/ga4/${projectId}/reports/${draft.id}`, "PUT", { name, spec: draft.spec })
          : await send(`/api/v2/ga4/${projectId}/reports`, "POST", { name, spec: draft.spec });
      if (!r.json.ok) return setMessages({ tone: "bad", text: errorsOf(r.json) });
      const rep = r.json.report as SavedReport;
      setDraft({ id: rep.id, name: rep.name, spec: rep.spec, propertyId: rep.propertyId });
      setMessages({ tone: "good", text: [asCopy ? `Saved a copy as “${rep.name}”.` : `Saved “${rep.name}”.`] });
      setListNonce((n) => n + 1);
    });
  const duplicate = (rep: SavedReport) =>
    act(async () => {
      const r = await send(`/api/v2/ga4/${projectId}/reports`, "POST", { duplicateOf: rep.id });
      setMessages(r.json.ok ? { tone: "good", text: [`Created “${r.json.report.name}”.`] } : { tone: "bad", text: errorsOf(r.json) });
      setListNonce((n) => n + 1);
    });
  const remove = (rep: SavedReport) =>
    act(async () => {
      if (!window.confirm(`Delete the saved report “${rep.name}”? This can't be undone.`)) return;
      const r = await send(`/api/v2/ga4/${projectId}/reports/${rep.id}`, "DELETE");
      if (r.ok && draft.id === rep.id) {
        setDraft(NEW_DRAFT);
        setRun(null);
      }
      setMessages(r.ok ? { tone: "good", text: [`Deleted “${rep.name}”.`] } : { tone: "bad", text: errorsOf(r.json) });
      setListNonce((n) => n + 1);
    });
  const rebind = () =>
    act(async () => {
      const r = await send(`/api/v2/ga4/${projectId}/reports/${draft.id}`, "PUT", { name: draft.name, spec: draft.spec, rebind: true });
      if (!r.json.ok) return setMessages({ tone: "bad", text: errorsOf(r.json) });
      const rep = r.json.report as SavedReport;
      const d = { id: rep.id, name: rep.name, spec: rep.spec, propertyId: rep.propertyId };
      setDraft(d);
      setListNonce((n) => n + 1);
      runNow(d);
    });

  if (meta.loading) return <LoadingState label="Loading this property's GA4 fields…" />;
  if (meta.error) return <ErrorState title="Couldn't load GA4 fields." body={meta.error} />;
  if (!m) {
    const d = meta.data as { state: string; message?: string } | null;
    if (d?.state === "error") return <ErrorState title="Couldn't load GA4 fields." body={d.message} />;
    return <EmptyState title={d?.state === "demo" ? "Demo project" : "Not available"} body={d?.message} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Card title="Saved reports">
        <button className={`${buttonClass} mb-3 w-full justify-center`} onClick={() => (setDraft(NEW_DRAFT), setRun(null), setMessages(null))}>
          New report
        </button>
        {list.loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !saved ? (
          <p className="text-sm text-muted">{(list.data as { message?: string } | null)?.message ?? list.error ?? "Saved reports aren't available."}</p>
        ) : saved.reports.length === 0 ? (
          <p className="text-sm text-muted">No saved reports for this project yet.</p>
        ) : (
          <ul className="space-y-1">
            {saved.reports.map((rep) => (
              <li key={rep.id} className={`rounded-md border px-2 py-1.5 ${draft.id === rep.id ? "border-accent" : ""}`}>
                <button className="block w-full truncate text-left text-sm font-medium hover:underline" onClick={() => open(rep)} title={rep.name}>
                  {rep.name}
                </button>
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <span>{CHART_TYPES.find((c) => c.id === rep.spec.chart)?.label ?? rep.spec.chart}</span>
                  {rep.propertyId !== saved.currentPropertyId && <span style={{ color: "var(--bad)" }}>other property</span>}
                  <span className="ml-auto flex gap-2">
                    <button className="hover:underline" onClick={() => duplicate(rep)} disabled={busy}>
                      Duplicate
                    </button>
                    <button className="hover:underline" onClick={() => remove(rep)} disabled={busy}>
                      Delete
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-muted">Visible only to you, for this project. Dates are relative: a saved “Last 28 days” always means the latest 28 days.</p>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card title={draft.id ? `Edit: ${draft.name}` : "New report"}>
          <div className="space-y-4">
            {propertyChanged && (
              <div className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "var(--bad)" }}>
                <p>
                  This report was saved for GA4 property {draft.propertyId?.replace("properties/", "")}; the project now uses {currentProperty?.replace("properties/", "")}. Custom
                  dimensions and metrics may not exist in the new property, so it hasn&apos;t been run.
                </p>
                <button className={`${buttonClass} mt-2`} onClick={rebind} disabled={busy}>
                  Check and use with the current property
                </button>
              </div>
            )}
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted">Name</span>
              <input className="w-full rounded-md border bg-background px-2 py-1.5" maxLength={LIMITS.name} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Organic sessions by landing page" />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <FieldList
                title={`Dimensions (up to ${LIMITS.dimensions})`}
                values={draft.spec.dimensions}
                options={m.dimensions}
                max={LIMITS.dimensions}
                label={label}
                onChange={(dimensions) => setSpec({ dimensions, sort: draft.spec.sort && ![...dimensions, ...draft.spec.metrics].includes(draft.spec.sort.field) ? null : draft.spec.sort })}
              />
              <FieldList
                title={`Metrics (up to ${LIMITS.metrics})`}
                values={draft.spec.metrics}
                options={m.metrics}
                max={LIMITS.metrics}
                label={label}
                onChange={(metrics) => setSpec({ metrics, sort: draft.spec.sort && ![...draft.spec.dimensions, ...metrics].includes(draft.spec.sort.field) ? null : draft.spec.sort })}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Chart</span>
                <select className={sel} value={draft.spec.chart} onChange={(e) => setSpec({ chart: e.target.value as ChartType })}>
                  {CHART_TYPES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-sm">
                <span className="mb-1 block text-xs text-muted">Date range</span>
                <PeriodPicker value={{ preset: draft.spec.preset, compare: draft.spec.compare }} onChange={(v) => setSpec(v)} />
              </div>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Sort by</span>
                <select
                  className={sel}
                  value={draft.spec.sort ? `${draft.spec.sort.field}|${draft.spec.sort.desc ? "desc" : "asc"}` : ""}
                  onChange={(e) => {
                    const [field, dir] = e.target.value.split("|");
                    setSpec({ sort: field ? { field, desc: dir !== "asc" } : null });
                  }}
                >
                  <option value="">First metric, high to low</option>
                  {[...draft.spec.dimensions, ...draft.spec.metrics].flatMap((f) => [
                    <option key={`${f}|desc`} value={`${f}|desc`}>
                      {label(f)}, high to low
                    </option>,
                    <option key={`${f}|asc`} value={`${f}|asc`}>
                      {label(f)}, low to high
                    </option>,
                  ])}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Rows</span>
                <input type="number" min={1} max={LIMITS.rows} className={`${sel} w-24`} value={draft.spec.limit} onChange={(e) => setSpec({ limit: Math.max(1, Math.min(LIMITS.rows, Number(e.target.value) || 1)) })} />
              </label>
            </div>
            <Filters spec={draft.spec} dims={m.dimensions} label={label} onChange={(filters) => setSpec({ filters })} />
            {draft.spec.chart === "donut" && draft.spec.metrics[0] && !ADDITIVE_METRICS.has(draft.spec.metrics[0]) && (
              <p className="text-xs" style={{ color: "var(--bad)" }}>
                A donut needs a metric that adds up across rows (for example sessions or event count); users, rates and averages don&apos;t.
              </p>
            )}
            {messages && (
              <ul className="space-y-1 text-sm" style={{ color: messages.tone === "good" ? "var(--good)" : "var(--bad)" }} role="status">
                {messages.text.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button className={primaryButtonClass} onClick={() => runNow(draft)} disabled={busy || propertyChanged}>
                Run
              </button>
              <button className={buttonClass} onClick={check} disabled={busy}>
                Check fields
              </button>
              <button className={buttonClass} onClick={() => save(false)} disabled={busy || propertyChanged}>
                {draft.id ? "Save changes" : "Save"}
              </button>
              {draft.id != null && (
                <button className={buttonClass} onClick={() => save(true)} disabled={busy || propertyChanged}>
                  Save as copy
                </button>
              )}
            </div>
            <p className="text-xs text-muted">
              Reports run only when you press Run or open a saved report. Identical runs within 2 hours reuse the stored result; Refresh asks GA4 again.
            </p>
          </div>
        </Card>

        {run && <ResultPanel res={result} chart={JSON.parse(run.body).spec.chart} label={label} onRefresh={() => runNow(draft, true)} />}
      </div>
    </div>
  );
}

function FieldList({
  title,
  values,
  options,
  max,
  label,
  onChange,
}: {
  title: string;
  values: string[];
  options: GaFieldMeta[];
  max: number;
  label: (n: string) => string;
  onChange: (v: string[]) => void;
}) {
  const opts = useMemo(
    () =>
      options
        .filter((o) => !values.includes(o.apiName))
        .map((o) => ({ value: o.apiName, label: o.uiName, sublabel: `${o.apiName} · ${o.category}${o.custom ? " · custom" : ""}` })),
    [options, values],
  );
  return (
    <div className="text-sm">
      <span className="mb-1 block text-xs text-muted">{title}</span>
      <ul className="mb-2 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <li key={v} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            <span title={v}>{label(v)}</span>
            <button aria-label={`Remove ${label(v)}`} className="text-muted hover:text-foreground" onClick={() => onChange(values.filter((x) => x !== v))}>
              ×
            </button>
          </li>
        ))}
        {!values.length && <li className="text-xs text-muted">None</li>}
      </ul>
      {values.length < max && <SearchableSelect value="" options={opts} onChange={(v) => v && onChange([...values, v])} placeholder="Add…" />}
    </div>
  );
}

function Filters({ spec, dims, label, onChange }: { spec: ReportSpec; dims: GaFieldMeta[]; label: (n: string) => string; onChange: (f: ReportSpec["filters"]) => void }) {
  const opts = useMemo(() => dims.map((d) => ({ value: d.apiName, label: d.uiName, sublabel: d.apiName })), [dims]);
  const set = (i: number, patch: Partial<ReportSpec["filters"][number]>) => onChange(spec.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="text-sm">
      <span className="mb-1 block text-xs text-muted">Filters (all must match; dimensions only)</span>
      <ul className="space-y-2">
        {spec.filters.map((f, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <SearchableSelect value={f.field} options={opts} onChange={(v) => set(i, { field: v })} placeholder="Dimension…" />
            </div>
            <select className={sel} value={f.negate ? "not" : "is"} onChange={(e) => set(i, { negate: e.target.value === "not" })} aria-label="Include or exclude">
              <option value="is">include where</option>
              <option value="not">exclude where</option>
            </select>
            <span className="sr-only">{label(f.field)}</span>
            <select className={sel} value={f.op} onChange={(e) => set(i, { op: e.target.value as FilterOp })} aria-label="Match type">
              {FILTER_OPS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input className={`${sel} min-w-40 flex-1`} value={f.value} onChange={(e) => set(i, { value: e.target.value })} aria-label="Value" />
            <button className="text-xs text-muted hover:text-foreground" onClick={() => onChange(spec.filters.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {spec.filters.length < LIMITS.filters && (
        <button className="mt-2 text-xs text-accent hover:underline" onClick={() => onChange([...spec.filters, { field: "", op: "exact", value: "", negate: false }])}>
          Add filter
        </button>
      )}
    </div>
  );
}

function ResultPanel({ res, chart, label, onRefresh }: { res: { data: RunResponse | null; error: string | null; loading: boolean }; chart: ChartType; label: (n: string) => string; onRefresh: () => void }) {
  if (res.loading) return <LoadingState label="Running in GA4…" />;
  if (res.error) return <ErrorState title="The report didn't run." body={res.error} />;
  const d = res.data;
  if (!d) return null;
  if (d.state === "invalid") return <ErrorState title="Fix the report first." body={<ul>{(d as { errors: string[] }).errors.map((e) => <li key={e}>{e}</li>)}</ul>} />;
  if (d.state === "property-changed") return <EmptyState title="The project's GA4 property changed." body="Use the button above to check the report against the current property." />;
  if (d.state !== "live") return <ErrorState title="GA4 returned an error." body={(d as { message?: string }).message} />;
  const { result: r, cache } = d as Extract<RunResponse, { state: "live" }>;
  return (
    <Card
      title="Result"
      actions={
        <button className={buttonClass} onClick={onRefresh}>
          Refresh
        </button>
      }
    >
      <div className="space-y-4">
        <ResultView r={r} chart={chart} label={label} />
        <ReportFooter
          period={r.period}
          propertyId={r.propertyId}
          timeZone={r.timeZone}
          currency={r.currency}
          fetchedAt={r.fetchedAt}
          cache={cache}
          notes={r.notes}
          extra={<p>Totals come from GA4 for the whole filtered report (users counted once), not from adding up the rows. Ran {fmtTime(r.fetchedAt)}.</p>}
        />
      </div>
    </Card>
  );
}

type Row = CustomResult["rows"][number];

function ResultView({ r, chart, label }: { r: CustomResult; chart: ChartType; label: (n: string) => string }) {
  const [metricIdx, setMetricIdx] = useState(0);
  useEffect(() => setMetricIdx(0), [r]);
  const hasPrev = r.period.previous != null;
  const metric = r.metrics[metricIdx] ?? r.metrics[0];
  const fmt = (i: number, v: number | null | undefined) => fmtMetric(r.metrics[i].name, v, r.metrics[i].type, r.currency);

  const totals = (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {r.metrics.map((mm, i) => (
        <Stat
          key={mm.name}
          label={label(mm.name)}
          value={fmt(i, r.totals.cur[i])}
          pair={hasPrev ? { current: r.totals.cur[i], previous: r.totals.prev?.[i] ?? null } : undefined}
        />
      ))}
    </div>
  );
  const metricPicker =
    r.metrics.length > 1 && chart !== "donut" ? (
      <select aria-label="Metric to chart" className={sel} value={metricIdx} onChange={(e) => setMetricIdx(Number(e.target.value))}>
        {r.metrics.map((mm, i) => (
          <option key={mm.name} value={i}>
            {label(mm.name)}
          </option>
        ))}
      </select>
    ) : null;

  let view: ReactNode = null;
  if (chart === "scorecard" || !r.dimensions.length) view = null;
  else if (chart === "line" && r.series) {
    const split = r.dimensions.length > 1;
    const dates = daysOf(r.period.current);
    const fill = fillFor(metric.name, metric.type);
    let data: Record<string, string | number | null>[];
    let keys: string[];
    if (split) {
      // Top 5 split values by the charted metric; the ranking only orders the lines, nothing is shown summed.
      const rank = new Map<string, number>();
      for (const p of r.series) rank.set(p.split ?? "", (rank.get(p.split ?? "") ?? 0) + (p.values[metricIdx] ?? 0));
      keys = [...rank.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
      const lines = keys.map((k) => alignSeries(r.series!.filter((p) => (p.split ?? "") === k).map((p) => ({ date: p.date, value: p.values[metricIdx] })), dates, fill));
      data = dates.map((date, i) => Object.fromEntries([["date", date], ...keys.map((k, j) => [k, lines[j][i]])]));
    } else {
      // One slot per day; the comparison's day N next to the current day N (GA4 omits days without data).
      const cur = alignSeries(r.series.map((p) => ({ date: p.date, value: p.values[metricIdx] })), dates, fill);
      const prevDates = r.period.previous ? daysOf(r.period.previous) : [];
      const prev = r.prevSeries ? alignSeries(r.prevSeries.map((p) => ({ date: p.date, value: p.values[metricIdx] })), prevDates, fill) : [];
      data = dates.map((date, i) => ({ date, Current: cur[i], ...(r.prevSeries ? { Comparison: i < prev.length ? prev[i] : null } : {}) }));
      keys = r.prevSeries ? ["Current", "Comparison"] : ["Current"];
    }
    view = (
      <div className="h-64 w-full" role="img" aria-label={`${label(metric.name)} by day`}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis tick={{ fontSize: 11 }} width={56} />
            <Tooltip formatter={(v) => fmt(metricIdx, Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} name={k || "(not set)"} stroke={COLORS[i % COLORS.length]} strokeDasharray={k === "Comparison" ? "4 3" : undefined} dot={false} strokeWidth={2} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {split && <p className="text-xs text-muted">Current period, top 5 values of {label(r.dimensions[1].name)}.</p>}
      </div>
    );
  } else if (chart === "bar") {
    const data = r.rows.slice(0, 15).map((row) => ({ name: row.key[0] || "(not set)", value: row.cur[metricIdx] ?? 0 }));
    view = (
      <div className="w-full" style={{ height: Math.max(160, data.length * 28 + 40) }} role="img" aria-label={`${label(metric.name)} by ${label(r.dimensions[0].name)}`}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => fmt(metricIdx, Number(v))} />
            <Bar dataKey="value" name={label(metric.name)} fill="var(--clicks)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  } else if (chart === "donut") {
    const top = r.rows.slice(0, 7).map((row) => ({ name: row.key[0] || "(not set)", value: row.cur[0] ?? 0 }));
    const total = r.totals.cur[0] ?? 0;
    // The metric is additive (enforced when saving), so the remainder of GA4's total is everything else.
    const rest = total - top.reduce((s, x) => s + x.value, 0);
    const data = rest > 0.5 ? [...top, { name: "Everything else", value: rest }] : top;
    view = (
      <div className="h-64 w-full" role="img" aria-label={`Share of ${label(r.metrics[0].name)} by ${label(r.dimensions[0].name)}`}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={1}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `${fmt(0, Number(v))} (${total ? ((Number(v) / total) * 100).toFixed(1) : "0"}%)`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const columns: Column<Row>[] = [
    ...r.dimensions.map((d, i): Column<Row> => ({ key: `d${i}`, label: label(d.name), value: (row) => row.key[i] ?? "", render: (row) => <span className="break-all">{row.key[i] || "(not set)"}</span> })),
    ...r.metrics.map(
      (mm, i): Column<Row> => ({
        key: `m${i}`,
        label: label(mm.name),
        numeric: true,
        value: (row) => row.cur[i],
        render: (row) => (
          <span className="inline-flex flex-col items-end">
            <span>{fmt(i, row.cur[i])}</span>
            {hasPrev && <Delta pair={{ current: row.cur[i], previous: row.prev?.[i] ?? null }} />}
          </span>
        ),
      }),
    ),
  ];
  const showTable = r.dimensions.length > 0 && !(chart === "line" && r.series);
  return (
    <div className="space-y-4">
      {totals}
      {metricPicker && view && <div className="flex justify-end">{metricPicker}</div>}
      {view}
      {showTable && (
        <DataTable
          columns={columns}
          rows={r.rows}
          rowKey={(row) => row.key.join("\u0001")}
          exportName="ga4-custom-report"
          note={r.notes.truncated ? `First ${r.rows.length} of ${r.rowCount.toLocaleString("en-US")} rows.` : hasPrev ? "A dash means the row isn't in the comparison period's results." : undefined}
        />
      )}
    </div>
  );
}
