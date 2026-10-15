"use client";

import { useMemo, useState } from "react";
import type { Dashboard } from "@/lib/ai-area/brand/dashboard";
import { PLATFORM_LABEL, type FactVerdict, type Platform, type Sentiment } from "@/lib/ai-area/brand/types";
import { Favicon } from "../tracking/Favicon";
import { ChartTableToggle, Panel, type ChartView } from "../tracking/ui";
import { useElementWidth } from "../tracking/useElementWidth";

const SENTIMENT_COLOR: Record<Sentiment, string> = {
  positive: "var(--sentiment-positive)",
  neutral: "var(--sentiment-neutral)",
  negative: "var(--sentiment-negative)",
};
const SENTIMENT_LABEL: Record<Sentiment, string> = { positive: "Positive", neutral: "Neutral", negative: "Negative" };
const PLATFORM_DOMAIN: Record<Platform, string> = { aiMode: "google.com", aiOverview: "google.com", chatgpt: "chatgpt.com", claude: "claude.ai" };

export function PlatformIcon({ platform, size = 16 }: { platform: Platform; size?: number }) {
  return (
    <span title={PLATFORM_LABEL[platform]} className="inline-flex">
      <Favicon domain={PLATFORM_DOMAIN[platform]} label={PLATFORM_LABEL[platform]} size={size} />
    </span>
  );
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Ring({ score }: { score: number | null }) {
  const size = 132;
  const stroke = 11;
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const value = score ?? 0;
  const color = value >= 65 ? "var(--sentiment-positive)" : value >= 45 ? "var(--status-warning)" : "var(--sentiment-negative)";
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={score === null ? "No score yet" : `Perception score ${Math.round(value)} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gridline)" strokeWidth={stroke} />
        {score !== null ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(value / 100) * c} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-4xl font-semibold" style={{ color: "var(--text-primary)" }}>
          {score === null ? "-" : Math.round(value)}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          / 100
        </span>
      </div>
    </div>
  );
}

export function PerceptionCard({ data, brandName, platform }: { data: Dashboard; brandName: string; platform: Platform | "all" }) {
  const p = data.perception;
  return (
    <Panel
      title="Brand Perception"
      subtitle={`How ${platform === "all" ? "AI answer engines" : PLATFORM_LABEL[platform]} perceive ${brandName || "your brand"}`}
      footer={
        <>
          <span className="flex items-center gap-2">
            <span className="flex -space-x-1">
              {p.topSources.map((d) => (
                <span key={d} className="rounded-full ring-2" style={{ ["--tw-ring-color" as string]: "var(--surface-1)" }}>
                  <Favicon domain={d} size={18} />
                </span>
              ))}
            </span>
            <span style={{ color: "var(--text-secondary)" }}>{p.sourceCount} sources</span>
          </span>
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4" style={{ background: "var(--sentiment-positive)" }} aria-hidden />
              Strength
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4" style={{ background: "var(--sentiment-negative)" }} aria-hidden />
              Weakness
            </span>
            {p.updatedAt ? <span>Updated {fmtDate(p.updatedAt)}</span> : null}
          </span>
        </>
      }
    >
      <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3">
          <Ring score={p.score} />
          <div className="flex flex-wrap justify-center gap-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>
            {(["positive", "neutral", "negative"] as Sentiment[]).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: SENTIMENT_COLOR[s] }} aria-hidden />
                {Math.round(p.shares[s])}% {s.slice(0, 3)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 text-[15px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
          {p.summary?.paragraphs.length ? (
            p.summary.paragraphs.map((para, i) => (
              <p key={i}>
                {para.map((seg, j) =>
                  seg.tone ? (
                    <span
                      key={j}
                      className="underline decoration-2 underline-offset-4"
                      style={{ textDecorationColor: seg.tone === "strength" ? "var(--sentiment-positive)" : "var(--sentiment-negative)" }}
                      title={seg.tone === "strength" ? "Strength" : "Weakness"}
                    >
                      {seg.text}
                    </span>
                  ) : (
                    <span key={j}>{seg.text}</span>
                  )
                )}
              </p>
            ))
          ) : (
            <p style={{ color: "var(--text-muted)" }}>The summary appears when a tracking run finishes.</p>
          )}
          {p.summaryScope !== platform && platform !== "all" ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Showing the all-platform summary (none for {PLATFORM_LABEL[platform]} in this run).
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

export function SentimentTrend({ trend }: { trend: Dashboard["trend"] }) {
  const [view, setView] = useState<ChartView>("chart");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const last = trend.at(-1)?.score ?? null;
  const prev = trend.at(-2)?.score ?? null;
  const delta = last !== null && prev !== null ? last - prev : null;
  const H = 220;
  const M = { top: 10, right: 12, bottom: 24, left: 34 };
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = H - M.top - M.bottom;
  const n = trend.length;
  const slot = n ? innerW / n : 0;
  const barW = Math.max(6, Math.min(36, slot * 0.6));
  const y = (v: number) => M.top + innerH - (v / 100) * innerH;
  const x = (i: number) => M.left + slot * i + slot / 2;
  const line = trend
    .map((t, i) => (t.score === null ? null : `${x(i)},${y(t.score)}`))
    .filter(Boolean)
    .join(" ");
  const h = hover !== null ? trend[hover] : null;

  return (
    <Panel title="Sentiment Score" subtitle="Your brand's sentiment over time across AI answers" actions={<ChartTableToggle view={view} onChange={setView} />}>
      <div className="flex items-baseline gap-2">
        <span className="tabular text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
          {last === null ? "-" : last.toFixed(1)}
        </span>
        {delta !== null ? (
          <span className="tabular text-sm font-semibold" style={{ color: delta >= 0 ? "var(--success-text)" : "var(--status-critical)" }}>
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(1)}
          </span>
        ) : null}
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          0-100 · bars show the share of positive, neutral and negative claims per run
        </span>
      </div>
      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: "var(--text-muted)" }}>
                <th className="py-1.5 text-left font-medium">Run</th>
                <th className="py-1.5 text-right font-medium">Score</th>
                <th className="py-1.5 text-right font-medium">Visibility</th>
                <th className="py-1.5 text-right font-medium">Positive</th>
                <th className="py-1.5 text-right font-medium">Neutral</th>
                <th className="py-1.5 text-right font-medium">Negative</th>
              </tr>
            </thead>
            <tbody>
              {[...trend].reverse().map((t) => (
                <tr key={t.cycleId} className="border-t" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
                  <td className="py-1.5">{fmtDate(t.date)}</td>
                  <td className="tabular py-1.5 text-right">{t.score ?? "-"}</td>
                  <td className="tabular py-1.5 text-right">{t.visibility}%</td>
                  <td className="tabular py-1.5 text-right">{t.shares.positive}%</td>
                  <td className="tabular py-1.5 text-right">{t.shares.neutral}%</td>
                  <td className="tabular py-1.5 text-right">{t.shares.negative}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
          {n === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No runs in this period.
            </p>
          ) : width > 0 ? (
            <svg width={width} height={H} role="img" aria-label="Sentiment score per run">
              {[0, 25, 50, 75, 100].map((t) => (
                <g key={t}>
                  <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--gridline)"} strokeWidth={1} />
                  <text x={M.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                    {t}
                  </text>
                </g>
              ))}
              {trend.map((t, i) => {
                let acc = 0;
                const order: Sentiment[] = ["negative", "neutral", "positive"];
                return (
                  <g key={t.cycleId} opacity={hover === null || hover === i ? 1 : 0.55}>
                    {order.map((s) => {
                      const v = t.shares[s];
                      if (!v) return null;
                      const top = y(acc + v);
                      const height = Math.max(0, y(acc) - top - (acc > 0 ? 2 : 0));
                      acc += v;
                      return <rect key={s} x={x(i) - barW / 2} y={top} width={barW} height={height} rx={s === "positive" ? 3 : 0} fill={SENTIMENT_COLOR[s]} />;
                    })}
                    <rect x={M.left + slot * i} y={M.top} width={slot} height={innerH} fill="transparent" onPointerEnter={() => setHover(i)} />
                    {n <= 12 || i % Math.ceil(n / 12) === 0 ? (
                      <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                        {fmtDate(t.date)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {line ? <polyline points={line} fill="none" stroke="var(--text-primary)" strokeWidth={2} strokeLinejoin="round" pointerEvents="none" /> : null}
              {trend.map((t, i) =>
                t.score === null ? null : <circle key={t.cycleId} cx={x(i)} cy={y(t.score)} r={hover === i ? 5 : 3.5} fill="var(--text-primary)" stroke="var(--surface-1)" strokeWidth={2} pointerEvents="none" />
              )}
            </svg>
          ) : null}
          {h && hover !== null ? (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border px-3 py-2 text-xs shadow-sm"
              style={{ left: Math.min(Math.max(0, x(hover) - 80), Math.max(0, width - 170)), top: 0, borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-secondary)" }}
            >
              <div className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {fmtDate(h.date)} · score {h.score ?? "-"}
              </div>
              <div>Visibility {h.visibility}%</div>
              {(["positive", "neutral", "negative"] as Sentiment[]).map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: SENTIMENT_COLOR[s] }} aria-hidden />
                  {SENTIMENT_LABEL[s]} {h.shares[s]}%
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function HeadToHead({ brands, websites }: { brands: Dashboard["brands"]; websites: Record<string, string> }) {
  const target = brands.find((b) => b.isTarget);
  const rivals = brands.filter((b) => !b.isTarget);
  const [rivalName, setRivalName] = useState<string | null>(null);
  const rival = rivals.find((b) => b.name === rivalName) ?? [...rivals].sort((a, b) => b.mentions - a.mentions)[0];
  if (!target || !rival) {
    return (
      <Panel title="Head-to-Head" subtitle="Your brand vs a competitor across AI answers">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No competitor has appeared in the answers yet. Add competitors in Settings, or wait for a run.
        </p>
      </Panel>
    );
  }
  const total = target.visibility + rival.visibility || 1;
  const leftPct = (target.visibility / total) * 100;
  const lead = target.visibility - rival.visibility;
  const describe = () => {
    const parts = [`${target.name} appears in ${target.visibility}% of AI answers, ${rival.name} in ${rival.visibility}%.`];
    if (target.avgPosition !== null && rival.avgPosition !== null) parts.push(`Average position ${target.avgPosition} vs ${rival.avgPosition} (lower is earlier in the answer).`);
    if (target.avgSentiment !== null && rival.avgSentiment !== null) parts.push(`Sentiment ${Math.round(target.avgSentiment)} vs ${Math.round(rival.avgSentiment)}.`);
    return parts.join(" ");
  };
  return (
    <Panel
      title="Head-to-Head"
      subtitle={`${lead >= 0 ? "+" : ""}${lead.toFixed(1)} pts visibility`}
      actions={
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          <Favicon domain={websites[rival.name] ?? ""} label={rival.name} size={14} />
          <select value={rival.name} onChange={(e) => setRivalName(e.target.value)} className="rounded-md border px-1.5 py-1 text-xs" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }} aria-label="Competitor">
            {rivals.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.isCompetitor ? "" : " (detected)"}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            {target.name}
          </span>
          <span className="tabular text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {target.visibility}%
          </span>
        </div>
        <div className="flex min-w-0 flex-col items-end">
          <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            {rival.name}
          </span>
          <span className="tabular text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {rival.visibility}%
          </span>
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {describe()}
      </p>
      <div className="flex h-3 w-full overflow-hidden rounded-full" role="img" aria-label={`${target.name} ${target.visibility}% vs ${rival.name} ${rival.visibility}%`}>
        <div style={{ width: `${leftPct}%`, background: "var(--series-1)" }} />
        <div style={{ width: 2, background: "var(--surface-1)" }} />
        <div className="flex-1" style={{ background: "var(--series-2)" }} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[target, rival].map((b, i) => (
          <div key={b.name} className={`flex flex-col gap-1.5 ${i === 1 ? "items-end" : ""}`}>
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: i === 0 ? "var(--series-1)" : "var(--series-2)" }} aria-hidden />
              Known for
            </span>
            {b.knownFor.length ? (
              b.knownFor.map((k) => (
                <span key={k} className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "color-mix(in srgb, var(--sentiment-positive) 35%, transparent)", color: "var(--text-primary)" }}>
                  ✓ {k}
                </span>
              ))
            ) : (
              <span className="text-xs italic" style={{ color: "var(--text-muted)" }}>
                No data yet
              </span>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

const ATTR_STYLE: Record<"leading" | "parity" | "behind", { bg: string; label: string; mark: string }> = {
  leading: { bg: "color-mix(in srgb, var(--status-good) 30%, var(--surface-1))", label: "Leading", mark: "▲" },
  parity: { bg: "var(--page-plane)", label: "At parity", mark: "=" },
  behind: { bg: "color-mix(in srgb, var(--status-warning) 45%, var(--surface-1))", label: "Behind", mark: "▼" },
};

export function AttributesGrid({ attributes }: { attributes: Dashboard["attributes"] }) {
  const [view, setView] = useState<ChartView>("chart");
  const counts = { leading: 0, parity: 0, behind: 0 };
  attributes.forEach((a) => counts[a.status]++);
  const total = attributes.length || 1;
  return (
    <Panel
      title="Attributes"
      subtitle="What AI says about your brand, compared with the other brands in the same answers"
      actions={<ChartTableToggle view={view} onChange={setView} />}
      footer={
        <>
          <span className="flex flex-wrap gap-4">
            {(Object.keys(ATTR_STYLE) as Array<keyof typeof ATTR_STYLE>).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: k === "leading" ? "var(--status-good)" : k === "behind" ? "var(--status-warning)" : "var(--gridline)" }} aria-hidden />
                {ATTR_STYLE[k].label} ({Math.round((counts[k] / total) * 100)}%)
              </span>
            ))}
          </span>
          <span>{attributes.length} attributes</span>
        </>
      }
    >
      {attributes.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Attributes appear once answers mention your brand.
        </p>
      ) : view === "table" ? (
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-1.5 text-left font-medium">Attribute</th>
              <th className="py-1.5 text-right font-medium">Share</th>
              <th className="py-1.5 text-right font-medium">You</th>
              <th className="py-1.5 text-right font-medium">Others</th>
              <th className="py-1.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {attributes.map((a) => (
              <tr key={a.attribute} className="border-t" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
                <td className="py-1.5">{a.attribute}</td>
                <td className="tabular py-1.5 text-right">{a.share}%</td>
                <td className="tabular py-1.5 text-right">{a.target ?? "-"}</td>
                <td className="tabular py-1.5 text-right">{a.others ?? "-"}</td>
                <td className="py-1.5 pl-3">{ATTR_STYLE[a.status].label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {attributes.map((a, i) => (
            <div
              key={a.attribute}
              className={`flex min-w-0 flex-col items-center justify-center rounded-lg px-2 py-3 text-center ${i === 0 ? "sm:row-span-2" : ""}`}
              style={{ background: ATTR_STYLE[a.status].bg }}
              title={`${a.attribute}: ${ATTR_STYLE[a.status].label}. Your sentiment ${a.target ?? "-"} vs others ${a.others ?? "-"} (0-100), ${a.mentions} mentions.`}
            >
              <span className="w-full truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {a.attribute}
              </span>
              <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                {a.share}%
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                {ATTR_STYLE[a.status].mark} {ATTR_STYLE[a.status].label}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function BrandFacts({ facts, onVerdict }: { facts: Dashboard["facts"]; onVerdict: (key: string, verdict: FactVerdict | null) => void }) {
  const [showAll, setShowAll] = useState(false);
  const verified = facts.filter((f) => f.verdict).length;
  const shown = showAll ? facts : facts.slice(0, 4);
  return (
    <Panel
      title="Brand Facts"
      subtitle="Verify what AI platforms say about your brand"
      footer={
        <>
          <span>
            {verified} of {facts.length} verified · {facts.filter((f) => f.verdict === "incorrect").length} incorrect
          </span>
          {facts.length > 4 ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="rounded-md border px-2.5 py-1 font-medium" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
              {showAll ? "Show less" : `Show all ${facts.length}`}
            </button>
          ) : null}
        </>
      }
    >
      {facts.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Checkable statements (prices, capacity, awards, what&apos;s included) appear here after a run.
        </p>
      ) : (
        <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto">
          {shown.map((f) => (
            <div key={f.key} className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: f.verdict === "incorrect" ? "var(--status-critical)" : "var(--border-hairline)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
                  <PlatformIcon platform={f.platform} size={12} />
                  {PLATFORM_LABEL[f.platform]}
                </span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {fmtDate(f.date)}
                </span>
              </div>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                {f.statement}
              </p>
              <div className="flex gap-2">
                {(["correct", "incorrect"] as FactVerdict[]).map((v) => {
                  const active = f.verdict === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onVerdict(f.key, active ? null : v)}
                      aria-pressed={active}
                      className="rounded-lg border px-3 py-1 text-xs font-medium"
                      style={{
                        borderColor: active ? (v === "correct" ? "var(--sentiment-positive)" : "var(--status-critical)") : "var(--border-hairline)",
                        color: active ? (v === "correct" ? "var(--success-text)" : "var(--status-critical)") : "var(--text-secondary)",
                        background: active ? "var(--page-plane)" : "transparent",
                      }}
                    >
                      {v === "correct" ? "✓ Correct" : "✕ Incorrect"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function SourceSentiment({ sources, brandName }: { sources: Dashboard["sources"]; brandName: string }) {
  const [filter, setFilter] = useState<Sentiment | "all">("all");
  const claims = useMemo(() => sources.claims.filter((c) => filter === "all" || c.sentiment === filter), [sources.claims, filter]);
  return (
    <Panel
      title="Source Sentiment"
      subtitle={`${sources.claims.length} claims about ${brandName || "your brand"}`}
      bodyClassName="flex flex-col"
      actions={
        <select value={filter} onChange={(e) => setFilter(e.target.value as Sentiment | "all")} className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }} aria-label="Filter claims">
          <option value="all">All</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
        </select>
      }
    >
      <div className="grid grid-cols-2 border-b sm:grid-cols-4" style={{ borderColor: "var(--border-hairline)" }}>
        {[
          { label: "Positive", value: sources.counts.positive, color: "var(--success-text)" },
          { label: "Neutral", value: sources.counts.neutral, color: "var(--text-primary)" },
          { label: "Negative", value: sources.counts.negative, color: "var(--status-critical)" },
          { label: "Total", value: sources.total, color: "var(--text-primary)", suffix: `across ${sources.platforms.length} platform${sources.platforms.length === 1 ? "" : "s"}` },
        ].map((s) => (
          <div key={s.label} className="flex flex-col gap-1 border-r px-4 py-3 last:border-r-0" style={{ borderColor: "var(--border-hairline)" }}>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {s.label}
            </span>
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              <span className="tabular text-2xl font-semibold" style={{ color: s.color }}>
                {s.value}
              </span>{" "}
              {s.suffix ?? "sources"}
            </span>
          </div>
        ))}
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0" style={{ background: "var(--surface-1)" }}>
            <tr className="text-left text-xs" style={{ color: "var(--text-muted)" }}>
              <th className="w-10 px-4 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Claim</th>
              <th className="px-2 py-2 font-medium">Sentiment</th>
              <th className="px-2 py-2 font-medium">Platform</th>
              <th className="px-2 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c, i) => (
              <tr key={`${c.platform}-${c.claim}`} className="border-t align-top" style={{ borderColor: "var(--border-hairline)" }}>
                <td className="tabular px-4 py-2.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {i + 1}
                </td>
                <td className="px-2 py-2.5">
                  <span className="block" style={{ color: "var(--text-primary)" }}>
                    {c.claim}
                    {c.count > 1 ? <span className="ml-1.5 text-xs" style={{ color: "var(--text-muted)" }}>×{c.count}</span> : null}
                  </span>
                  <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                    {c.detail}
                  </span>
                </td>
                <td className="px-2 py-2.5">
                  <span
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                    style={{ borderColor: `color-mix(in srgb, ${SENTIMENT_COLOR[c.sentiment]} 45%, transparent)`, color: c.sentiment === "positive" ? "var(--success-text)" : c.sentiment === "negative" ? "var(--status-critical)" : "var(--text-secondary)" }}
                  >
                    {c.sentiment === "positive" ? "☺" : c.sentiment === "negative" ? "☹" : "–"} {SENTIMENT_LABEL[c.sentiment]}
                  </span>
                </td>
                <td className="px-2 py-2.5">
                  <PlatformIcon platform={c.platform} />
                </td>
                <td className="px-2 py-2.5 text-xs">
                  {c.source ? (
                    <a href={c.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline" style={{ color: "var(--text-secondary)" }}>
                      <Favicon domain={c.source.domain} size={14} />
                      {c.source.domain} ↗
                    </a>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>-</span>
                  )}
                </td>
              </tr>
            ))}
            {claims.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  No claims yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
