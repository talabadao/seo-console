"use client";

import { Fragment, useState } from "react";
import { fmt } from "./format";

interface Stat {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface BrandKeywordRow extends Stat {
  query: string;
  status: "warning" | null;
  pages: (Stat & { url: string })[];
}

function path(u: string) {
  try {
    return new URL(u).pathname || "/";
  } catch {
    return u;
  }
}

function StatCells({ s }: { s: Stat }) {
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(s.clicks, "count")}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(s.impressions, "count")}</td>
      <td className="px-3 py-2 text-right tabular-nums">{s.position.toFixed(1)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{(s.ctr * 100).toFixed(1)}%</td>
    </>
  );
}

function StatusBadge() {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold"
      style={{
        color: "var(--position)",
        background: "color-mix(in srgb, var(--position) 18%, transparent)",
      }}
    >
      Warning
    </span>
  );
}

export function BrandingKeywordsTable({ rows }: { rows: BrandKeywordRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const warnCount = rows.filter((r) => r.status === "warning").length;

  return (
    <div className="rounded-xl border bg-surface">
      <div className="flex items-center gap-3 border-b px-4 py-2 text-sm text-muted">
        <span>{rows.length.toLocaleString()} branded keyword{rows.length === 1 ? "" : "s"}</span>
        {warnCount > 0 && (
          <span className="rounded bg-position/15 px-1.5 py-0.5 text-xs font-semibold text-position">
            {warnCount} warning{warnCount === 1 ? "" : "s"}
          </span>
        )}
        {!rows.length && (
          <span className="text-xs">
            No branded terms configured, or none are ranking yet — add terms in Settings → Query
            filters.
          </span>
        )}
      </div>
      <div className="max-h-[38rem] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-surface text-left text-muted">
            <tr className="border-b">
              <th className="px-3 py-2.5 font-medium">Keyword</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 text-right font-medium">Clicks</th>
              <th className="px-3 py-2.5 text-right font-medium">Impr</th>
              <th className="px-3 py-2.5 text-right font-medium">Position</th>
              <th className="px-3 py-2.5 text-right font-medium">CTR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.query}>
                <tr
                  className="cursor-pointer border-b border-border/60 hover:bg-accent-soft/40"
                  onClick={() => setOpen(open === r.query ? null : r.query)}
                >
                  <td className="px-3 py-2">
                    <span className="mr-1 text-muted">{open === r.query ? "▾" : "▸"}</span>
                    {r.query}
                  </td>
                  <td className="px-3 py-2">{r.status === "warning" && <StatusBadge />}</td>
                  <StatCells s={r} />
                </tr>
                {open === r.query && (
                  <>
                    <tr className="border-b border-border/40 bg-background/50 text-xs">
                      <td colSpan={6} className="px-3 pt-2 pb-1 font-semibold uppercase text-muted">
                        Ranking URL{r.pages.length === 1 ? "" : "s"} for this keyword
                      </td>
                    </tr>
                    {r.pages.map((p) => (
                      <tr key={p.url} className="border-b border-border/40 bg-background/50 text-xs">
                        <td className="max-w-xs truncate py-1.5 pr-2 pl-7">
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                            title={p.url}
                          >
                            {path(p.url)}
                          </a>
                        </td>
                        <td />
                        <StatCells s={p} />
                      </tr>
                    ))}
                  </>
                )}
              </Fragment>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  Nothing to show for this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
