"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CONTENT_STAGES,
  DEMO_ARTICLES,
  DEMO_COMPETITORS,
  DEMO_KEYWORDS,
  DEMO_MONTHLY,
  DEMO_PROJECT,
  DEMO_REFERRING_DOMAINS,
  type DemoKeyword,
  type Intent,
} from "@/lib/v2/demo";
import { Card, DataTable, DemoBanner, MetricCard, type Column } from "./ui";

const n = (v: number) => v.toLocaleString("en-US");
const INTENTS: Intent[] = ["Informational", "Commercial", "Transactional", "Navigational"];

export function KeywordExplorerDemo() {
  const [intent, setIntent] = useState<Intent | "all">("all");
  const rows = useMemo(() => (intent === "all" ? DEMO_KEYWORDS : DEMO_KEYWORDS.filter((k) => k.intent === intent)), [intent]);
  const byIntent = INTENTS.map((i) => ({
    intent: i,
    volume: DEMO_KEYWORDS.filter((k) => k.intent === i).reduce((s, k) => s + k.volume, 0),
  }));
  const ranked = rows.filter((k) => k.position != null);

  const columns: Column<DemoKeyword>[] = [
    { key: "keyword", label: "Keyword", width: "34%" },
    { key: "volume", label: "Volume", numeric: true, render: (r) => n(r.volume) },
    { key: "difficulty", label: "Difficulty", numeric: true },
    { key: "cpc", label: "CPC (USD)", numeric: true, render: (r) => r.cpc.toFixed(2) },
    { key: "intent", label: "Intent" },
    { key: "position", label: "Position", numeric: true, render: (r) => (r.position == null ? <span className="text-muted">Not ranking</span> : r.position) },
    { key: "cluster", label: "Cluster" },
  ];

  return (
    <>
      <DemoBanner what={`Keyword data for ${DEMO_PROJECT.name}, a fictional resort.`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Keywords" value={n(rows.length)} />
        <MetricCard label="Total monthly volume" value={n(rows.reduce((s, k) => s + k.volume, 0))} />
        <MetricCard
          label="Average difficulty"
          value={rows.length ? Math.round(rows.reduce((s, k) => s + k.difficulty, 0) / rows.length).toString() : "—"}
          hint="0–100, demo scale"
        />
        <MetricCard label="Ranking in top 10" value={`${ranked.filter((k) => k.position! <= 10).length} of ${rows.length}`} />
      </div>
      <Card title="Search volume by intent" className="mb-4">
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <BarChart data={byIntent} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="intent" tick={{ fontSize: 12, fill: "var(--muted)" }} stroke="var(--border)" />
              <YAxis width={56} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--muted)" }} tickFormatter={(v: number) => n(v)} />
              <Tooltip
                cursor={{ fill: "var(--accent-soft)" }}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }}
                formatter={((v: unknown) => [n(Number(v)), "Monthly volume"]) as never}
              />
              <Bar dataKey="volume" fill="var(--series-a)" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.keyword}
        exportName="keyword-explorer"
        demo
        searchPlaceholder="Search keywords or clusters…"
        toolbar={
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value as Intent | "all")}
            aria-label="Filter by intent"
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="all">All intents</option>
            {INTENTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        }
      />
    </>
  );
}

export function CompetitorOverviewDemo() {
  const others = DEMO_COMPETITORS.filter((c) => c.sharedKeywords > 0);
  return (
    <>
      <DemoBanner what={`Competitors of ${DEMO_PROJECT.name}, all fictional.`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard label="Competitors tracked" value={String(others.length)} />
        <MetricCard label="Keyword gap" value={n(others.reduce((s, c) => s + c.gapKeywords, 0))} hint="Keywords competitors rank for and you don't" />
        <MetricCard label="Your estimated traffic" value={n(DEMO_COMPETITORS[0].estTraffic)} hint="Monthly, demo estimate" />
      </div>
      <DataTable
        columns={[
          { key: "domain", label: "Domain", width: "34%" },
          { key: "estTraffic", label: "Est. monthly traffic", numeric: true, render: (r) => n(r.estTraffic) },
          { key: "keywords", label: "Ranking keywords", numeric: true, render: (r) => n(r.keywords) },
          { key: "sharedKeywords", label: "Shared with you", numeric: true, render: (r) => (r.sharedKeywords ? n(r.sharedKeywords) : "—") },
          { key: "gapKeywords", label: "Gap keywords", numeric: true, render: (r) => (r.gapKeywords ? n(r.gapKeywords) : "—") },
        ]}
        rows={DEMO_COMPETITORS}
        rowKey={(r) => r.domain}
        exportName="competitors"
        demo
      />
    </>
  );
}

export function BacklinksDemo() {
  const counts = { new: 0, lost: 0, stable: 0 };
  for (const d of DEMO_REFERRING_DOMAINS) counts[d.status]++;
  return (
    <>
      <DemoBanner what={`Backlinks of ${DEMO_PROJECT.name}, all fictional. No outreach is sent from here.`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Referring domains" value={String(DEMO_REFERRING_DOMAINS.length)} />
        <MetricCard label="Backlinks" value={n(DEMO_REFERRING_DOMAINS.reduce((s, d) => s + d.links, 0))} />
        <MetricCard label="New (30 days)" value={String(counts.new)} />
        <MetricCard label="Lost (30 days)" value={String(counts.lost)} />
      </div>
      <DataTable
        columns={[
          { key: "domain", label: "Referring domain", width: "30%" },
          { key: "authority", label: "Authority", numeric: true },
          { key: "links", label: "Links", numeric: true },
          { key: "anchor", label: "Top anchor" },
          { key: "firstSeen", label: "First seen" },
          {
            key: "status",
            label: "Status",
            render: (r) => (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ background: r.status === "new" ? "var(--good)" : r.status === "lost" ? "var(--bad)" : "var(--muted)" }}
                />
                {r.status === "new" ? "New" : r.status === "lost" ? "Lost" : "Stable"}
              </span>
            ),
          },
        ]}
        rows={DEMO_REFERRING_DOMAINS}
        rowKey={(r) => r.domain}
        exportName="referring-domains"
        demo
      />
    </>
  );
}

export function EditorialBoardDemo() {
  return (
    <>
      <DemoBanner what="A fictional editorial board. Google Docs and WordPress actions are shown as previews only and never run." />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {CONTENT_STAGES.map((stage) => {
          const items = DEMO_ARTICLES.filter((a) => a.stage === stage);
          return (
            <section key={stage} aria-label={stage} className="rounded-xl border bg-background p-2">
              <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-semibold">
                {stage}
                <span className="text-xs font-normal text-muted">{items.length}</span>
              </h2>
              <ul className="space-y-2">
                {items.map((a) => (
                  <li key={a.title} className="rounded-lg border bg-surface p-3 text-sm">
                    <p className="font-medium">{a.title}</p>
                    <p className="mt-1 text-xs text-muted">Keyword: {a.keyword}</p>
                    <p className="text-xs text-muted">
                      {a.owner} · due {a.due}
                    </p>
                  </li>
                ))}
                {!items.length && <li className="px-1 text-xs text-muted">Nothing here.</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

export function MonthlyReportDemo() {
  const m = DEMO_MONTHLY;
  return (
    <>
      <DemoBanner what={`A fictional monthly report for ${DEMO_PROJECT.name}, ${m.month}. It is never sent anywhere.`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {m.kpis.map((k) => {
          const pct = Math.round((k.value / k.target) * 100);
          const change = ((k.value - k.previous) / k.previous) * 100;
          return (
            <MetricCard
              key={k.label}
              label={k.label}
              value={n(k.value)}
              hint={`${pct}% of target ${n(k.target)} · ${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs last month`}
            />
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Highlights">
          <ul className="list-disc space-y-1 pl-5 text-sm">{m.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
        </Card>
        <Card title="Completed this month">
          <ul className="list-disc space-y-1 pl-5 text-sm">{m.completed.map((h) => <li key={h}>{h}</li>)}</ul>
        </Card>
        <Card title="Next month">
          <ul className="list-disc space-y-1 pl-5 text-sm">{m.next.map((h) => <li key={h}>{h}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
