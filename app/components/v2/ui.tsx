"use client";

// Shared building blocks for v2 pages: one look for headers, cards, tables
// and the loading / empty / error / demo states.

import { useMemo, useState, type ReactNode } from "react";
import { downloadCsv } from "../csv";
import { DEMO_CSV_NOTE } from "@/lib/v2/demo";
import type { ItemStatus } from "@/lib/v2/nav";

export type Status = ItemStatus | "not-connected";

const STATUS: Record<Status, { label: string; dot: string; title: string }> = {
  live: { label: "Live", dot: "var(--good)", title: "Real data from a connected source" },
  demo: { label: "Demo", dot: "var(--position)", title: "Fictional sample data, not real measurements" },
  planned: { label: "Planned", dot: "var(--muted)", title: "Not built yet; arrives in a later milestone" },
  "not-connected": { label: "Not connected", dot: "var(--bad)", title: "This project is missing a connection this page needs" },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground"
      title={s.title}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  crumbs,
  title,
  status,
  description,
  actions,
  onNavigate,
}: {
  crumbs: Crumb[];
  title: string;
  status?: Status;
  description?: string;
  actions?: ReactNode;
  onNavigate: (href: string) => void;
}) {
  return (
    <header className="mb-6">
      <nav aria-label="Breadcrumb" className="mb-1 text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          {crumbs.map((c, i) => (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">/</span>}
              {c.href && i < crumbs.length - 1 ? (
                <a
                  href={c.href}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    onNavigate(c.href!);
                  }}
                  className="rounded hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {c.label}
                </a>
              ) : (
                <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {status && <StatusBadge status={status} />}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
    </header>
  );
}

export function Card({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border bg-surface ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function DemoBanner({ what }: { what?: string }) {
  return (
    <div role="note" className="mb-4 flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm" style={{ borderColor: "var(--position)" }}>
      <StatusBadge status="demo" />
      <p className="text-muted">
        <strong className="text-foreground">Demo data.</strong> {what ?? "This page shows a fictional project to demonstrate the workflow."} Nothing
        here is a real measurement, and no provider is called.
      </p>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-surface p-8 text-center">
      <p className="font-medium">{title}</p>
      {body && <div className="mx-auto mt-1 max-w-lg text-sm text-muted">{body}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-6 text-sm">
      <p className="font-medium">{title}</p>
      {body && <div className="mt-1 text-muted">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="rounded-xl border bg-surface p-4">
      <span className="sr-only">{label}</span>
      <div className="space-y-3" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-border/70" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}

export const buttonClass =
  "inline-flex items-center gap-1.5 rounded-md border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
export const primaryButtonClass =
  "inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

export interface Column<T> {
  key: string;
  label: string;
  numeric?: boolean;
  /** Value used for sorting and CSV; defaults to row[key]. */
  value?: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  width?: string;
}

/**
 * Sortable, searchable, paginated table with CSV export. Numeric columns are
 * right-aligned with tabular figures; widths stay stable while paging.
 * `demo` puts a demo notice in the export.
 */
export function DataTable<T>({
  columns,
  rows,
  searchPlaceholder = "Search…",
  pageSize = 25,
  exportName,
  demo = false,
  toolbar,
  emptyText = "No rows match.",
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  searchPlaceholder?: string;
  pageSize?: number;
  exportName?: string;
  demo?: boolean;
  toolbar?: ReactNode;
  emptyText?: string;
  rowKey: (row: T) => string;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const valueOf = (c: Column<T>, r: T) => (c.value ? c.value(r) : ((r as Record<string, unknown>)[c.key] as string | number | null));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = needle
      ? rows.filter((r) => columns.some((c) => String(valueOf(c, r) ?? "").toLowerCase().includes(needle)))
      : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        list = [...list].sort((a, b) => {
          const x = valueOf(col, a);
          const y = valueOf(col, b);
          if (x == null && y == null) return 0;
          if (x == null) return 1; // missing values last, whatever the direction
          if (y == null) return -1;
          return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, q, sort]);

  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * pageSize, current * pageSize + pageSize);

  function exportCsv() {
    const header = columns.map((c) => c.label);
    const body = shown.map((r) => columns.map((c) => valueOf(c, r) ?? ""));
    downloadCsv(`${exportName ?? "table"}${demo ? "-DEMO" : ""}-${new Date().toISOString().slice(0, 10)}.csv`, [
      ...(demo ? [[DEMO_CSV_NOTE]] : []),
      header,
      ...body,
    ]);
  }

  return (
    <div className="rounded-xl border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder={searchPlaceholder}
          aria-label="Search table"
          className="w-56 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        {toolbar}
        <span className="ml-auto text-xs text-muted">{shown.length.toLocaleString()} rows</span>
        {exportName && (
          <button onClick={exportCsv} className={buttonClass}>
            Export CSV
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-muted">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}
                    className={`px-3 py-2 font-medium ${c.numeric ? "text-right" : ""}`}
                  >
                    <button
                      onClick={() => setSort(active ? { key: c.key, dir: sort!.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.numeric ? -1 : 1 })}
                      className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {c.label}
                      <span aria-hidden="true" className="text-xs">
                        {active ? (sort!.dir === 1 ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={rowKey(r)} className="border-b border-border/60 last:border-0 hover:bg-accent-soft/30">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                    {c.render ? c.render(r) : (valueOf(c, r) ?? <span className="text-muted">—</span>)}
                  </td>
                ))}
              </tr>
            ))}
            {!slice.length && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-sm">
          <button onClick={() => setPage(current - 1)} disabled={current === 0} className={buttonClass}>
            Previous
          </button>
          <span className="tabular-nums text-muted">
            {current + 1} / {pages}
          </span>
          <button onClick={() => setPage(current + 1)} disabled={current >= pages - 1} className={buttonClass}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
