"use client";

// LLMs Traffic (GA4): identifiable AI-referral traffic. Definitions live in lib/v2/llm/report.ts and are
// repeated on screen next to the numbers they describe.

import { useEffect, useMemo, useState } from "react";
import { Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import type { Breakdown, Granularity, LlmMetric, LlmReport } from "@/lib/v2/llm/report";
import type { SectionState } from "@/lib/v2/summary/types";
import { usePeriodChoice } from "./summaryClient";
import { Delta, PeriodPicker, StateBadge, fmtInt, fmtTime } from "./summaryUi";
import { Card, buttonClass } from "./ui";
import { ProviderIcon } from "./ProviderIcon";
import { iconForPlatform } from "@/lib/providerIcons";

type Response =
  | { state: "live" | "demo"; report: LlmReport; cached?: boolean }
  | { state: Exclude<SectionState, "live" | "demo">; source?: string; message?: string };

/**
 * A platform's colour (it matches the chart series) and, for the five AI assistants with a supplied icon, the
 * provider icon. Decorative: the platform's name is always written next to it.
 */
function PlatformMark({ id, color, size = 20 }: { id: string; color: string; size?: number }) {
  const icon = iconForPlatform(id);
  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-hidden="true">
      {icon && <ProviderIcon id={icon} size={size} />}
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fmtDuration = (s: number | null) => {
  if (s == null) return "—";
  const t = Math.round(s);
  const m = Math.floor(t / 60);
  return m ? `${m}m ${t % 60}s` : `${t}s`;
};
const fmtRate = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);

export function LlmTrafficReport({ projectId }: { projectId: number }) {
  const [period, setPeriod] = usePeriodChoice();
  const [metric, setMetric] = useState<LlmMetric>("sessions");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [platform, setPlatform] = useState("all");
  const [nonce, setNonce] = useState(0);
  const key = `${projectId}|${period.preset}|${period.compare}|${metric}|${granularity}|${platform}|${nonce}`;
  const [res, setRes] = useState<{ key: string; value: Response | { state: "fetch-error"; message: string } } | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (refresh: boolean, polls: number) => {
      const q = new URLSearchParams({ preset: period.preset, compare: period.compare, metric, granularity, platform });
      if (refresh) q.set("refresh", "1");
      fetch(`/api/v2/llm-traffic/${projectId}?${q}`)
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
          if (!live) return;
          // First load still running on the server: keep the loading state and ask again (joins the same job).
          if (body.state === "pending" && polls < 40) {
            timer = setTimeout(() => load(false, polls + 1), 3000);
            return;
          }
          setRes({ key, value: body as Response });
        })
        .catch((e) => live && setRes({ key, value: { state: "fetch-error", message: e instanceof Error ? e.message : String(e) } }));
    };
    load(nonce > 0, 0);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [key, projectId, period.preset, period.compare, metric, granularity, platform, nonce]);

  const current = res?.key === key ? res.value : null;
  const report = current && "report" in current ? current.report : null;
  const demo = current?.state === "demo";

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodPicker value={period} onChange={setPeriod} />
      <div role="radiogroup" aria-label="Measure" className="inline-flex rounded-md border p-0.5 text-sm">
        {(
          [
            ["sessions", "Sessions"],
            ["users", "Users"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="radio"
            aria-checked={metric === id}
            onClick={() => setMetric(id)}
            className={`rounded px-3 py-1 ${metric === id ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <button className={buttonClass} onClick={() => setNonce((n) => n + 1)}>
        Refresh
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {controls}
      <div className="rounded-lg border bg-surface px-4 py-2 text-xs text-muted">
        <strong className="text-foreground">What this counts:</strong> sessions whose session source is on your AI search sources list (Settings) — the
        same list as the dashboard&apos;s AI sessions. Visits from AI answers that arrive without a referrer appear as Direct and aren&apos;t included.{" "}
        {metric === "users" ? (
          <>
            <strong className="text-foreground">Users</strong> are GA4 active users; each total is its own GA4 count, never a sum, because one person can
            arrive from several assistants.
          </>
        ) : (
          <>
            <strong className="text-foreground">Sessions</strong> are GA4 sessions (not page views).
          </>
        )}
        {report && (
          <>
            {" "}
            {report.period.label}
            {report.period.compareLabel ? ` vs ${report.period.compareLabel}` : ""}. Fetched {fmtTime(report.fetchedAt)}.
          </>
        )}
      </div>

      {demo && (
        <div role="note" className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm" style={{ borderColor: "var(--position)" }}>
          <StateBadge state="demo" />
          <p className="text-muted">
            <strong className="text-foreground">Demo data.</strong> Invented for illustration; no GA4 property is queried.
          </p>
        </div>
      )}

      {!current ? (
        <div role="status" className="rounded-xl border bg-surface p-6 text-sm text-muted">
          Loading LLMs Traffic…
        </div>
      ) : !report ? (
        <div role={current.state === "error" || current.state === "fetch-error" ? "alert" : undefined} className="rounded-xl border bg-surface p-6 text-sm">
          <StateBadge state={current.state === "fetch-error" ? "error" : current.state} />
          <p className="mt-2 text-muted">{"message" in current ? current.message : "Not available."}</p>
        </div>
      ) : (
        <Body
          report={report}
          granularity={granularity}
          setGranularity={setGranularity}
          platform={platform}
          setPlatform={setPlatform}
        />
      )}
    </div>
  );
}

function Body({
  report,
  granularity,
  setGranularity,
  platform,
  setPlatform,
}: {
  report: LlmReport;
  granularity: Granularity;
  setGranularity: (g: Granularity) => void;
  platform: string;
  setPlatform: (p: string) => void;
}) {
  const users = report.metric === "users";
  const chartData = useMemo(
    () => report.trend.buckets.map((b, i) => Object.fromEntries([["bucket", b], ...report.trend.series.map((s) => [s.name, s.values[i]])])),
    [report],
  );
  if (!report.platforms.length) {
    return (
      <Card>
        <p className="text-sm text-muted">No AI-referral sessions in this period for the sources on your list.</p>
      </Card>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border bg-surface p-4">
          <div className="text-xs text-muted">All AI platforms</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtInt(report.total.current)}</div>
          <Delta pair={report.total} />
          <div className="mt-1 text-[11px] text-muted">{users ? "Distinct users (own count)" : "Sessions"}</div>
        </div>
        {report.platforms.map((p) => (
          <div key={p.id} className="rounded-xl border bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <PlatformMark id={p.id} color={p.color} />
              <span className="truncate">{p.name}</span>
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtInt(p.value.current)}</div>
            <Delta pair={p.value} />
          </div>
        ))}
      </div>

      <div role="radiogroup" aria-label="Platform filter" className="flex flex-wrap gap-2">
        {[{ id: "all", name: "All", color: "var(--muted)" }, ...report.platforms].map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={platform === p.id}
            onClick={() => setPlatform(p.id)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${platform === p.id ? "border-accent bg-accent-soft text-accent" : "hover:bg-accent-soft/50"}`}
          >
            <PlatformMark id={p.id} color={p.color} size={16} />
            {p.name}
            {p.id !== "all" && report.share && (
              <span className="text-xs text-muted tabular-nums">{report.share.find((s) => s.id === p.id)?.pct.toFixed(1)}%</span>
            )}
          </button>
        ))}
      </div>
      <p className="-mt-2 text-xs text-muted">The filter applies to the trend and every breakdown below; the cards above always show all platforms.</p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          title={`AI referral ${users ? "users" : "sessions"} over time`}
          className="xl:col-span-2"
          actions={
            <div role="radiogroup" aria-label="Granularity" className="inline-flex rounded-md border p-0.5 text-xs">
              {(
                [
                  ["day", "Daily"],
                  ["week", "Weekly"],
                  ["month", "Monthly"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={granularity === id}
                  onClick={() => setGranularity(id)}
                  className={`rounded px-2 py-0.5 ${granularity === id ? "bg-foreground text-background" : "text-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} width={40} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {report.trend.series.map((s) => (
                  <Line key={s.id} type="monotone" dataKey={s.name} stroke={s.color} dot={false} strokeWidth={2} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {users && <p className="mt-2 text-xs text-muted">Each point is GA4&apos;s own user count for that {granularity} and platform.</p>}
        </Card>

        <Card title="Share of AI sessions">
          {report.share ? (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={report.share} dataKey="sessions" nameKey="name" innerRadius="60%" outerRadius="90%" isAnimationActive={false}>
                      {report.share.map((s) => (
                        <Cell key={s.id} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {report.share.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <PlatformMark id={s.id} color={s.color} />
                    <span className="flex-1">{s.name}</span>
                    <span className="tabular-nums text-muted">{s.pct < 1 ? "<1" : Math.round(s.pct)}%</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">
              Shown for sessions only. Users can arrive from more than one assistant, so per-platform user counts don&apos;t add up to a 100% share.
            </p>
          )}
        </Card>
      </div>

      <Card title="Engagement by platform">
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-2 py-2 font-medium">Platform</th>
                <th className="px-2 py-2 text-right font-medium">Sessions</th>
                <th className="px-2 py-2 text-right font-medium" title="Engaged sessions ÷ sessions">
                  Engagement rate
                </th>
                <th className="px-2 py-2 text-right font-medium" title="GA4 averageSessionDuration: wall-clock, includes idle time">
                  Avg. session duration
                </th>
                <th className="px-2 py-2 text-right font-medium" title="userEngagementDuration ÷ sessions: time the page was in the foreground">
                  Avg. engagement time
                </th>
                <th className="px-2 py-2 text-right font-medium">Pages / session</th>
                <th className="px-2 py-2 text-right font-medium" title="Share of sessions that weren't engaged">
                  Bounce rate
                </th>
              </tr>
            </thead>
            <tbody>
              {report.engagement.map((e) => (
                <tr key={e.id} className="border-t border-border/60">
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-2">
                      <PlatformMark id={e.id} color={e.color} size={18} />
                      {e.name}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtInt(e.sessions)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRate(e.engagementRate)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtDuration(e.avgSessionDuration)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtDuration(e.avgEngagementTimePerSession)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{e.pagesPerSession == null ? "—" : e.pagesPerSession.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRate(e.bounceRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Session-based, so it doesn&apos;t change with the Sessions / Users toggle. Platforms with several sources are weighted by sessions.</p>
      </Card>

      <Card title="Top landing pages">
        <div className="relative max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-xs text-muted">
                <th className="px-2 py-2 font-medium">Platform</th>
                <th className="px-2 py-2 font-medium">Landing page</th>
                <th className="px-2 py-2 text-right font-medium">Sessions</th>
                <th className="px-2 py-2 text-right font-medium">Avg. session duration</th>
                <th className="px-2 py-2 text-right font-medium">Bounce rate</th>
              </tr>
            </thead>
            <tbody>
              {report.landingPages.map((l) => (
                <tr key={`${l.platform.id}${l.page}`} className="border-t border-border/60">
                  <td className="whitespace-nowrap px-2 py-2">
                    <span className="inline-flex items-center gap-2">
                      <PlatformMark id={l.platform.id} color={l.platform.color} size={18} />
                      {l.platform.name}
                    </span>
                  </td>
                  <td className="max-w-[28rem] truncate px-2 py-2" title={l.page}>
                    {l.page}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtInt(l.sessions)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtDuration(l.avgSessionDuration)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRate(l.bounceRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">By sessions. &quot;(not set)&quot; is GA4&apos;s value when a session has no landing page recorded.</p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownCard title="Countries" b={report.countries} users={users} />
        <BreakdownCard title="Cities" b={report.cities} users={users} />
        <BreakdownCard title="Browsers" b={report.browsers} users={users} />
        <BreakdownCard title="Device categories" b={report.devices} users={users} />
      </div>

      <Heatmap report={report} />

      {report.sampled && <p className="text-xs" style={{ color: "var(--bad)" }}>GA4 sampled at least one of these queries; figures are estimates.</p>}
      <p className="text-xs text-muted">
        GA4 can withhold small rows (thresholding, when Google signals is on) and caps row counts, so a breakdown&apos;s rows can add up to less than its
        total. Totals aren&apos;t adjusted to match.
      </p>
    </>
  );
}

function BreakdownCard({ title, b, users }: { title: string; b: Breakdown; users: boolean }) {
  const [page, setPage] = useState(0);
  const per = 10;
  const rows = b.rows.slice(page * per, page * per + per);
  const max = Math.max(1, ...b.rows.map((r) => r.value));
  const shown = b.rows.reduce((a, r) => a + r.value, 0);
  return (
    <Card title={title} actions={<span className="text-xs text-muted">{b.rows.length} rows</span>}>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex justify-between gap-2 text-sm">
              <span className={r.key === "(not set)" ? "text-muted" : ""}>{r.key}</span>
              <span className="tabular-nums">
                {fmtInt(r.value)}
                {!users && b.total ? <span className="ml-2 text-xs text-muted">{Math.round((r.value / b.total) * 100)}%</span> : null}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border/70">
              <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: "var(--accent)" }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>
          {users
            ? `Total ${fmtInt(b.total)} users (own count). A user can appear in more than one row.`
            : `Total ${fmtInt(b.total)} sessions${shown < b.total ? `; rows shown add up to ${fmtInt(shown)}` : ""}.`}
        </span>
        {b.rows.length > per && (
          <span className="flex gap-1">
            <button className={buttonClass} disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous rows">
              ‹
            </button>
            <button className={buttonClass} disabled={(page + 1) * per >= b.rows.length} onClick={() => setPage(page + 1)} aria-label="Next rows">
              ›
            </button>
          </span>
        )}
      </div>
    </Card>
  );
}

function Heatmap({ report }: { report: LlmReport }) {
  const max = Math.max(1, ...report.heatmap.map((h) => h.value));
  const value = (d: number, h: number) => report.heatmap.find((x) => x.day === d && x.hour === h)?.value ?? 0;
  const byHour = Array.from({ length: 24 }, (_, h) => report.heatmap.filter((x) => x.hour === h).reduce((a, x) => a + x.value, 0));
  const byDay = Array.from({ length: 7 }, (_, d) => report.heatmap.filter((x) => x.day === d).reduce((a, x) => a + x.value, 0));
  const users = report.metric === "users";
  const busiestHour = byHour.indexOf(Math.max(...byHour));
  const busiestDay = byDay.indexOf(Math.max(...byDay));
  return (
    <Card title="When AI sends visitors">
      <p className="mb-3 text-xs text-muted">
        Day of week and hour in the GA4 property&apos;s timezone{report.timeZone ? ` (${report.timeZone})` : ""}.{" "}
        {!users && (
          <>
            Busiest hour {String(busiestHour).padStart(2, "0")}:00–{String((busiestHour + 1) % 24).padStart(2, "0")}:00, busiest day {DAYS[busiestDay]}.
          </>
        )}
        {users && "With Users selected, each cell is GA4's user count for that hour of that weekday."}
      </p>
      <div className="relative overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[10px]">
          <thead>
            <tr>
              <th />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="w-5 font-normal text-muted">
                  {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <tr key={d}>
                <th className="pr-1 text-right font-normal text-muted">{DAYS[d]}</th>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = value(d, h);
                  return (
                    <td
                      key={h}
                      title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 — ${v} ${users ? "users" : "sessions"}`}
                      className="h-5 w-5 rounded-sm"
                      style={{ background: v ? `color-mix(in srgb, var(--accent) ${Math.round(15 + (v / max) * 85)}%, transparent)` : "var(--border)" }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
