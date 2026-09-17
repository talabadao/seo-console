"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { fmtFull, pctLabel } from "./format";
import {
  buildAsanaBody,
  buildInsights,
  type AsanaTask,
  type DailyPoint,
  type GaProperty,
  type KpiCard as KpiCardData,
  type KpiConfig,
  type ReportData,
  type Section,
  type TaskBuckets,
} from "./insights";

const STATUS_OPTIONS: { value: "on_track" | "at_risk" | "off_track" | "on_hold"; label: string }[] = [
  { value: "on_track", label: "On track" },
  { value: "at_risk", label: "At risk" },
  { value: "off_track", label: "Off track" },
  { value: "on_hold", label: "On hold" },
];

const PACE_COLOR: Record<KpiCardData["pace"], string> = {
  "on-track": "var(--good)",
  "at-risk": "var(--position)",
  "off-track": "var(--bad)",
};
const PACE_LABEL: Record<KpiCardData["pace"], string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  "off-track": "Off track",
};

export function WeeklyReport() {
  const [props, setProps] = useState<GaProperty[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [sub, setSub] = useState<"overview" | "insights">("overview");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enableUrl, setEnableUrl] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [propsLoaded, setPropsLoaded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const loadProps = useCallback(async () => {
    const res = await fetch("/api/ga/properties");
    const j = await res.json();
    setPropsLoaded(true);
    if (j.needsReconnect) {
      setNeedsReconnect(true);
      return;
    }
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

  const loadReport = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setErr(null);
    setEnableUrl(null);
    try {
      const res = await fetch(`/api/weekly-report?propertyId=${encodeURIComponent(propertyId)}`);
      const j = await res.json();
      if (j.needsReconnect) setNeedsReconnect(true);
      else if (j.error) {
        setErr(j.error);
        setEnableUrl(j.enableUrl ?? null);
      } else setData(j);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

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

        <div className="flex rounded-md border p-0.5 text-sm">
          {(
            [
              ["overview", "Overview"],
              ["insights", "Insights"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSub(id)}
              className={`rounded px-3 py-1 font-medium ${
                sub === id ? "bg-accent text-white" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowConfig(true)}
          disabled={!data}
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent-soft disabled:opacity-50"
        >
          Configure KPIs
        </button>

        {loading && <span className="text-xs text-muted">Loading…</span>}
        {data && (
          <span className="ml-auto text-xs text-muted">
            {data.windows.monthStartLabel} → {data.windows.monthEndLabel}
          </span>
        )}
      </div>

      {err && <ErrorBanner message={err} enableUrl={enableUrl} onRetry={loadReport} />}
      {propsLoaded && !props.length && (
        <div className="mb-4 rounded-lg border bg-surface p-3 text-sm text-muted">
          No GA4 properties found for this Google account.
        </div>
      )}

      {data && sub === "overview" && <Overview data={data} />}
      {data && sub === "insights" && (
        <Insights
          data={data}
          propertyId={propertyId}
          propertyLabel={props.find((p) => p.propertyId === propertyId)?.displayName ?? ""}
        />
      )}

      {showConfig && data && (
        <ConfigModal
          propertyId={propertyId}
          config={data.config}
          availableEvents={data.availableEvents}
          onClose={() => setShowConfig(false)}
          onSaved={() => {
            setShowConfig(false);
            loadReport();
          }}
        />
      )}
    </div>
  );
}

function ErrorBanner({
  message,
  enableUrl,
  onRetry,
}: {
  message: string;
  enableUrl: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
      <span className="flex-1">{message}</span>
      {enableUrl && (
        <a
          href={enableUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-bad px-3 py-1.5 text-xs font-semibold text-white"
        >
          Enable in Google Cloud
        </a>
      )}
      <button onClick={onRetry} className="rounded-md border border-bad/40 px-3 py-1.5 text-xs font-medium">
        Retry
      </button>
    </div>
  );
}

// ---------- Overview ----------

function Overview({ data }: { data: ReportData }) {
  const w = data.windows;
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          title="Organic Traffic (Sessions)"
          startLabel={w.monthStartLabel}
          dueLabel={w.monthEndLabel}
          kpi={data.kpis.trafficOrganic}
        />
        <KpiTile
          title="AI Traffic (Sessions)"
          startLabel={w.monthStartLabel}
          dueLabel={w.monthEndLabel}
          kpi={data.kpis.trafficAi}
        />
        <KpiTile
          title="Organic Search Leads"
          startLabel={w.monthStartLabel}
          dueLabel={w.monthEndLabel}
          kpi={data.kpis.leadOrganic}
        />
        <KpiTile
          title="AI Leads"
          startLabel={w.monthStartLabel}
          dueLabel={w.monthEndLabel}
          kpi={data.kpis.leadAi}
        />
      </div>

      <SectionBlock title="Last 7 days vs. Previous 7 days" section={data.sections.last7} />
      <SectionBlock title="Month-to-date vs. Last Period" section={data.sections.mtdVsLastPeriod} />
      <SectionBlock title="Month-to-date vs. Last Year" section={data.sections.mtdVsLastYear} />
      <SectionBlock title="Last 30 days vs. Last Period" section={data.sections.last30VsLastPeriod} />
    </div>
  );
}

function KpiTile({
  title,
  startLabel,
  dueLabel,
  kpi,
}: {
  title: string;
  startLabel: string;
  dueLabel: string;
  kpi: KpiCardData;
}) {
  const color = PACE_COLOR[kpi.pace];
  const hasTarget = kpi.target > 0;
  const fillPct = hasTarget ? Math.max(0, Math.min(100, (kpi.actualMtd / kpi.target) * 100)) : 0;

  return (
    <div className="rounded-xl border bg-surface p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted">
        Starting {startLabel} (Due {dueLabel})
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-xs text-muted">Current</div>
          <div className="text-xl font-semibold tabular-nums">{fmtFull(kpi.actualMtd, "count")}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Target</div>
          <div className="text-sm font-medium tabular-nums">
            {hasTarget ? `≥ ${fmtFull(kpi.target, "count")}` : "not set"}
          </div>
        </div>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${hasTarget ? fillPct : 0}%`, background: color }}
        />
      </div>

      {hasTarget ? (
        <div className="mt-1.5 flex items-center justify-between text-xs font-medium">
          <span style={{ color }}>
            {PACE_LABEL[kpi.pace]} · {kpi.paceDeltaPct >= 0 ? "+" : ""}
            {kpi.paceDeltaPct.toFixed(0)}% {kpi.paceDeltaPct >= 0 ? "better" : "worse"} than
            expected
          </span>
          <span className="text-muted">proj. {fmtFull(kpi.projected, "count")}</span>
        </div>
      ) : (
        <div className="mt-1.5 text-xs text-muted">Set a monthly target in Configure KPIs.</div>
      )}
    </div>
  );
}

const SECTION_METRIC_COLOR = {
  organicTraffic: "var(--clicks)",
  aiTraffic: "var(--impressions)",
  organicLead: "var(--position)",
  aiLead: "var(--good)",
} as const;

function SectionBlock({ title, section }: { title: string; section: Section }) {
  return (
    <div className="mt-4">
      <div className="rounded-t-lg bg-foreground px-4 py-2 text-sm font-semibold text-background">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-3 rounded-b-lg border border-t-0 bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard
          label="Organic Traffic"
          color={SECTION_METRIC_COLOR.organicTraffic}
          cur={section.traffic.curTotals.organic}
          prev={section.traffic.prevTotals?.organic ?? null}
          series={section.traffic.series}
          prevSeries={section.traffic.prevSeries}
          field="organic"
        />
        <MiniCard
          label="AI Traffic"
          color={SECTION_METRIC_COLOR.aiTraffic}
          cur={section.traffic.curTotals.ai}
          prev={section.traffic.prevTotals?.ai ?? null}
          series={section.traffic.series}
          prevSeries={section.traffic.prevSeries}
          field="ai"
        />
        <MiniCard
          label="Organic Search Lead"
          color={SECTION_METRIC_COLOR.organicLead}
          cur={section.leads.curTotals.organic}
          prev={section.leads.prevTotals?.organic ?? null}
          series={section.leads.series}
          prevSeries={section.leads.prevSeries}
          field="organic"
        />
        <MiniCard
          label="AI Lead"
          color={SECTION_METRIC_COLOR.aiLead}
          cur={section.leads.curTotals.ai}
          prev={section.leads.prevTotals?.ai ?? null}
          series={section.leads.series}
          prevSeries={section.leads.prevSeries}
          field="ai"
        />
      </div>
    </div>
  );
}

function MiniCard({
  label,
  color,
  cur,
  prev,
  series,
  prevSeries,
  field,
}: {
  label: string;
  color: string;
  cur: number;
  prev: number | null;
  series: DailyPoint[];
  prevSeries: DailyPoint[] | null;
  field: "organic" | "ai";
}) {
  const delta = prev ? ((cur - prev) / prev) * 100 : null;
  const rows = useMemo(
    () => series.map((pt, i) => ({ idx: i, cur: pt[field], prev: prevSeries?.[i]?.[field] })),
    [series, prevSeries, field],
  );

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{fmtFull(cur, "count")}</span>
        {delta != null && (
          <span
            className="text-xs font-medium"
            style={{ color: delta >= 0 ? "var(--good)" : "var(--bad)" }}
          >
            {pctLabel(delta)}
          </span>
        )}
      </div>
      <div className="mt-1 h-10">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <Line type="monotone" dataKey="cur" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
            {prevSeries && (
              <Line
                type="monotone"
                dataKey="prev"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                strokeOpacity={0.4}
                dot={false}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------- Insights ----------

const INSIGHTS_HTML_CLASS =
  "insights-content max-w-none text-sm leading-relaxed [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_code]:py-0.5 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-child]:mt-0 [&_li]:ml-4 [&_li]:list-disc [&_p]:mt-3";

function Insights({
  data,
  propertyId,
  propertyLabel,
}: {
  data: ReportData;
  propertyId: string;
  propertyLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const [showPost, setShowPost] = useState(false);
  const [tasks, setTasks] = useState<TaskBuckets | null>(null);
  const [asanaProjectName, setAsanaProjectName] = useState("");
  const [tasksErr, setTasksErr] = useState<string | null>(null);
  const [tasksNeedConnect, setTasksNeedConnect] = useState(false);
  // Rendered on screen without tasks (the TaskList grid below already covers that, with
  // clickable links) but copied to the clipboard with tasks included, per request — so a
  // plain paste is a complete, standalone report even without opening "Post to Asana".
  const displayed = useMemo(() => buildInsights(data), [data]);
  const forCopy = useMemo(() => buildInsights(data, tasks), [data, tasks]);
  const projectGid = data.config.asanaProjectGid.trim();

  useEffect(() => {
    if (!projectGid) return;
    let ignore = false;
    setTasksErr(null);
    setTasksNeedConnect(false);
    fetch(`/api/weekly-report/asana-tasks?propertyId=${encodeURIComponent(propertyId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (ignore) return;
        if (j.needsAsanaConnect || j.needsProject) setTasksNeedConnect(true);
        else if (j.error) setTasksErr(j.error);
        else {
          setTasks({ completedRecently: j.completedRecently, dueThisWeek: j.dueThisWeek, dueNextWeek: j.dueNextWeek });
          setAsanaProjectName(j.project?.name ?? "");
        }
      })
      .catch(() => !ignore && setTasksErr("Failed to load Asana tasks."));
    return () => {
      ignore = true;
    };
  }, [propertyId, projectGid]);

  async function copy() {
    try {
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([forCopy.html], { type: "text/html" }),
            "text/plain": new Blob([forCopy.text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(forCopy.text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      await navigator.clipboard.writeText(forCopy.text).catch(() => {});
    }
  }

  return (
    <div className="rounded-xl border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted">
          Formatted for pasting into Asana — copies bold / headings / bullets, tasks included.
        </h3>
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            {copied ? "Copied!" : "Copy for Asana"}
          </button>
          <button
            onClick={() => setShowPost(true)}
            disabled={!projectGid}
            title={projectGid ? undefined : "Set an Asana project ID in Configure KPIs first"}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent-soft disabled:opacity-50"
          >
            Post to Asana…
          </button>
        </div>
      </div>

      <div className={INSIGHTS_HTML_CLASS} dangerouslySetInnerHTML={{ __html: displayed.html }} />

      {projectGid && (
        <div className="mt-6 border-t pt-5">
          <h4 className="text-sm font-semibold text-muted">Tasks (from Asana)</h4>
          {tasksNeedConnect && (
            <p className="mt-2 text-xs text-muted">
              Connect Asana and set a project ID in Configure KPIs to pull tasks here.
            </p>
          )}
          {tasksErr && <p className="mt-2 text-xs text-bad">{tasksErr}</p>}
          {tasks && (
            <div className="mt-3 grid gap-4 lg:grid-cols-3">
              <TaskList title="Completed (last 2 weeks)" tasks={tasks.completedRecently} dateLabel="completed" empty="Nothing completed." />
              <TaskList title="Due this week" tasks={tasks.dueThisWeek} dateLabel="due" empty="Nothing due this week." />
              <TaskList title="Due next week" tasks={tasks.dueNextWeek} dateLabel="due" empty="Nothing due next week." />
            </div>
          )}
        </div>
      )}

      {showPost && (
        <PostToAsanaModal
          data={data}
          tasks={tasks}
          propertyId={propertyId}
          defaultTitle={`${data.config.asanaStatusTitle || asanaProjectName || propertyLabel} - ${format(new Date(), "d MMM")}`}
          onClose={() => setShowPost(false)}
        />
      )}
    </div>
  );
}

function TaskList({
  title,
  tasks,
  dateLabel,
  empty,
}: {
  title: string;
  tasks: AsanaTask[];
  dateLabel: "completed" | "due";
  empty: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs font-semibold uppercase text-muted">{title}</div>
      {!tasks.length && <p className="mt-2 text-xs text-muted">{empty}</p>}
      <ul className="mt-2 space-y-1.5">
        {tasks.map((t) => {
          const date = dateLabel === "completed" ? t.completed_at : t.due_on;
          return (
            <li key={t.gid} className="text-xs">
              <a
                href={t.permalink_url}
                target="_blank"
                rel="noreferrer"
                className="text-foreground hover:text-accent"
              >
                {t.name}
              </a>
              <div className="text-muted">
                {date ? date.slice(0, 10) : `no ${dateLabel} date`}
                {t.assignee?.name ? ` · ${t.assignee.name}` : ""}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Post to Asana ----------

function PostToAsanaModal({
  data,
  tasks,
  propertyId,
  defaultTitle,
  onClose,
}: {
  data: ReportData;
  tasks: TaskBuckets | null;
  propertyId: string;
  defaultTitle: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [statusType, setStatusType] = useState<(typeof STATUS_OPTIONS)[number]["value"]>("on_track");
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; url?: string | null } | null>(null);
  const body = useMemo(() => buildAsanaBody(data, tasks), [data, tasks]);

  async function post() {
    setPosting(true);
    setResult(null);
    try {
      const res = await fetch("/api/weekly-report/asana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          title,
          statusType,
          text: body.text,
        }),
      });
      const j = await res.json();
      if (res.ok) setResult({ ok: true, message: "Posted to Asana.", url: j.permalinkUrl });
      else setResult({ ok: false, message: j.error ?? "Failed to post." });
    } catch {
      setResult({ ok: false, message: "Failed to post." });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-12" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Post status update to Asana</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Nothing is sent until you press Send below — review the preview first.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="text-xs text-muted">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Status</span>
            <select
              value={statusType}
              onChange={(e) => setStatusType(e.target.value as typeof statusType)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-4 text-xs text-muted">
          Posted as plain text — Asana has a long-standing bug where{" "}
          <code className="rounded bg-background px-1 py-0.5">html_text</code> on status updates is
          stored but never rendered, so it shows the raw markup instead of bold/bullets. This is
          exactly what will be posted.
        </p>
        <div className="mt-2 max-h-96 overflow-y-auto rounded-lg border bg-background p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{body.text}</pre>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={post}
            disabled={posting || !title.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {posting ? "Sending…" : "Send to Asana"}
          </button>
          {result && (
            <span className={`text-sm ${result.ok ? "text-good" : "text-bad"}`}>
              {result.message}
              {result.ok && result.url && (
                <>
                  {" "}
                  <a href={result.url} target="_blank" rel="noreferrer" className="underline">
                    View in Asana
                  </a>
                </>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Config modal ----------

function ConfigModal({
  propertyId,
  config,
  availableEvents,
  onClose,
  onSaved,
}: {
  propertyId: string;
  config: KpiConfig;
  availableEvents: { name: string; count: number }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [yearMonth, setYearMonth] = useState(config.yearMonth);
  const [trafficOrganicTarget, setTrafficOrganicTarget] = useState(config.trafficOrganicTarget);
  const [trafficAiTarget, setTrafficAiTarget] = useState(config.trafficAiTarget);
  const [leadOrganicTarget, setLeadOrganicTarget] = useState(config.leadOrganicTarget);
  const [leadAiTarget, setLeadAiTarget] = useState(config.leadAiTarget);
  const [leadEvents, setLeadEvents] = useState<string[]>(config.leadEvents);
  const [asanaProjectGid, setAsanaProjectGid] = useState(config.asanaProjectGid);
  const [asanaStatusTitle, setAsanaStatusTitle] = useState(config.asanaStatusTitle);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggleEvent = (name: string) =>
    setLeadEvents((cur) => (cur.includes(name) ? cur.filter((e) => e !== name) : [...cur, name]));

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/weekly-report/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          yearMonth,
          trafficOrganicTarget,
          trafficAiTarget,
          leadOrganicTarget,
          leadAiTarget,
          leadEvents,
          asanaProjectGid,
          asanaStatusTitle,
        }),
      });
      if (res.ok) onSaved();
      else setMsg("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Configure KPIs</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            ✕
          </button>
        </div>

        <label className="mt-4 block text-xs font-medium text-muted">Month</label>
        <input
          type="month"
          value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)}
          className="mt-1 rounded-md border bg-background px-2 py-1.5 text-sm"
        />

        <div className="mt-4 grid grid-cols-2 gap-4">
          <NumberField label="Organic Traffic target (sessions)" value={trafficOrganicTarget} onChange={setTrafficOrganicTarget} />
          <NumberField label="AI Traffic target (sessions)" value={trafficAiTarget} onChange={setTrafficAiTarget} />
          <NumberField label="Organic Leads target" value={leadOrganicTarget} onChange={setLeadOrganicTarget} />
          <NumberField label="AI Leads target" value={leadAiTarget} onChange={setLeadAiTarget} />
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-muted">
            Events counted as &quot;Leads&quot; (last 30 days of GA4 events)
          </p>
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
            {!availableEvents.length && (
              <p className="px-1 py-2 text-xs text-muted">No events found in the last 30 days.</p>
            )}
            {availableEvents.map((ev) => (
              <label key={ev.name} className="flex items-center justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-accent-soft/40">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={leadEvents.includes(ev.name)}
                    onChange={() => toggleEvent(ev.name)}
                  />
                  {ev.name}
                </span>
                <span className="text-xs tabular-nums text-muted">{fmtFull(ev.count, "count")}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-muted">Asana (Insights tab task export + status posts)</p>
          <div className="mt-2 grid gap-3">
            <label className="block">
              <span className="text-xs text-muted">Asana project ID (gid)</span>
              <input
                value={asanaProjectGid}
                onChange={(e) => setAsanaProjectGid(e.target.value)}
                placeholder="e.g. 1201843027615074 — from the project's URL"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Status update title (optional — defaults to the property name)</span>
              <input
                value={asanaStatusTitle}
                onChange={(e) => setAsanaStatusTitle(e.target.value)}
                placeholder="e.g. HOP145 - Jackalope Hotel - SEO"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
    </label>
  );
}
