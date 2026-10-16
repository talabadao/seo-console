"use client";

// Project settings → KPI planning: monthly targets for many months at once, in a spreadsheet-style grid (one row
// per month, one column per KPI). The dashboard, All projects and the Weekly report all read these targets.
// - Blank = no target (the KPI isn't shown); 0 = an explicit target of zero. Values are whole numbers.
// - Edits stay in the grid (and survive changing the month range) until "Save all", which saves every changed
//   cell in one transaction: all or nothing. Cells changed elsewhere meanwhile are reported, never overwritten.
// - Bulk operations (paste, copy a month, fill, growth) touch only the cells they're explicitly applied to, and
//   show a preview before replacing any existing value.
// - Unsaved edits are kept in this browser tab's session storage, so switching sections doesn't lose them.

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { KpiMetricSpec, TargetGrid } from "@/lib/kpiTargets";
import { Card, buttonClass, primaryButtonClass } from "./ui";

interface Loaded {
  timeZone: string;
  currentPeriod: string;
  from: string;
  to: string;
  metrics: KpiMetricSpec[];
  grid: TargetGrid;
}

type Drafts = Record<string, string>; // "YYYY-MM|metric" → text as typed ("" = blank)
type Pending = { title: string; cells: Array<{ key: string; value: string }> };

const keyOf = (period: string, metric: string) => `${period}|${metric}`;
const split = (key: string) => key.split("|") as [string, string];

function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = from; p <= to && out.length < 60; p = addMonths(p, 1)) out.push(p);
  return out;
}
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** "1,200" / " 1200 " → "1200"; keeps "" (blank). */
const clean = (v: string) => v.replace(/[,\s]/g, "");

function validate(text: string): string | null {
  const v = clean(text);
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return "Not a number";
  if (n < 0) return "Can't be negative";
  if (!Number.isInteger(n)) return "Whole numbers only";
  if (n > 1e12) return "Too large";
  return null;
}

const savedText = (grid: TargetGrid, period: string, metric: string) => {
  const c = grid[period]?.[metric as keyof TargetGrid[string]];
  return c ? String(c.value) : "";
};

export function KpiPlanner({ projectId, hasGa, leadEvents, onLink, onLeadEvents }: { projectId: number; hasGa: boolean; leadEvents: number | null; onLink: () => void; onLeadEvents: () => void }) {
  const storageKey = `kpi-planner-drafts:${projectId}`;
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<TargetGrid>({}); // every loaded month's saved values, across ranges
  const [drafts, setDrafts] = useState<Drafts>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`kpi-planner-drafts:${projectId}`) ?? "{}") as Drafts;
    } catch {
      return {};
    }
  });
  const [restored] = useState(() => Object.keys(drafts).length);
  const [selMonths, setSelMonths] = useState<Set<string>>(new Set());
  const [selMetrics, setSelMetrics] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);
  const cellRefs = useRef(new Map<string, HTMLInputElement>());

  // Load a range (the first load uses the server's default: the current month in the project's time zone + 11).
  useEffect(() => {
    let live = true;
    const qs = from && to ? `?from=${from}&to=${to}` : "";
    fetch(`/api/projects/${projectId}/kpi-targets${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `Couldn't load targets (status ${r.status}).`);
        if (!live) return;
        const loaded = body as Loaded;
        setData(loaded);
        setSaved((s) => ({ ...s, ...Object.fromEntries(range(loaded.from, loaded.to).map((p) => [p, loaded.grid[p] ?? {}])) }));
        setLoadError(null);
        if (!from || !to) {
          setFrom(loaded.from);
          setTo(loaded.to);
        }
      })
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [projectId, from, to, nonce]);

  // Keep unsaved edits for this tab; warn before leaving the page with unsaved edits.
  const dirtyKeys = useMemo(
    () =>
      Object.keys(drafts).filter((k) => {
        const [p, m] = split(k);
        return clean(drafts[k]) !== savedText(saved, p, m) && (saved[p] !== undefined || clean(drafts[k]) !== "");
      }),
    [drafts, saved],
  );
  useEffect(() => {
    try {
      if (Object.keys(drafts).length) sessionStorage.setItem(storageKey, JSON.stringify(drafts));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // storage unavailable: edits still live in memory
    }
  }, [drafts, storageKey]);
  useEffect(() => {
    if (!dirtyKeys.length) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyKeys.length]);

  const periods = useMemo(() => (data ? range(data.from, data.to) : []), [data]);
  const metrics = useMemo(() => data?.metrics ?? [], [data]);
  const textOf = useCallback((p: string, m: string) => (drafts[keyOf(p, m)] ?? savedText(saved, p, m)), [drafts, saved]);

  const setCell = (key: string, value: string) => setDrafts((d) => ({ ...d, [key]: value }));

  /** Applies bulk cells: straight away when nothing existing would be replaced, otherwise after a preview. */
  function propose(title: string, cells: Array<{ key: string; value: string }>) {
    const changing = cells.filter((c) => clean(textOf(...split(c.key))) !== clean(c.value));
    if (!changing.length) {
      setStatus({ kind: "info", text: `${title}: nothing would change.` });
      return;
    }
    const overwrites = changing.filter((c) => clean(textOf(...split(c.key))) !== "");
    if (!overwrites.length) {
      setDrafts((d) => ({ ...d, ...Object.fromEntries(changing.map((c) => [c.key, c.value])) }));
      setStatus({ kind: "info", text: `${title}: ${changing.length} cell${changing.length === 1 ? "" : "s"} filled. Not saved yet.` });
      return;
    }
    setPending({ title, cells: changing });
  }

  // ---- bulk operations on the selected months × selected KPIs ----
  const targetMonths = periods.filter((p) => selMonths.has(p));
  const targetMetrics = metrics.filter((m) => selMetrics.size === 0 || selMetrics.has(m.id));
  const [fillValue, setFillValue] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [growth, setGrowth] = useState("");

  function fill() {
    const err = validate(fillValue);
    if (err) return setStatus({ kind: "error", text: `Fill value: ${err}.` });
    propose("Fill", targetMonths.flatMap((p) => targetMetrics.map((m) => ({ key: keyOf(p, m.id), value: clean(fillValue) }))));
  }
  function copyMonth() {
    if (!copyFrom) return setStatus({ kind: "error", text: "Choose the month to copy from." });
    propose(
      `Copy ${monthLabel(copyFrom)}`,
      targetMonths.filter((p) => p !== copyFrom).flatMap((p) => targetMetrics.map((m) => ({ key: keyOf(p, m.id), value: clean(textOf(copyFrom, m.id)) }))),
    );
  }
  function applyGrowth() {
    const g = Number(growth);
    if (!Number.isFinite(g) || g < -99) return setStatus({ kind: "error", text: "Growth: enter a percentage, e.g. 5 or -2." });
    if (targetMonths.length < 2) return setStatus({ kind: "error", text: "Growth: select at least two months; the first is the starting point." });
    const [first, ...rest] = targetMonths;
    const cells: Array<{ key: string; value: string }> = [];
    for (const m of targetMetrics) {
      const base = Number(clean(textOf(first, m.id)));
      if (clean(textOf(first, m.id)) === "" || !Number.isFinite(base)) continue;
      rest.forEach((p, i) => cells.push({ key: keyOf(p, m.id), value: String(Math.round(base * (1 + g / 100) ** (i + 1))) }));
    }
    if (!cells.length) return setStatus({ kind: "error", text: `Growth: ${monthLabel(first)} has no targets for the selected KPIs to grow from.` });
    propose(`Grow ${g}% per month from ${monthLabel(first)}`, cells);
  }

  /** Paste a rectangular range (Excel / Google Sheets: tab-separated rows) starting at the focused cell. */
  function onPaste(e: ClipboardEvent<HTMLInputElement>, period: string, metric: string) {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return; // a single value: let the input handle it
    e.preventDefault();
    const rows = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((r) => r.split("\t"));
    const r0 = periods.indexOf(period);
    const c0 = metrics.findIndex((m) => m.id === metric);
    const cells: Array<{ key: string; value: string }> = [];
    const bad: string[] = [];
    let clipped = false;
    rows.forEach((row, i) =>
      row.forEach((raw, j) => {
        const p = periods[r0 + i];
        const m = metrics[c0 + j];
        if (!p || !m) {
          clipped = true;
          return;
        }
        const v = clean(raw);
        const err = validate(v);
        if (err) bad.push(`${monthLabel(p)} · ${m.short}: “${raw.trim()}” (${err})`);
        else cells.push({ key: keyOf(p, m.id), value: v });
      }),
    );
    if (bad.length) {
      setStatus({ kind: "error", text: `Nothing pasted — ${bad.length} value${bad.length === 1 ? " isn't" : "s aren't"} valid: ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "…" : ""}` });
      return;
    }
    propose(`Paste ${rows.length}×${Math.max(...rows.map((r) => r.length))}${clipped ? " (cells outside the visible months/KPIs were skipped)" : ""}`, cells);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    const move = (dr: number, dc: number) => {
      const p = periods[r + dr];
      const m = metrics[c + dc];
      if (p && m) {
        e.preventDefault();
        const el = cellRefs.current.get(keyOf(p, m.id));
        el?.focus();
        el?.select();
      }
    };
    const el = e.currentTarget;
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) move(1, 0);
    else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) move(-1, 0);
    else if (e.key === "ArrowRight" && el.selectionStart === el.value.length) move(0, 1);
    else if (e.key === "ArrowLeft" && el.selectionStart === 0) move(0, -1);
    else if (e.key === "Escape") {
      const key = keyOf(periods[r], metrics[c].id);
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
    }
  }

  async function saveAll() {
    const invalid = dirtyKeys.filter((k) => validate(drafts[k]));
    if (invalid.length) {
      setStatus({ kind: "error", text: `${invalid.length} cell${invalid.length === 1 ? " isn't" : "s aren't"} valid. Fix ${invalid.length === 1 ? "it" : "them"} before saving; nothing was saved.` });
      return;
    }
    setSaving(true);
    setStatus(null);
    setServerErrors({});
    const changes = dirtyKeys.map((k) => {
      const [period, metric] = split(k);
      const v = clean(drafts[k]);
      return { period, metric, value: v === "" ? null : Number(v), expectedUpdatedAt: saved[period]?.[metric as keyof TargetGrid[string]]?.updatedAt ?? null };
    });
    const res = await fetch(`/api/projects/${projectId}/kpi-targets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
    const body = (await res.json().catch(() => ({}))) as {
      saved?: number;
      error?: string;
      cells?: Array<{ period: string; metric: string; message: string }>;
      conflicts?: Array<{ period: string; metric: string; current: { value: number } | null }>;
    };
    setSaving(false);
    if (res.ok) {
      const months = new Set(changes.map((c) => c.period)).size;
      setDrafts({});
      setSaved({});
      setNonce((n) => n + 1);
      setStatus({ kind: "ok", text: `Saved ${body.saved} target${body.saved === 1 ? "" : "s"} across ${months} month${months === 1 ? "" : "s"}.` });
      return;
    }
    if (res.status === 409 && body.conflicts) {
      setServerErrors(Object.fromEntries(body.conflicts.map((c) => [keyOf(c.period, c.metric), `Changed elsewhere: now ${c.current ? c.current.value : "blank"}`])));
    } else if (body.cells) {
      setServerErrors(Object.fromEntries(body.cells.map((c) => [keyOf(c.period, c.metric), c.message])));
    }
    setStatus({ kind: "error", text: body.error ?? `Couldn't save (status ${res.status}). Nothing was saved.` });
  }

  function discard() {
    setDrafts({});
    setServerErrors({});
    setStatus({ kind: "info", text: "Unsaved changes discarded." });
  }

  function reloadConflicts() {
    setDrafts((d) => {
      const next = { ...d };
      for (const k of Object.keys(serverErrors)) delete next[k];
      return next;
    });
    setServerErrors({});
    setSaved({});
    setNonce((n) => n + 1);
  }

  if (!hasGa) {
    return (
      <Card title="KPI planning">
        <p className="text-sm text-muted">Monthly targets are measured in GA4. Link a GA4 property to this project first.</p>
        <button className={`mt-3 ${primaryButtonClass}`} onClick={onLink}>
          Link GA4
        </button>
      </Card>
    );
  }
  if (loadError && !data) {
    return (
      <Card title="KPI planning">
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {loadError}
        </p>
      </Card>
    );
  }
  if (!data || !from || !to) {
    return (
      <Card title="KPI planning">
        <p className="text-sm text-muted">Loading targets…</p>
      </Card>
    );
  }

  const cur = data.currentPeriod;
  const year = Number(cur.slice(0, 4));
  const setRange = (f: string, t: string) => {
    setFrom(f);
    setTo(t < f ? f : t);
    setSelMonths(new Set());
  };
  const outside = dirtyKeys.filter((k) => !periods.includes(split(k)[0])).length;

  return (
    <div className="space-y-4">
      <Card title="KPI planning">
        <p className="text-sm text-muted">
          Monthly targets for this project. The dashboard, All projects and the Weekly report read them from here. Current month: <strong className="text-foreground">{monthLabel(cur)}</strong> ({data.timeZone}).
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="block text-muted">From</span>
            <input type="month" value={from} onChange={(e) => e.target.value && setRange(e.target.value, to)} className="rounded-md border bg-background px-2 py-1 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block text-muted">To</span>
            <input type="month" value={to} min={from} onChange={(e) => e.target.value && setRange(from, e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm" />
          </label>
          <button className={buttonClass} onClick={() => setRange(cur, addMonths(cur, 5))}>
            Next 6 months
          </button>
          <button className={buttonClass} onClick={() => setRange(cur, addMonths(cur, 11))}>
            Next 12 months
          </button>
          <span className="mx-1 text-xs text-muted">Year:</span>
          {[year - 1, year, year + 1, year + 2, year + 3].map((y) => (
            <button key={y} className={`${buttonClass} ${from === `${y}-01` && to === `${y}-12` ? "border-accent text-accent" : ""}`} onClick={() => setRange(`${y}-01`, `${y}-12`)}>
              {y}
            </button>
          ))}
        </div>
        {restored > 0 && dirtyKeys.length > 0 && <p className="mt-2 text-xs text-muted">Restored {dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? "" : "s"} from earlier in this tab.</p>}
        {leadEvents === 0 && (
          <p className="mt-2 text-xs text-muted">
            Lead targets are counted from chosen lead events, and none are chosen yet.{" "}
            <button className="text-accent hover:underline" onClick={onLeadEvents}>
              Choose lead events
            </button>
          </p>
        )}
      </Card>

      <div className="overflow-auto rounded-xl border bg-surface" style={{ maxHeight: "70vh" }}>
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm" aria-label="Monthly KPI targets">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 border-b bg-surface px-3 py-2 text-left text-xs font-medium text-muted">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="Select all months"
                    checked={periods.length > 0 && periods.every((p) => selMonths.has(p))}
                    onChange={(e) => setSelMonths(e.target.checked ? new Set(periods) : new Set())}
                  />
                  Month
                </label>
              </th>
              {metrics.map((m) => (
                <th key={m.id} className="sticky top-0 z-10 border-b bg-surface px-3 py-2 text-left align-bottom text-xs font-medium" scope="col">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      aria-label={`Include ${m.label} in bulk actions`}
                      checked={selMetrics.has(m.id)}
                      onChange={(e) =>
                        setSelMetrics((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(m.id);
                          else n.delete(m.id);
                          return n;
                        })
                      }
                    />
                    <span>
                      <span className="block text-foreground">{m.label}</span>
                      <span className="block font-normal text-muted" title={m.scope}>
                        {m.unit} / month · {m.direction === "higher" ? "higher is better" : "lower is better"}
                      </span>
                    </span>
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p, r) => {
              const past = p < cur;
              return (
                <tr key={p}>
                  <th scope="row" className="sticky left-0 z-10 border-b bg-surface px-3 py-1.5 text-left font-medium">
                    <label className="flex items-center gap-2 whitespace-nowrap">
                      <input
                        type="checkbox"
                        aria-label={`Select ${monthLabel(p)}`}
                        checked={selMonths.has(p)}
                        onChange={(e) =>
                          setSelMonths((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(p);
                            else n.delete(p);
                            return n;
                          })
                        }
                      />
                      {monthLabel(p)}
                      {p === cur && <span className="rounded bg-accent-soft px-1.5 text-[10px] font-medium text-accent">current</span>}
                      {past && <span className="text-[10px] font-normal text-muted">past</span>}
                    </label>
                  </th>
                  {metrics.map((m, c) => {
                    const key = keyOf(p, m.id);
                    const text = textOf(p, m.id);
                    const dirty = dirtyKeys.includes(key);
                    const err = validate(text) ?? serverErrors[key] ?? null;
                    return (
                      <td key={m.id} className="border-b px-2 py-1">
                        <input
                          ref={(el) => {
                            if (el) cellRefs.current.set(key, el);
                            else cellRefs.current.delete(key);
                          }}
                          value={text}
                          inputMode="numeric"
                          placeholder="—"
                          aria-label={`${m.label}, ${monthLabel(p)}`}
                          aria-invalid={err ? true : undefined}
                          title={err ?? (dirty ? `Unsaved (saved: ${savedText(saved, p, m.id) || "blank"})` : undefined)}
                          onChange={(e) => setCell(key, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                          onPaste={(e) => onPaste(e, p, m.id)}
                          onFocus={(e) => e.currentTarget.select()}
                          className="w-full min-w-[6rem] rounded border bg-background px-2 py-1 text-right tabular-nums"
                          style={{
                            borderColor: err ? "var(--bad)" : dirty ? "var(--accent)" : undefined,
                            background: dirty ? "color-mix(in srgb, var(--accent) 8%, var(--background))" : undefined,
                          }}
                        />
                        {err && <span className="block text-[11px]" style={{ color: "var(--bad)" }}>{err}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Blank (—) means no target, so that KPI isn&apos;t shown; 0 is a real target of zero. Arrow keys and Enter move between cells, Esc undoes a cell, and you
        can paste a block copied from Excel or Google Sheets into any cell. Future months show targets only — never results.
      </p>

      <Card title="Bulk changes">
        <p className="text-xs text-muted">
          Apply to the selected months ({targetMonths.length}) and KPIs ({selMetrics.size ? targetMetrics.map((m) => m.short).join(", ") : "all"}). Other cells are
          never touched; you&apos;ll see a preview before any existing value is replaced.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <span className="flex items-end gap-2">
            <label className="text-xs">
              <span className="block text-muted">Fill with</span>
              <input value={fillValue} onChange={(e) => setFillValue(e.target.value)} inputMode="numeric" className="w-24 rounded-md border bg-background px-2 py-1 text-sm" />
            </label>
            <button className={buttonClass} disabled={!targetMonths.length} onClick={fill}>
              Fill
            </button>
          </span>
          <span className="flex items-end gap-2">
            <label className="text-xs">
              <span className="block text-muted">Copy values from</span>
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm">
                <option value="">Month…</option>
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {monthLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <button className={buttonClass} disabled={!targetMonths.length} onClick={copyMonth}>
              Copy to selected
            </button>
          </span>
          <span className="flex items-end gap-2">
            <label className="text-xs">
              <span className="block text-muted">Growth per month (%)</span>
              <input value={growth} onChange={(e) => setGrowth(e.target.value)} inputMode="decimal" placeholder="e.g. 5" className="w-24 rounded-md border bg-background px-2 py-1 text-sm" />
            </label>
            <button className={buttonClass} disabled={targetMonths.length < 2} onClick={applyGrowth} title="Starts from the first selected month's values and compounds month by month">
              Apply growth
            </button>
          </span>
        </div>
      </Card>

      {pending && (
        <div role="dialog" aria-label="Preview changes" className="rounded-xl border bg-surface p-4 text-sm" style={{ borderColor: "var(--accent)" }}>
          <p className="font-semibold">{pending.title}: review before replacing existing values</p>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 pr-3 font-medium">Month</th>
                  <th className="py-1 pr-3 font-medium">KPI</th>
                  <th className="py-1 pr-3 text-right font-medium">Now</th>
                  <th className="py-1 text-right font-medium">New</th>
                </tr>
              </thead>
              <tbody>
                {pending.cells.map((c) => {
                  const [p, m] = split(c.key);
                  const now = clean(textOf(p, m));
                  return (
                    <tr key={c.key} className="border-t border-border/60">
                      <td className="py-1 pr-3">{monthLabel(p)}</td>
                      <td className="py-1 pr-3">{metrics.find((x) => x.id === m)?.short}</td>
                      <td className="py-1 pr-3 text-right tabular-nums" style={{ color: now ? "var(--bad)" : undefined }}>
                        {now || "—"}
                      </td>
                      <td className="py-1 text-right tabular-nums">{c.value || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            {pending.cells.filter((c) => clean(textOf(...split(c.key))) !== "").length} existing value(s) will be replaced. This changes the grid only; nothing is saved
            until Save all.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className={primaryButtonClass}
              onClick={() => {
                setDrafts((d) => ({ ...d, ...Object.fromEntries(pending.cells.map((c) => [c.key, c.value])) }));
                setStatus({ kind: "info", text: `${pending.title}: ${pending.cells.length} cell${pending.cells.length === 1 ? "" : "s"} changed. Not saved yet.` });
                setPending(null);
              }}
            >
              Apply to grid
            </button>
            <button className={buttonClass} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-3 shadow-sm">
        <button className={primaryButtonClass} disabled={saving || !dirtyKeys.length} onClick={saveAll}>
          {saving ? "Saving…" : `Save all${dirtyKeys.length ? ` (${dirtyKeys.length})` : ""}`}
        </button>
        <button className={buttonClass} disabled={saving || !dirtyKeys.length} onClick={discard}>
          Discard changes
        </button>
        <span className="text-xs text-muted">
          {dirtyKeys.length
            ? `${dirtyKeys.length} unsaved change${dirtyKeys.length === 1 ? "" : "s"}${outside ? ` (${outside} in months outside this range)` : ""}.`
            : "All changes saved."}
        </span>
        {status && (
          <span role={status.kind === "error" ? "alert" : "status"} className="text-xs" style={{ color: status.kind === "error" ? "var(--bad)" : status.kind === "ok" ? "var(--good)" : undefined }}>
            {status.text}
          </span>
        )}
        {Object.values(serverErrors).some((m) => m.startsWith("Changed elsewhere")) && (
          <button className="text-xs text-accent hover:underline" onClick={reloadConflicts}>
            Load the newer values for those cells
          </button>
        )}
      </div>
    </div>
  );
}
