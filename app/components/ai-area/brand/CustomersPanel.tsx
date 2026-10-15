"use client";

// Customer reviews for Brand Mentions, ported from the AI Brand Mention app. In SEO Console the reviews are the
// project's own Google Maps reviews (Local SEO → Maps reviews), read from storage; fetching and analysing them
// stays on that screen. Tripadvisor and Google Hotels listings aren't connected, so their panels aren't shown.

import { useCallback, useEffect, useState } from "react";
import type { AspectSummary, CustomerVoice } from "@/lib/ai-area/brand/customers";
import type { CustomerGap, GapStatus, GapTone } from "@/lib/ai-area/brand/types";
import { EmptyState, Headline, Panel, SelectControl } from "../tracking/ui";

export interface CustomersPayload {
  voice: CustomerVoice;
  gap: CustomerGap | null;
}

/** Loads the brand's customer reviews summary for a date range ("365" = last 12 months). */
export function useCustomers(projectId: number, range: string) {
  const [data, setData] = useState<CustomersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/ai-area/${projectId}/brand/customers?range=${range}`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as CustomersPayload & { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Couldn't load customer reviews");
      return;
    }
    setError(null);
    setData(body);
  }, [projectId, range]);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) await load();
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);
  return { data, error, reload: load, setData };
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const STATUS_STYLE: Record<GapStatus, { label: string; color: string; mark: string; hint: string }> = {
  aligned: { label: "Aligned", color: "var(--status-good)", mark: "✓", hint: "AI answers match what customers say" },
  missing: { label: "AI misses it", color: "var(--status-warning)", mark: "!", hint: "Customers talk about it, AI answers don't" },
  contradicts: { label: "Contradicts", color: "var(--status-critical)", mark: "×", hint: "AI answers and customers disagree" },
  "ai-only": { label: "AI only", color: "var(--text-muted)", mark: "?", hint: "AI answers say it, customers don't raise it" },
};

const TONE_LABEL: Record<GapTone, string> = { positive: "Positive", negative: "Negative", mixed: "Mixed", none: "Not mentioned" };
const TONE_COLOR: Record<GapTone, string> = {
  positive: "var(--sentiment-positive)",
  negative: "var(--sentiment-negative)",
  mixed: "var(--sentiment-mixed)",
  none: "var(--gridline)",
};

function Tone({ tone }: { tone: GapTone }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" style={{ color: tone === "none" ? "var(--text-muted)" : "var(--text-secondary)" }}>
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: TONE_COLOR[tone] }} />
      {TONE_LABEL[tone]}
    </span>
  );
}

function StatusChip({ status }: { status: GapStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{ borderColor: `color-mix(in srgb, ${s.color} 45%, transparent)`, color: "var(--text-primary)", background: `color-mix(in srgb, ${s.color} 10%, transparent)` }}
      title={s.hint}
    >
      <span aria-hidden style={{ color: s.color }}>
        {s.mark}
      </span>
      {s.label}
    </span>
  );
}

/** Two scores on one 0-100 axis: how AI answers talk about the brand vs how its customers do. */
function ScoreCompare({ ai, customers }: { ai: number | null; customers: number | null }) {
  const rows = [
    { label: "AI answers", value: ai, color: "var(--series-1)" },
    { label: "Customer reviews", value: customers, color: "var(--series-2)" },
  ];
  const gap = ai !== null && customers !== null ? Math.round(ai - customers) : null;
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {r.label}
            </span>
            <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {r.value === null ? "–" : Math.round(r.value)}
              <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                /100
              </span>
            </span>
          </div>
          <div className="h-2.5 rounded" style={{ background: "var(--meter-track)" }}>
            <div className="h-2.5 rounded" style={{ width: `${r.value ?? 0}%`, background: r.color }} />
          </div>
        </div>
      ))}
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {gap === null
          ? "Both scores use the same scale: 100 = all positive, 50 = neutral, 0 = all negative."
          : Math.abs(gap) < 5
            ? "AI answers are about as positive as customers are."
            : gap > 0
              ? `AI answers are ${gap} points more positive than customers - check the contradictions below.`
              : `Customers are ${-gap} points more positive than AI answers - there's credit AI isn't giving you yet.`}
      </p>
    </div>
  );
}

function SourceRatings({ voice }: { voice: CustomerVoice }) {
  const l = voice.listing;
  if (!l) return null;
  return (
    <div className="flex flex-col text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {l.sourceLabel}
        </span>
        <span className="tabular whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
          {l.rating ? (
            <>
              {l.rating.toFixed(1)} <span style={{ color: "var(--rating-star)" }}>★</span>
            </>
          ) : (
            "–"
          )}
          {l.reviewCount ? ` · ${l.reviewCount.toLocaleString()} reviews` : ""}
        </span>
      </div>
      <span style={{ color: "var(--text-muted)" }}>{l.name}</span>
    </div>
  );
}

function GapTable({ gap }: { gap: CustomerGap }) {
  const order: GapStatus[] = ["contradicts", "missing", "ai-only", "aligned"];
  const items = [...gap.items].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return (
    <div className="flex flex-col gap-3">
      {gap.summary ? (
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {gap.summary}
        </p>
      ) : null}
      {/* Phones: one card per topic; wider screens: a table. */}
      <ul className="flex flex-col md:hidden">
        {items.map((item, i) => (
          <li key={`${i}-${item.topic}`} className="flex flex-col gap-1 border-t py-2.5" style={{ borderColor: "var(--gridline)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {item.topic}
              </span>
              <StatusChip status={item.status} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="flex items-center gap-1.5">
                Customers <Tone tone={item.customers} />
              </span>
              <span className="flex items-center gap-1.5">
                AI <Tone tone={item.ai} />
              </span>
            </div>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {item.note}
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-1.5 pr-2 text-left font-medium">Topic</th>
              <th className="py-1.5 pr-2 text-left font-medium">Customers</th>
              <th className="py-1.5 pr-2 text-left font-medium">AI answers</th>
              <th className="py-1.5 pr-2 text-left font-medium">Status</th>
              <th className="py-1.5 text-left font-medium">What it means</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={`${i}-${item.topic}`} className="border-t align-top" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-2 pr-2 font-medium" style={{ color: "var(--text-primary)" }}>
                  {item.topic}
                </td>
                <td className="py-2 pr-2">
                  <Tone tone={item.customers} />
                </td>
                <td className="py-2 pr-2">
                  <Tone tone={item.ai} />
                </td>
                <td className="py-2 pr-2">
                  <StatusChip status={item.status} />
                </td>
                <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                  {item.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Dashboard card: AI perception vs the customer experience, topic by topic. */
export function AiVsCustomersCard({
  projectId,
  aiScore,
  hasRuns,
  onOpenSection,
  onOpenReviews,
}: {
  projectId: number;
  aiScore: number | null;
  hasRuns: boolean;
  onOpenSection: () => void;
  onOpenReviews: () => void;
}) {
  const { data, error, setData } = useCustomers(projectId, "365");
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  async function compare() {
    setComparing(true);
    setCompareError(null);
    try {
      const res = await fetch(`/api/ai-area/${projectId}/brand/customers`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { gap?: CustomerGap; error?: string };
      if (!res.ok || !body.gap) throw new Error(body.error ?? "Comparison failed");
      setData((d) => (d ? { ...d, gap: body.gap ?? null } : d));
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setComparing(false);
    }
  }

  if (error) {
    return (
      <p className="text-xs" style={{ color: "var(--status-critical)" }}>
        {error}
      </p>
    );
  }
  if (!data) return null;
  const v = data.voice;

  return (
    <Panel
      title="AI answers vs. real customers"
      subtitle="what AI says about the brand next to what customers say in its Google Maps reviews (last 12 months)"
      actions={
        <button type="button" onClick={onOpenSection} className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
          Customer reviews
        </button>
      }
      footer={
        data.gap ? (
          <>
            <span>
              Compared {fmtDate(data.gap.generatedAt)} · {data.gap.reviews.toLocaleString()} reviews
            </span>
            <button type="button" onClick={() => void compare()} disabled={comparing} className="font-medium hover:underline disabled:opacity-50" style={{ color: "var(--series-1)" }}>
              {comparing ? "Comparing..." : "Compare again"}
            </button>
          </>
        ) : undefined
      }
    >
      {!v.listing ? (
        <EmptyState
          title="No Google Maps reviews for this project"
          body="Add the business's Google Maps link in Project settings and fetch its reviews in Local SEO → Maps reviews. They then appear here next to the AI answers."
          action={
            <button type="button" onClick={onOpenReviews} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--series-1)" }}>
              Open Maps reviews
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <ScoreCompare ai={aiScore} customers={v.totals.score} />
            <SourceRatings voice={v} />
          </div>
          {data.gap ? (
            <GapTable gap={data.gap} />
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {v.totals.analysed === 0
                  ? "No analysed Google Maps reviews yet - fetch and analyse them in Local SEO → Maps reviews."
                  : hasRuns
                    ? "Compare the latest AI answers with these reviews, topic by topic: what AI gets right, what it misses, and where it contradicts customers."
                    : "Run a brand check first; the comparison is made automatically after each run (it needs the analysis model)."}
              </p>
              {v.totals.analysed > 0 && hasRuns ? (
                <button type="button" onClick={() => void compare()} disabled={comparing} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60" style={{ background: "var(--series-1)" }}>
                  {comparing ? "Comparing..." : "Compare now"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
      {compareError ? (
        <p className="text-xs" role="alert" style={{ color: "var(--status-critical)" }}>
          {compareError}
        </p>
      ) : null}
    </Panel>
  );
}

function AspectList({ rows, sentiment }: { rows: AspectSummary[]; sentiment: "positive" | "negative" }) {
  const color = sentiment === "positive" ? "var(--sentiment-positive)" : "var(--sentiment-negative)";
  const max = Math.max(1, ...rows.map((r) => r.share));
  if (!rows.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Nothing {sentiment === "positive" ? "praised" : "criticised"} in this period.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.aspect} className="flex flex-col gap-1">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-2">
            <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {r.aspect}
            </span>
            <span className="h-2 rounded" style={{ background: "var(--page-plane)" }}>
              <span className="block h-2 rounded" style={{ width: `${(r.share / max) * 100}%`, background: color }} />
            </span>
            <span className="text-right text-xs tabular" style={{ color: "var(--text-secondary)" }} title={`${r.count} reviews`}>
              {r.share}%
            </span>
          </div>
          {r.quotes.slice(0, 2).map((q) => (
            <p key={q} className="truncate pl-2 text-xs italic" style={{ color: "var(--text-muted)", borderLeft: `2px solid ${color}` }} title={q}>
              &ldquo;{q}&rdquo;
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** Section: what customers say in the project's Google Maps reviews. */
export function CustomersSection({ projectId, brandName, onOpenReviews }: { projectId: number; brandName: string; onOpenReviews: () => void }) {
  const [range, setRange] = useState<"90" | "180" | "365" | "all">("365");
  const { data, error } = useCustomers(projectId, range);

  if (error) {
    return (
      <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading customer reviews…
      </p>
    );
  }
  const v = data.voice;
  const t = v.totals;
  const l = v.listing;
  const share = (n: number) => (t.analysed ? `${Math.round((n / t.analysed) * 100)}%` : "–");

  if (!l) {
    return (
      <EmptyState
        title="No Google Maps reviews for this project"
        body="Brand Mentions reads the project's Google Maps reviews. Add the Google Maps link in Project settings, then fetch and analyse the reviews in Local SEO → Maps reviews. Tripadvisor and Google Hotels aren't connected."
        action={
          <button type="button" onClick={onOpenReviews} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--series-1)" }}>
            Open Maps reviews
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectControl
          ariaLabel="Review period"
          value={range}
          onChange={setRange}
          options={[
            { value: "90", label: "Last 90 days" },
            { value: "180", label: "Last 6 months" },
            { value: "365", label: "Last 12 months" },
            { value: "all", label: "All saved reviews" },
          ]}
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Google Maps reviews of {brandName} ({l.name}) · {l.stored.toLocaleString()} saved
          {v.lastSyncedAt ? ` · last fetched ${fmtDate(v.lastSyncedAt)}` : " · not fetched yet"}
        </span>
        <button type="button" onClick={onOpenReviews} className="ml-auto text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
          Open Maps reviews
        </button>
      </div>

      {t.reviews > 0 ? (
        <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border p-4 md:grid-cols-6" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }} aria-label="Customer review headline numbers">
          <Headline label="Reviews" value={t.reviews.toLocaleString()} />
          <Headline label="Average rating" value={t.avgRating === null ? "–" : t.avgRating.toFixed(2)} />
          <Headline label="Customer score" value={t.score === null ? "–" : `${Math.round(t.score)}/100`} />
          <Headline label="Positive" value={share(t.sentiment.positive)} />
          <Headline label="Negative" value={share(t.sentiment.negative)} />
          <Headline label="Owner replies" value={t.responseRate === null ? "–" : `${Math.round(t.responseRate)}%`} />
        </section>
      ) : (
        <EmptyState title="No saved reviews in this period" body="Pick a longer period, or fetch reviews in Local SEO → Maps reviews." />
      )}
      {t.reviews > 0 && t.analysed < t.reviews ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t.analysed.toLocaleString()} of {t.reviews.toLocaleString()} reviews in this period are analysed; sentiment shares and the lists below use the analysed ones. The average rating uses all of them.
        </p>
      ) : null}

      {t.analysed > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="What customers praise" subtitle="share of analysed reviews making each point">
            <AspectList rows={v.praise} sentiment="positive" />
          </Panel>
          <Panel title="What customers criticise" subtitle="share of analysed reviews making each point">
            <AspectList rows={v.criticism} sentiment="negative" />
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
