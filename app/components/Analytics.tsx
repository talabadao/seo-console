"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { DateRangePicker, type RangeValue } from "./DateRangePicker";
import { resolveComparison, resolveRange } from "@/lib/dateRanges";
import { fmt, pctLabel } from "./format";
import { downloadCsv } from "./csv";

interface GaProperty {
  propertyId: string;
  displayName: string;
  accountName: string;
}

interface TrendRow {
  key: string;
  cur: number[];
  prev: number[];
  isNew: boolean;
}

interface MainData {
  range: { start: string; end: string };
  compareRange: { start: string; end: string } | null;
  currency: string | null;
  series: { bucket: string; label: string; organic: number; ai: number; other: number }[];
  prevSeries: MainData["series"] | null;
  totals: { organic: number; ai: number; other: number; sessions: number; keyEvents: number; revenue: number };
  prevTotals: MainData["totals"] | null;
  sourceMedium: TrendRow[];
  keyEvents: TrendRow[];
  sampled: boolean;
}

const INITIAL_RANGE: RangeValue = {
  preset: "28d",
  start: format(new Date(Date.now() - 28 * 86400000), "yyyy-MM-dd"),
  end: format(new Date(Date.now() - 86400000), "yyyy-MM-dd"),
  grain: "day",
  compareMode: "previous",
  matchWeekdays: false,
};

const COLORS = { organic: "var(--clicks)", ai: "var(--impressions)", other: "var(--muted)" } as const;

function money(n: number, currency: string | null): string {
  if (!isFinite(n)) return "–";
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? "currency" : "decimal",
      currency: currency || undefined,
      maximumFractionDigits: n >= 1000 ? 0 : 2,
    }).format(n);
  } catch {
    return n.toLocaleString();
  }
}

export function Analytics() {
  const [props, setProps] = useState<GaProperty[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [range, setRange] = useState<RangeValue>(INITIAL_RANGE);
  const [sub, setSub] = useState<"sourceMedium" | "keyEvents" | "geo">("sourceMedium");
  const [geoDim, setGeoDim] = useState<"country" | "city">("country");
  const [trend, setTrend] = useState<"all" | "growing" | "decaying" | "new">("all");
  const [q, setQ] = useState("");
  const [active, setActive] = useState<("organic" | "ai" | "other")[]>(["organic", "ai"]);
  const [data, setData] = useState<MainData | null>(null);
  const [geo, setGeo] = useState<{ dim: string; currency: string | null; rows: TrendRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [propsError, setPropsError] = useState<string | null>(null);
  const [propsLoaded, setPropsLoaded] = useState(false);

  const resolved = useMemo(() => {
    const r = resolveRange(range.preset, { customStart: range.start, customEnd: range.end });
    const c = resolveComparison(r, range.compareMode, { matchWeekdays: range.matchWeekdays });
    return { r, c };
  }, [range]);

  const qs = useCallback(
    (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams({
        propertyId,
        preset: range.preset,
        start: resolved.r.start,
        end: resolved.r.end,
        grain: range.grain,
        compare: range.compareMode,
        matchWeekdays: range.matchWeekdays ? "1" : "0",
        ...extra,
      });
      return p.toString();
    },
    [propertyId, range, resolved],
  );

  const loadProps = useCallback(async () => {
    const res = await fetch("/api/ga/properties");
    const j = await res.json();
    setPropsLoaded(true);
    if (j.needsReconnect) {
      setNeedsReconnect(true);
      return;
    }
    setPropsError(j.refreshError ?? null);
    setProps(j.properties ?? []);
    setPropertyId((cur) =>
      cur && (j.properties ?? []).some((p: GaProperty) => p.propertyId === cur)
        ? cur
        : (j.properties?.[0]?.propertyId ?? ""),
    );
  }, []);

  useEffect(() => {
    loadProps();
  }, [loadProps]);

  const loadMain = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/ga/report?${qs()}`);
      const j = await res.json();
      if (j.needsReconnect) setNeedsReconnect(true);
      else if (j.error) setErr(j.error);
      else setData(j);
    } finally {
      setLoading(false);
    }
  }, [propertyId, qs]);

  useEffect(() => {
    loadMain();
  }, [loadMain]);

  const loadGeo = useCallback(async () => {
    if (!propertyId || sub !== "geo") return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ga/report?${qs({ kind: "geo", geoDim })}`);
      const j = await res.json();
      if (!j.error && !j.needsReconnect) setGeo(j);
    } finally {
      setLoading(false);
    }
  }, [propertyId, sub, geoDim, qs]);

  useEffect(() => {
    loadGeo();
  }, [loadGeo]);

  const compareOn = range.compareMode !== "none";

  if (needsReconnect) {
    return (
      <div className="rounded-xl border border-bad/40 bg-bad/10 p-6 text-sm">
        <p className="font-medium">Google Analytics isn&apos;t connected yet.</p>
        <p className="mt-1 text-muted">
          Your Google sign-in needs the Analytics read permission. Enable the{" "}
          <strong>Google Analytics Admin API</strong> and <strong>Data API</strong> in Google
          Cloud, then reconnect.
        </p>
        <a
          href="/api/auth/google"
          className="mt-3 inline-block rounded-md bg-accent px-4 py-2 font-medium text-white"
        >
          Connect Google Analytics
        </a>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className="max-w-xs rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          {!props.length && <option value="">No GA4 properties</option>}
          {props.map((p) => (
            <option key={p.propertyId} value={p.propertyId}>
              {p.accountName ? `${p.accountName} · ` : ""}
              {p.displayName}
            </option>
          ))}
        </select>
        <DateRangePicker
          value={range}
          resolvedRange={resolved.r}
          resolvedCompare={resolved.c}
          onChange={setRange}
        />
        {loading && <span className="text-xs text-muted">Loading…</span>}
        {data?.sampled && (
          <span className="rounded bg-position/15 px-2 py-0.5 text-xs text-position">
            sampled
          </span>
        )}
        <span className="ml-auto text-xs text-muted">
          {data ? `${data.range.start} → ${data.range.end}` : ""}
        </span>
      </div>

      {err && (
        <div className="mb-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{err}</div>
      )}
      {propsError && (
        <div className="mb-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          Couldn&apos;t list Google Analytics properties: {propsError}
        </div>
      )}
      {propsLoaded && !propsError && !props.length && (
        <div className="mb-4 rounded-lg border bg-surface p-3 text-sm text-muted">
          No GA4 properties found for this Google account. Confirm you signed in with the
          account that has access to your GA4 properties (Admin → Property access
          management), and that it&apos;s at least a <strong>Viewer</strong> on the property.
        </div>
      )}

      {/* metric cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Organic Search sessions"
          color={COLORS.organic}
          value={fmt(data?.totals.organic ?? 0, "count")}
          delta={cardDelta(data?.totals.organic, data?.prevTotals?.organic)}
          on={active.includes("organic")}
          onClick={() => toggle("organic")}
        />
        <Card
          label="AI Search sessions"
          color={COLORS.ai}
          value={fmt(data?.totals.ai ?? 0, "count")}
          delta={cardDelta(data?.totals.ai, data?.prevTotals?.ai)}
          on={active.includes("ai")}
          onClick={() => toggle("ai")}
        />
        <Card
          label="Key events"
          color="var(--good)"
          value={fmt(data?.totals.keyEvents ?? 0, "count")}
          delta={cardDelta(data?.totals.keyEvents, data?.prevTotals?.keyEvents)}
        />
        <Card
          label="Revenue"
          color="var(--position)"
          value={money(data?.totals.revenue ?? 0, data?.currency ?? null)}
          delta={cardDelta(data?.totals.revenue, data?.prevTotals?.revenue)}
        />
      </div>

      {/* sessions chart */}
      <div className="rounded-xl border bg-surface p-4">
        <SessionsChart
          series={data?.series ?? []}
          prevSeries={compareOn ? (data?.prevSeries ?? null) : null}
          active={active}
        />
        <div className="mt-1 flex gap-4 px-2 text-xs">
          {(["organic", "ai", "other"] as const).map((k) => (
            <button
              key={k}
              onClick={() => toggle(k)}
              className={`flex items-center gap-1.5 ${active.includes(k) ? "" : "opacity-40"}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: COLORS[k] }} />
              {k === "ai" ? "AI Search" : k === "organic" ? "Organic Search" : "Other"}
            </button>
          ))}
        </div>
      </div>

      {/* sub-views */}
      <div className="mt-6 rounded-xl border bg-surface">
        <div className="flex flex-wrap items-center gap-1 border-b px-2 pt-2">
          {(
            [
              ["sourceMedium", "Source / Medium"],
              ["keyEvents", "Key Events"],
              ["geo", "Geo"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSub(id)}
              className={`rounded-t-md px-3 py-2 text-sm font-medium ${
                sub === id ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
          {sub === "geo" && (
            <div className="ml-2 flex rounded-md border p-0.5 text-xs">
              {(["country", "city"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setGeoDim(d)}
                  className={`rounded px-2 py-1 capitalize ${
                    geoDim === d ? "bg-accent text-white" : "text-muted"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        {sub === "sourceMedium" && (
          <TrendTable
            keyLabel="Source / Medium"
            metrics={[
              { label: "Sessions", kind: "count" },
              { label: "Revenue", kind: "money" },
              { label: "Key events", kind: "count" },
            ]}
            rows={data?.sourceMedium ?? []}
            currency={data?.currency ?? null}
            compareOn={compareOn}
            trend={trend}
            onTrend={setTrend}
            q={q}
            onQ={setQ}
            csvName="ga-source-medium"
          />
        )}

        {sub === "keyEvents" && (
          <KeyEventsTable
            rows={data?.keyEvents ?? []}
            currency={data?.currency ?? null}
            compareOn={compareOn}
            trend={trend}
            onTrend={setTrend}
            q={q}
            onQ={setQ}
            qs={qs}
          />
        )}

        {sub === "geo" && (
          <TrendTable
            keyLabel={geoDim === "city" ? "City" : "Country"}
            metrics={[
              { label: "Sessions", kind: "count" },
              { label: "Revenue", kind: "money" },
              { label: "Key events", kind: "count" },
            ]}
            rows={geo?.rows ?? []}
            currency={geo?.currency ?? null}
            compareOn={compareOn}
            trend={trend}
            onTrend={setTrend}
            q={q}
            onQ={setQ}
            csvName={`ga-${geoDim}`}
          />
        )}
      </div>
    </div>
  );

  function toggle(k: "organic" | "ai" | "other") {
    setActive((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  }
}

function cardDelta(cur?: number, prev?: number) {
  if (cur == null || prev == null || !prev) return null;
  return ((cur - prev) / prev) * 100;
}

function Card({
  label,
  color,
  value,
  delta,
  on,
  onClick,
}: {
  label: string;
  color: string;
  value: string;
  delta: number | null;
  on?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        onClick ? (on ? "bg-surface shadow-sm" : "bg-background opacity-70 hover:opacity-100") : "bg-surface"
      }`}
      style={on ? { borderColor: color } : undefined}
    >
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {delta != null && (
        <div
          className="mt-0.5 text-xs font-medium"
          style={{ color: delta >= 0 ? "var(--good)" : "var(--bad)" }}
        >
          {pctLabel(delta)} vs previous
        </div>
      )}
    </Tag>
  );
}

function SessionsChart({
  series,
  prevSeries,
  active,
}: {
  series: MainData["series"];
  prevSeries: MainData["series"] | null;
  active: ("organic" | "ai" | "other")[];
}) {
  if (!series.length)
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted">No data.</div>
    );
  const rows = series.map((pt, i) => ({
    ...pt,
    ...(prevSeries?.[i]
      ? {
          prev_organic: prevSeries[i].organic,
          prev_ai: prevSeries[i].ai,
          prev_other: prevSeries[i].other,
        }
      : {}),
  }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted)" }} minTickGap={28} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} width={44} />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 13,
            }}
          />
          {active.map((k) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              name={k === "ai" ? "AI Search" : k === "organic" ? "Organic Search" : "Other"}
              stroke={COLORS[k]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
          {prevSeries
            ? active.map((k) => (
                <Line
                  key={`p_${k}`}
                  type="monotone"
                  dataKey={`prev_${k}`}
                  name={`${k} (prev)`}
                  stroke={COLORS[k]}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))
            : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- generic trend table ----------

type MetricKind = "count" | "money" | "pct";
interface MetricSpec {
  label: string;
  kind: MetricKind;
}

function fmtMetric(v: number, kind: MetricKind, currency: string | null): string {
  if (kind === "money") return money(v, currency);
  if (kind === "pct") return `${(v * 100).toFixed(1)}%`;
  return fmt(v, "count");
}

function trendFilter(rows: TrendRow[], trend: string, q: string): TrendRow[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (needle && !r.key.toLowerCase().includes(needle)) return false;
    const d = (r.cur[0] ?? 0) - (r.prev[0] ?? 0);
    if (trend === "growing" && d <= 0) return false;
    if (trend === "decaying" && d >= 0) return false;
    if (trend === "new" && !r.isNew) return false;
    return true;
  });
}

function TrendTable({
  keyLabel,
  metrics,
  rows,
  currency,
  compareOn,
  trend,
  onTrend,
  q,
  onQ,
  csvName,
}: {
  keyLabel: string;
  metrics: MetricSpec[];
  rows: TrendRow[];
  currency: string | null;
  compareOn: boolean;
  trend: "all" | "growing" | "decaying" | "new";
  onTrend: (t: "all" | "growing" | "decaying" | "new") => void;
  q: string;
  onQ: (s: string) => void;
  csvName: string;
}) {
  const [limit, setLimit] = useState(50);
  const filtered = useMemo(() => trendFilter(rows, trend, q), [rows, trend, q]);
  const shown = filtered.slice(0, limit);

  return (
    <div>
      <TableToolbar
        trend={trend}
        onTrend={onTrend}
        q={q}
        onQ={onQ}
        count={filtered.length}
        limit={limit}
        onLimit={setLimit}
        onExport={() =>
          downloadCsv(`${csvName}-${new Date().toISOString().slice(0, 10)}.csv`, [
            [keyLabel, ...metrics.map((m) => m.label)],
            ...filtered.map((r) => [r.key, ...r.cur.map((v, i) =>
              metrics[i].kind === "money" ? v.toFixed(2) : String(v),
            )]),
          ])
        }
      />
      <div className="max-h-[34rem] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-left text-muted">
            <tr className="border-b">
              <th className="px-4 py-2.5 font-medium">{keyLabel}</th>
              {metrics.map((m) => (
                <th key={m.label} className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-b border-border/60 hover:bg-accent-soft/40">
                <td className="max-w-md truncate px-4 py-2" title={r.key}>
                  {r.key || <span className="text-muted">(not set)</span>}
                  {r.isNew && (
                    <span className="ml-1.5 rounded bg-good/15 px-1 text-[10px] font-semibold text-good">
                      NEW
                    </span>
                  )}
                </td>
                {metrics.map((m, i) => (
                  <td key={m.label} className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    {fmtMetric(r.cur[i] ?? 0, m.kind, currency)}
                    {compareOn && <Delta cur={r.cur[i] ?? 0} prev={r.prev[i] ?? 0} />}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={metrics.length + 1} className="px-4 py-10 text-center text-muted">
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KeyEventsTable({
  rows,
  currency,
  compareOn,
  trend,
  onTrend,
  q,
  onQ,
  qs,
}: {
  rows: TrendRow[];
  currency: string | null;
  compareOn: boolean;
  trend: "all" | "growing" | "decaying" | "new";
  onTrend: (t: "all" | "growing" | "decaying" | "new") => void;
  q: string;
  onQ: (s: string) => void;
  qs: (extra?: Record<string, string>) => string;
}) {
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<string | null>(null);
  const filtered = useMemo(() => trendFilter(rows, trend, q), [rows, trend, q]);
  const shown = filtered.slice(0, limit);

  return (
    <div>
      <TableToolbar
        trend={trend}
        onTrend={onTrend}
        q={q}
        onQ={onQ}
        count={filtered.length}
        limit={limit}
        onLimit={setLimit}
        onExport={() =>
          downloadCsv(`ga-key-events-${new Date().toISOString().slice(0, 10)}.csv`, [
            ["Key event", "Count", "Revenue", "Event value"],
            ...filtered.map((r) => [r.key, String(r.cur[0] ?? 0), (r.cur[1] ?? 0).toFixed(2), (r.cur[2] ?? 0).toFixed(2)]),
          ])
        }
      />
      <div className="max-h-[34rem] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-left text-muted">
            <tr className="border-b">
              <th className="px-4 py-2.5 font-medium">Key event</th>
              <th className="px-4 py-2.5 text-right font-medium">Count</th>
              <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
              <th className="px-4 py-2.5 text-right font-medium">Event value</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Fragment key={r.key}>
                <tr
                  className="cursor-pointer border-b border-border/60 hover:bg-accent-soft/40"
                  onClick={() => setOpen(open === r.key ? null : r.key)}
                >
                  <td className="px-4 py-2">
                    <span className="mr-1 text-muted">{open === r.key ? "▾" : "▸"}</span>
                    {r.key}
                    {r.isNew && (
                      <span className="ml-1.5 rounded bg-good/15 px-1 text-[10px] font-semibold text-good">
                        NEW
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmt(r.cur[0] ?? 0, "count")}
                    {compareOn && <Delta cur={r.cur[0] ?? 0} prev={r.prev[0] ?? 0} />}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {money(r.cur[1] ?? 0, currency)}
                    {compareOn && <Delta cur={r.cur[1] ?? 0} prev={r.prev[1] ?? 0} />}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(r.cur[2] ?? 0, currency)}</td>
                </tr>
                {open === r.key && (
                  <tr className="border-b border-border/60 bg-background/50">
                    <td colSpan={4} className="px-6 py-3">
                      <div className="grid gap-4 lg:grid-cols-3">
                        <Drill title="By referral page" by="referrer" eventName={r.key} currency={currency} qs={qs} />
                        <Drill title="By landing page (+ string)" by="landing" eventName={r.key} currency={currency} qs={qs} />
                        <Drill title="By page path (+ string)" by="pagePath" eventName={r.key} currency={currency} qs={qs} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted">
                  No key events. Mark events as key events in GA4 Admin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Drill({
  title,
  by,
  eventName,
  currency,
  qs,
}: {
  title: string;
  by: "referrer" | "landing" | "pagePath";
  eventName: string;
  currency: string | null;
  qs: (extra?: Record<string, string>) => string;
}) {
  const [rows, setRows] = useState<TrendRow[] | null>(null);
  useEffect(() => {
    let ignore = false;
    fetch(`/api/ga/key-event-drill?${qs({ by, eventName })}`)
      .then((r) => r.json())
      .then((j) => !ignore && setRows(j.rows ?? []));
    return () => {
      ignore = true;
    };
  }, [by, eventName, qs]);

  return (
    <div className="rounded-lg border bg-surface">
      <div className="border-b px-3 py-1.5 text-xs font-semibold uppercase text-muted">{title}</div>
      <div className="max-h-64 overflow-auto">
        {rows === null && <p className="px-3 py-3 text-xs text-muted">Loading…</p>}
        {rows?.slice(0, 50).map((r) => (
          <div key={r.key} className="flex items-center gap-2 border-b border-border/40 px-3 py-1 text-xs">
            <span className="flex-1 truncate" title={r.key}>
              {r.key || "(not set)"}
            </span>
            <span className="tabular-nums">{fmt(r.cur[0] ?? 0, "count")}</span>
            {(r.cur[1] ?? 0) > 0 && (
              <span className="w-16 text-right tabular-nums text-muted">{money(r.cur[1], currency)}</span>
            )}
          </div>
        ))}
        {rows?.length === 0 && <p className="px-3 py-3 text-xs text-muted">Nothing.</p>}
      </div>
    </div>
  );
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return cur > 0 ? <span className="ml-1 text-[11px] text-good">new</span> : null;
  const pc = ((cur - prev) / prev) * 100;
  if (Math.abs(pc) < 0.5) return <span className="ml-1 text-[11px] text-muted">0%</span>;
  return (
    <span
      className="ml-1 text-[11px]"
      style={{ color: pc > 0 ? "var(--good)" : "var(--bad)" }}
    >
      {pc > 0 ? "↑" : "↓"}
      {Math.abs(pc) >= 999 ? "∞+" : Math.abs(pc).toFixed(0)}%
    </span>
  );
}

function TableToolbar({
  trend,
  onTrend,
  q,
  onQ,
  count,
  limit,
  onLimit,
  onExport,
}: {
  trend: "all" | "growing" | "decaying" | "new";
  onTrend: (t: "all" | "growing" | "decaying" | "new") => void;
  q: string;
  onQ: (s: string) => void;
  count: number;
  limit: number;
  onLimit: (n: number) => void;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <div className="flex rounded-md border p-0.5 text-xs">
        {(
          [
            ["all", "All"],
            ["growing", "Growing"],
            ["decaying", "Decaying"],
            ["new", "New"],
          ] as const
        ).map(([t, l]) => (
          <button
            key={t}
            onClick={() => onTrend(t)}
            className={`rounded px-2 py-1 ${trend === t ? "bg-accent text-white" : "text-muted"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <input
        value={q}
        onChange={(e) => onQ(e.target.value)}
        placeholder="Filter…"
        className="min-w-40 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
      />
      <span className="text-sm text-muted">{count.toLocaleString()} rows</span>
      <select
        value={limit}
        onChange={(e) => onLimit(Number(e.target.value))}
        className="rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        {[25, 50, 100, 250, 1000].map((n) => (
          <option key={n} value={n}>
            Show {n}
          </option>
        ))}
      </select>
      <button
        onClick={onExport}
        className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent-soft"
      >
        Export CSV
      </button>
    </div>
  );
}
