"use client";

import { useMemo, useState } from "react";
import { METRIC_META, type MetricKey, fmtFull } from "./format";
import { country, deviceLabel } from "@/lib/geo";

export interface BreakdownRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  prevClicks: number;
  prevImpressions: number;
  prevCtr: number;
  prevPosition: number;
  isNew: boolean;
}

const DIMENSION_LABELS: Record<string, string> = {
  query: "Query",
  page: "Page",
  country: "Country",
  device: "Device",
  searchAppearance: "Search appearance",
};

type SortKey = "key" | MetricKey;

function pctChange(cur: number, prev: number): number | null {
  if (!prev) return cur > 0 ? Infinity : null;
  return ((cur - prev) / prev) * 100;
}

/** Quote/escape a CSV field and neutralise leading spreadsheet-formula characters. */
function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  const pc = pctChange(cur, prev);
  if (pc === null) return null;
  const up = pc > 0;
  const good = invert ? !up : up;
  if (isFinite(pc) && Math.abs(pc) < 0.5)
    return <span className="ml-1 text-xs text-muted">0%</span>;
  const label =
    !isFinite(pc) || Math.abs(pc) >= 999 ? "∞+%" : `${Math.abs(pc).toFixed(0)}%`;
  return (
    <span className="ml-1 text-xs" style={{ color: good ? "var(--good)" : "var(--bad)" }}>
      {up ? "↑" : "↓"}
      {label}
    </span>
  );
}

function KeyCell({ dimension, value }: { dimension: string; value: string }) {
  if (dimension === "country") {
    const c = country(value);
    return (
      <span className="flex items-center gap-2">
        {c.alpha2 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://flagsapi.com/${c.alpha2}/flat/24.png`}
            alt={c.alpha2}
            width={20}
            height={15}
            className="rounded-sm"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
        ) : (
          <span aria-hidden>🌐</span>
        )}
        {c.name}
      </span>
    );
  }
  if (dimension === "device") {
    const d = deviceLabel(value);
    return (
      <span className="flex items-center gap-2">
        <span aria-hidden>{d.icon}</span>
        {d.label}
      </span>
    );
  }
  return <span className="truncate">{value || <span className="text-muted">(not set)</span>}</span>;
}

export function BreakdownTable({
  dimension,
  rows,
  totalCount,
  active,
  compareOn,
  trend,
  onTrend,
}: {
  dimension: string;
  rows: BreakdownRow[];
  totalCount: number;
  active: MetricKey[];
  compareOn: boolean;
  trend: "all" | "growing" | "decaying" | "new";
  onTrend: (t: "all" | "growing" | "decaying" | "new") => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("clicks");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState<number>(25); // 0 = all

  const cols: MetricKey[] = active.length ? active : ["clicks", "impressions", "ctr", "position"];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle ? rows.filter((r) => r.key.toLowerCase().includes(needle)) : rows;
    return [...base].sort((a, b) => {
      const av = sort === "key" ? a.key : a[sort];
      const bv = sort === "key" ? b.key : b[sort];
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, q, sort, dir]);

  const shown = pageSize > 0 ? filtered.slice(0, pageSize) : filtered;

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setDir(k === "key" ? "asc" : "desc");
    }
  }

  function exportCsv() {
    const label = DIMENSION_LABELS[dimension] ?? dimension;
    const header = [label, "Clicks", "Impressions", "CTR", "Position"];
    const lines = [header.map(csvCell).join(",")];
    for (const r of filtered) {
      lines.push(
        [
          csvCell(r.key),
          r.clicks,
          r.impressions,
          (r.ctr * 100).toFixed(2) + "%",
          r.position.toFixed(1),
        ].join(","),
      );
    }
    // Prepend a UTF-8 BOM (U+FEFF) so Excel on Windows reads the file as UTF-8 —
    // without it Excel uses the system codepage and mangles Korean / Japanese /
    // Chinese / Cyrillic / accented text.
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${dimension}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const arrow = (k: SortKey) => (sort === k ? (dir === "asc" ? " ▲" : " ▼") : "");
  const prevOf = (r: BreakdownRow, c: MetricKey) =>
    c === "clicks"
      ? r.prevClicks
      : c === "impressions"
        ? r.prevImpressions
        : c === "ctr"
          ? r.prevCtr
          : r.prevPosition;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="flex rounded-md border p-0.5 text-xs">
          {(
            [
              ["all", "All"],
              ["growing", "Growing"],
              ["decaying", "Decaying"],
              ["new", "New"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => onTrend(t)}
              className={`rounded px-2 py-1 ${
                trend === t ? "bg-accent text-white" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Filter…`}
          className="min-w-48 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <span className="text-sm text-muted">
          {filtered.length.toLocaleString()}
          {totalCount > rows.length ? ` of ${totalCount.toLocaleString()}` : ""} rows
        </span>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          {[10, 25, 50, 100, 250, 1000, 5000].map((n) => (
            <option key={n} value={n}>
              Show {n.toLocaleString()}
            </option>
          ))}
          <option value={0}>Show all ({filtered.length.toLocaleString()})</option>
        </select>
        <button
          onClick={exportCsv}
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent-soft"
        >
          Export CSV
        </button>
      </div>

      <div className="max-h-[34rem] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b text-left text-muted">
              <th
                className="cursor-pointer select-none px-4 py-2.5 font-medium"
                onClick={() => toggleSort("key")}
              >
                {DIMENSION_LABELS[dimension] ?? dimension}
                {arrow("key")}
              </th>
              {cols.map((c) => (
                <th
                  key={c}
                  className="cursor-pointer select-none whitespace-nowrap px-4 py-2.5 text-right font-medium"
                  onClick={() => toggleSort(c)}
                  style={{ color: METRIC_META[c].color }}
                >
                  {METRIC_META[c].label.replace("Total ", "").replace("Average ", "Avg ")}
                  {arrow(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-b border-border/60 hover:bg-accent-soft/40">
                <td className="max-w-md px-4 py-2" title={r.key}>
                  <span className="flex items-center gap-1.5">
                    <KeyCell dimension={dimension} value={r.key} />
                    {r.isNew && (
                      <span className="rounded bg-good/15 px-1 text-[10px] font-semibold text-good">
                        NEW
                      </span>
                    )}
                  </span>
                </td>
                {cols.map((c) => (
                  <td key={c} className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    {fmtFull(r[c], METRIC_META[c].kind)}
                    {compareOn && (
                      <Delta cur={r[c]} prev={prevOf(r, c)} invert={c === "position"} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={cols.length + 1} className="px-4 py-10 text-center text-muted">
                  No rows match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
