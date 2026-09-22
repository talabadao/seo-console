"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { DateRangePicker, type RangeValue } from "./DateRangePicker";
import { resolveRange } from "@/lib/dateRanges";
import { fmt, pctLabel } from "./format";
import { BrandingKeywordsTable, type BrandKeywordRow } from "./BrandingKeywordsTable";

type Kind =
  | "cannibalization"
  | "keyword-topics"
  | "low-hanging"
  | "underperforming"
  | "branding-keywords";

const INITIAL_RANGE: RangeValue = {
  preset: "3m",
  start: format(new Date(Date.now() - 90 * 86400000), "yyyy-MM-dd"),
  end: format(new Date(Date.now() - 86400000), "yyyy-MM-dd"),
  grain: "day",
  compareMode: "none",
  matchWeekdays: false,
};

const TABS: { id: Kind; label: string; blurb: string }[] = [
  {
    id: "cannibalization",
    label: "Keyword Cannibalization",
    blurb:
      "Non-brand queries where 2+ of your URLs compete, grouped into topics by shared top-ranking page — the keyword with the most impressions in each group is the Parent Keyword. Severity is each topic's clicks as a share of the property's total clicks: Critical >10%, Warning >5%, Low <5%. Consolidate or differentiate them. (Brand terms are excluded — edit them in Settings.)",
  },
  {
    id: "keyword-topics",
    label: "Parent Keywords",
    blurb:
      "Every non-brand query grouped by the page it ranks best for, with the highest-impression keyword in each group standing in as the Parent Keyword — a topical view of what each page is really ranking for.",
  },
  {
    id: "low-hanging",
    label: "Low-hanging Fruit",
    blurb:
      "Queries ranking 4–10 with lots of impressions but a weak click-through rate, grouped into topics by shared top-ranking page — the keyword with the most impressions in each group is the Parent Keyword.",
  },
  {
    id: "underperforming",
    label: "Underperforming Pages",
    blurb:
      "Pages that used to earn real traffic and have since dropped materially — vs. the previous window or the same window last year — where the loss is a meaningful share of the site's clicks or more than the per-month threshold.",
  },
  {
    id: "branding-keywords",
    label: "Branding Keywords",
    blurb:
      "Ranking check for your own brand terms (Settings → Query filters). Position 1–2 is healthy; anything past that is flagged as a warning, since a branded search landing you below the top couple of results is usually worth investigating. Click a keyword to see which URL is ranking for it.",
  },
];

export function Opportunities({
  property,
  searchType,
}: {
  property: string;
  searchType: string;
}) {
  const [kind, setKind] = useState<Kind>("cannibalization");
  const [range, setRange] = useState<RangeValue>(INITIAL_RANGE);
  const [posFrom, setPosFrom] = useState(4);
  const [posTo, setPosTo] = useState(10);
  const [minImpr, setMinImpr] = useState(100);
  const [months, setMonths] = useState(2);
  const [minBaseline, setMinBaseline] = useState(20);
  const [sharePct, setSharePct] = useState(0.5);
  const [perMonth, setPerMonth] = useState(100);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolved = useMemo(
    () => resolveRange(range.preset, { customStart: range.start, customEnd: range.end }),
    [range],
  );

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    setErr(null);
    const p = new URLSearchParams({
      property,
      searchType,
      preset: range.preset,
      start: resolved.start,
      end: resolved.end,
    });
    if (kind === "low-hanging") {
      p.set("posFrom", String(posFrom));
      p.set("posTo", String(posTo));
      p.set("minImpr", String(minImpr));
    }
    if (kind === "underperforming") {
      p.set("months", String(months));
      p.set("minBaseline", String(minBaseline));
      p.set("sharePct", String(sharePct));
      p.set("perMonth", String(perMonth));
    }
    try {
      const res = await fetch(`/api/opportunities/${kind}?${p}`);
      const j = await res.json();
      if (res.ok) setData(j);
      else setErr(j.error ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [
    property,
    searchType,
    kind,
    resolved,
    range.preset,
    posFrom,
    posTo,
    minImpr,
    months,
    minBaseline,
    sharePct,
    perMonth,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const active = TABS.find((t) => t.id === kind)!;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setKind(t.id);
              setData(null);
            }}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              kind === t.id
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangePicker
          value={range}
          resolvedRange={resolved}
          resolvedCompare={null}
          onChange={setRange}
          simple
        />
        {kind === "low-hanging" && (
          <div className="flex items-center gap-2 rounded-md border bg-surface px-3 py-1.5 text-sm">
            <span className="text-muted">Position</span>
            <input
              type="number"
              value={posFrom}
              onChange={(e) => setPosFrom(Number(e.target.value))}
              className="w-14 rounded border bg-background px-1.5 py-0.5"
            />
            <span className="text-muted">to</span>
            <input
              type="number"
              value={posTo}
              onChange={(e) => setPosTo(Number(e.target.value))}
              className="w-14 rounded border bg-background px-1.5 py-0.5"
            />
            <span className="ml-2 text-muted">min impr</span>
            <input
              type="number"
              value={minImpr}
              onChange={(e) => setMinImpr(Number(e.target.value))}
              className="w-20 rounded border bg-background px-1.5 py-0.5"
            />
          </div>
        )}
        {kind === "underperforming" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-surface px-3 py-1.5 text-sm">
            <span className="flex items-center gap-1">
              <span className="text-muted">Window</span>
              <input
                type="number"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                className="w-12 rounded border bg-background px-1.5 py-0.5"
              />
              <span className="text-muted">mo</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-muted">had ≥</span>
              <input
                type="number"
                value={minBaseline}
                onChange={(e) => setMinBaseline(Number(e.target.value))}
                className="w-14 rounded border bg-background px-1.5 py-0.5"
              />
              <span className="text-muted">clicks</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-muted">lost ≥</span>
              <input
                type="number"
                step="0.1"
                value={sharePct}
                onChange={(e) => setSharePct(Number(e.target.value))}
                className="w-14 rounded border bg-background px-1.5 py-0.5"
              />
              <span className="text-muted">% of site</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-muted">or ≥</span>
              <input
                type="number"
                value={perMonth}
                onChange={(e) => setPerMonth(Number(e.target.value))}
                className="w-16 rounded border bg-background px-1.5 py-0.5"
              />
              <span className="text-muted">clicks/mo</span>
            </span>
          </div>
        )}
        {loading && <span className="text-xs text-muted">Loading…</span>}
      </div>

      <p className="mb-4 rounded-lg border bg-surface p-3 text-sm text-muted">{active.blurb}</p>

      {err && (
        <div className="mb-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{err}</div>
      )}

      {kind === "cannibalization" && (
        <CannibalTable rows={(data?.rows as CannibalTopicRow[]) ?? []} />
      )}
      {kind === "keyword-topics" && (
        <KeywordTopicsTable rows={(data?.rows as KeywordTopicRow[]) ?? []} />
      )}
      {kind === "low-hanging" && (
        <LowHangingTable rows={(data?.rows as LowHangingTopicRow[]) ?? []} />
      )}
      {kind === "underperforming" && (
        <UnderperformingTable rows={(data?.rows as UnderRow[]) ?? []} months={months} />
      )}
      {kind === "branding-keywords" && (
        <BrandingKeywordsTable rows={(data?.rows as BrandKeywordRow[]) ?? []} />
      )}
    </div>
  );
}

// ---------- shared ----------

interface Stat {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
interface CannibalRow extends Stat {
  query: string;
  pageCount: number;
  pages: (Stat & { url: string })[];
}
type CannibalSeverity = "critical" | "warning" | "low";
interface CannibalTopicRow extends Stat {
  parentQuery: string;
  topUrl: string;
  keywordCount: number;
  pageCount: number;
  clicksSharePct: number;
  severity: CannibalSeverity;
  keywords: CannibalRow[];
}
interface KeywordTopicRow extends Stat {
  parentQuery: string;
  url: string;
  keywordCount: number;
  keywords: (Stat & { query: string })[];
}
interface LowHangingRow extends Stat {
  query: string;
  expectedCtr: number;
  ctrGap: number;
  pages: (Stat & { url: string })[];
}
interface LowHangingTopicRow extends Stat {
  parentQuery: string;
  topUrl: string;
  keywordCount: number;
  expectedCtr: number;
  ctrGap: number;
  keywords: LowHangingRow[];
}
interface UnderRow {
  url: string;
  clicks: number;
  clicksPrev: number;
  clicksYoY: number;
  deltaPrev: number;
  deltaYoY: number;
  lostClicks: number;
  lostPerMonth: number;
  siteSharePct: number;
  top10Now: number;
  top10Prev: number;
  top10Delta: number;
  status: "critical" | "warning" | "ok";
}

function deltaColor(n: number): string {
  if (n > 0.05) return "var(--good)";
  if (n < -0.05) return "var(--bad)";
  return "var(--muted)";
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

function Shell({ children, count }: { children: ReactNode; count: number }) {
  return (
    <div className="rounded-xl border bg-surface">
      <div className="border-b px-4 py-2 text-sm text-muted">{count.toLocaleString()} rows</div>
      <div className="max-h-[38rem] overflow-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    </div>
  );
}

// ---------- cannibalization ----------

function CannibalTable({ rows }: { rows: CannibalTopicRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Shell count={rows.length}>
      <thead className="sticky top-0 bg-surface text-left text-muted">
        <tr className="border-b">
          <th className="px-3 py-2.5 font-medium">Parent Keyword</th>
          <th className="px-3 py-2.5 font-medium">Severity</th>
          <th className="px-3 py-2.5 text-right font-medium">Keywords</th>
          <th className="px-3 py-2.5 text-right font-medium">Pages</th>
          <th className="px-3 py-2.5 text-right font-medium">Clicks</th>
          <th className="px-3 py-2.5 text-right font-medium">Impr</th>
          <th className="px-3 py-2.5 text-right font-medium">Position</th>
          <th className="px-3 py-2.5 text-right font-medium">CTR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.topUrl}>
            <tr
              className="cursor-pointer border-b border-border/60 hover:bg-accent-soft/40"
              onClick={() => setOpen(open === r.topUrl ? null : r.topUrl)}
            >
              <td className="px-3 py-2">
                <span className="mr-1 text-muted">{open === r.topUrl ? "▾" : "▸"}</span>
                {r.parentQuery}
              </td>
              <td className="px-3 py-2">
                <SeverityBadge severity={r.severity} sharePct={r.clicksSharePct} />
              </td>
              <td className="px-3 py-2 text-right font-medium">{r.keywordCount}</td>
              <td className="px-3 py-2 text-right font-medium">{r.pageCount}</td>
              <StatCells s={r} />
            </tr>
            {open === r.topUrl && (
              <tr className="border-b border-border/50 bg-background/50">
                <td colSpan={8} className="px-3 py-3">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase text-muted">
                        Keywords in this topic
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {r.keywords.map((k) => (
                            <tr key={k.query} className="border-b border-border/40">
                              <td className="max-w-[14rem] truncate py-1 pr-2" title={k.query}>
                                {k.query}
                                {k.query === r.parentQuery && (
                                  <span className="ml-1.5 rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">
                                    PARENT
                                  </span>
                                )}
                              </td>
                              <StatCells s={k} />
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase text-muted">
                        Competing pages (parent keyword)
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {(r.keywords[0]?.pages ?? []).map((p) => (
                            <tr key={p.url} className="border-b border-border/40">
                              <td className="max-w-[14rem] truncate py-1 pr-2">
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
                              <StatCells s={p} />
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        {!rows.length && <EmptyRow cols={8} />}
      </tbody>
    </Shell>
  );
}

const SEVERITY_META: Record<CannibalSeverity, { label: string; color: string; bg: string }> = {
  critical: { label: "Critical", color: "var(--bad)", bg: "color-mix(in srgb, var(--bad) 15%, transparent)" },
  warning: {
    label: "Warning",
    color: "var(--position)",
    bg: "color-mix(in srgb, var(--position) 18%, transparent)",
  },
  low: { label: "Low", color: "var(--good)", bg: "color-mix(in srgb, var(--good) 15%, transparent)" },
};

function SeverityBadge({ severity, sharePct }: { severity: CannibalSeverity; sharePct: number }) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold"
      style={{ color: meta.color, background: meta.bg }}
      title={`${sharePct.toFixed(1)}% of total clicks`}
    >
      {meta.label} <span className="font-normal opacity-80">({sharePct.toFixed(1)}%)</span>
    </span>
  );
}

// ---------- parent keywords ----------

function KeywordTopicsTable({ rows }: { rows: KeywordTopicRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Shell count={rows.length}>
      <thead className="sticky top-0 bg-surface text-left text-muted">
        <tr className="border-b">
          <th className="px-3 py-2.5 font-medium">Parent Keyword</th>
          <th className="px-3 py-2.5 text-right font-medium">Keywords</th>
          <th className="px-3 py-2.5 text-right font-medium">Clicks</th>
          <th className="px-3 py-2.5 text-right font-medium">Impr</th>
          <th className="px-3 py-2.5 text-right font-medium">Position</th>
          <th className="px-3 py-2.5 text-right font-medium">CTR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.url}>
            <tr
              className="cursor-pointer border-b border-border/60 hover:bg-accent-soft/40"
              onClick={() => setOpen(open === r.url ? null : r.url)}
            >
              <td className="px-3 py-2">
                <span className="mr-1 text-muted">{open === r.url ? "▾" : "▸"}</span>
                {r.parentQuery}
              </td>
              <td className="px-3 py-2 text-right font-medium">{r.keywordCount}</td>
              <StatCells s={r} />
            </tr>
            {open === r.url && (
              <tr className="border-b border-border/50 bg-background/50 text-xs">
                <td colSpan={6} className="px-3 py-3">
                  <div className="mb-1 text-xs font-semibold uppercase text-muted">
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {path(r.url)}
                    </a>{" "}
                    — {r.keywordCount} keyword{r.keywordCount === 1 ? "" : "s"}
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {r.keywords.map((k) => (
                        <tr key={k.query} className="border-b border-border/40">
                          <td className="max-w-sm truncate py-1 pr-2" title={k.query}>
                            {k.query}
                            {k.query === r.parentQuery && (
                              <span className="ml-1.5 rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">
                                PARENT
                              </span>
                            )}
                          </td>
                          <StatCells s={k} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        {!rows.length && <EmptyRow cols={6} />}
      </tbody>
    </Shell>
  );
}

// ---------- low-hanging ----------

function LowHangingTable({ rows }: { rows: LowHangingTopicRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Shell count={rows.length}>
      <thead className="sticky top-0 bg-surface text-left text-muted">
        <tr className="border-b">
          <th className="px-3 py-2.5 font-medium">Parent Keyword</th>
          <th className="px-3 py-2.5 text-right font-medium">Keywords</th>
          <th className="px-3 py-2.5 text-right font-medium">Clicks</th>
          <th className="px-3 py-2.5 text-right font-medium">Impr</th>
          <th className="px-3 py-2.5 text-right font-medium">Position</th>
          <th className="px-3 py-2.5 text-right font-medium">CTR</th>
          <th className="px-3 py-2.5 text-right font-medium">Expected</th>
          <th className="px-3 py-2.5 text-right font-medium">Gap</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.topUrl}>
            <tr
              className="cursor-pointer border-b border-border/60 hover:bg-accent-soft/40"
              onClick={() => setOpen(open === r.topUrl ? null : r.topUrl)}
            >
              <td className="px-3 py-2">
                <span className="mr-1 text-muted">{open === r.topUrl ? "▾" : "▸"}</span>
                {r.parentQuery}
              </td>
              <td className="px-3 py-2 text-right font-medium">{r.keywordCount}</td>
              <StatCells s={r} />
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {(r.expectedCtr * 100).toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums text-good">
                +{(r.ctrGap * 100).toFixed(1)}%
              </td>
            </tr>
            {open === r.topUrl && (
              <tr className="border-b border-border/50 bg-background/50">
                <td colSpan={8} className="px-3 py-3">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase text-muted">
                        Keywords in this topic
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {r.keywords.map((k) => (
                            <tr key={k.query} className="border-b border-border/40">
                              <td className="max-w-[14rem] truncate py-1 pr-2" title={k.query}>
                                {k.query}
                                {k.query === r.parentQuery && (
                                  <span className="ml-1.5 rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">
                                    PARENT
                                  </span>
                                )}
                              </td>
                              <StatCells s={k} />
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase text-muted">
                        Pages (parent keyword)
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {(r.keywords[0]?.pages ?? []).map((p) => (
                            <tr key={p.url} className="border-b border-border/40">
                              <td className="max-w-[14rem] truncate py-1 pr-2">
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
                              <StatCells s={p} />
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        {!rows.length && <EmptyRow cols={8} />}
      </tbody>
    </Shell>
  );
}

// ---------- underperforming ----------

function UnderperformingTable({ rows, months }: { rows: UnderRow[]; months: number }) {
  return (
    <Shell count={rows.length}>
      <thead className="sticky top-0 bg-surface text-left text-muted">
        <tr className="border-b">
          <th className="px-3 py-2.5 font-medium">Page</th>
          <th className="px-3 py-2.5 text-right font-medium">Clicks last {months}mo</th>
          <th className="px-3 py-2.5 text-right font-medium">Lost clicks</th>
          <th className="px-3 py-2.5 text-right font-medium">vs prev {months}mo</th>
          <th className="px-3 py-2.5 text-right font-medium">vs YoY</th>
          <th className="px-3 py-2.5 text-right font-medium">Top-10 queries Δ</th>
          <th className="px-3 py-2.5 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.url} className="border-b border-border/60 hover:bg-accent-soft/40">
            <td className="max-w-sm truncate px-3 py-2">
              <a href={r.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                {path(r.url)}
              </a>
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{fmt(r.clicks, "count")}</td>
            <td className="px-3 py-2 text-right tabular-nums text-bad">
              −{fmt(r.lostClicks, "count")}
              <span className="text-muted">
                {" "}
                ({r.siteSharePct >= 0.1 ? `${r.siteSharePct.toFixed(1)}% of site` : `${Math.round(r.lostPerMonth)}/mo`})
              </span>
            </td>
            <td className="px-3 py-2 text-right tabular-nums" style={{ color: deltaColor(r.deltaPrev) }}>
              {pctLabel(r.deltaPrev)}{" "}
              <span className="text-muted">({fmt(r.clicksPrev, "count")})</span>
            </td>
            <td className="px-3 py-2 text-right tabular-nums" style={{ color: deltaColor(r.deltaYoY) }}>
              {pctLabel(r.deltaYoY)}{" "}
              <span className="text-muted">({fmt(r.clicksYoY, "count")})</span>
            </td>
            <td className="px-3 py-2 text-right tabular-nums" style={{ color: deltaColor(r.top10Delta) }}>
              {r.top10Delta === 0 ? "0" : r.top10Delta > 0 ? `+${r.top10Delta}` : r.top10Delta}
              <span className="text-muted"> ({r.top10Now})</span>
            </td>
            <td className="px-3 py-2">
              <span
                className="rounded px-1.5 py-0.5 text-xs font-semibold"
                style={{
                  color: r.status === "critical" ? "var(--bad)" : "var(--position)",
                  background:
                    r.status === "critical"
                      ? "color-mix(in srgb, var(--bad) 15%, transparent)"
                      : "color-mix(in srgb, var(--position) 18%, transparent)",
                }}
              >
                {r.status === "critical" ? "Critical" : "Warning"}
              </span>
            </td>
          </tr>
        ))}
        {!rows.length && <EmptyRow cols={7} />}
      </tbody>
    </Shell>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-10 text-center text-muted">
        Nothing found for this range.
      </td>
    </tr>
  );
}
