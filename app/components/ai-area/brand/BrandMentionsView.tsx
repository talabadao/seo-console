"use client";

// Brand Mentions, ported from the AI Brand Mention app (src/components/brand/BrandMentionsView.tsx).
// Changes for SEO Console:
// - Works on the open SEO Console project; the section is part of the address (via `sub` / `onSub`).
// - Data from /api/ai-area/<id>/brand (Postgres, owner-only). No placeholder answers: a platform that can't be
//   asked (policy, missing key) says why, and answers that couldn't be analysed are shown as such.
// - "Run" shows the estimate (answers, SerpApi requests, model spend) and the limits first, then runs in chunks.
// - No weekly schedule in this phase.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CostReport } from "@/lib/ai-area/brand/costs";
import type { Dashboard } from "@/lib/ai-area/brand/dashboard";
import type { BrandActual, BrandEstimate } from "@/lib/ai-area/brand/run";
import { PLATFORMS, PLATFORM_LABEL, type BrandPrompt, type BrandSettings, type Cycle, type CycleSummary, type FactVerdict, type Platform } from "@/lib/ai-area/brand/types";
import type { TrackedBrand } from "@/lib/ai-area/tracking/types";
import { EmptyState, IconCalendar, IconLayers, SelectControl } from "../tracking/ui";
import { AttributesGrid, BrandFacts, HeadToHead, PerceptionCard, SentimentTrend, SourceSentiment } from "./BrandCards";
import { CostsPanel } from "./CostsPanel";
import { AiVsCustomersCard, CustomersSection } from "./CustomersPanel";
import { PromptsPanel } from "./PromptsPanel";
import { ResponsesPanel } from "./ResponsesPanel";

type Section = "dashboard" | "customers" | "prompts" | "responses" | "costs";
type Range = "30" | "90" | "180" | "365" | "all";

interface Payload {
  dashboard: Dashboard;
  settings: BrandSettings;
  costs: CostReport;
  brand: TrackedBrand;
  competitors: Array<{ name: string; website: string }>;
  allCycles: CycleSummary[];
  estimate: BrandEstimate & { continues: string | null };
}

/** Readable slugs for the address. */
const SECTION_SLUG: Record<Section, string> = { dashboard: "", customers: "customer-reviews", prompts: "prompts", responses: "ai-answers", costs: "costs" };
const SECTION_BY_SLUG: Record<string, Section> = Object.fromEntries(Object.entries(SECTION_SLUG).map(([k, v]) => [v, k as Section]));

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "customers", label: "Customer reviews" },
  { id: "prompts", label: "Prompts" },
  { id: "responses", label: "AI answers" },
  { id: "costs", label: "Platforms & cost estimate" },
];

/**
 * Brand Mentions: what Google AI Mode, AI Overview, ChatGPT and Claude say about the project's brand for a set of
 * prompts - perception, sentiment over time, head-to-head with competitors, attributes, facts and sources - next to
 * what customers say in the project's Google Maps reviews.
 */
export function BrandMentionsView({
  projectId,
  sub,
  onSub,
  onOpenTrackingSettings,
  onOpenReviews,
  onOpenBudgets,
}: {
  projectId: number;
  sub?: string;
  onSub?: (sub: string) => void;
  onOpenTrackingSettings: () => void;
  onOpenReviews: () => void;
  onOpenBudgets: () => void;
}) {
  const section: Section = SECTION_BY_SLUG[sub ?? ""] ?? "dashboard";
  const setSection = (next: Section) => onSub?.(SECTION_SLUG[next]);
  const [range, setRange] = useState<Range>("90");
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [promptType, setPromptType] = useState<"all" | "branded" | "unbranded">("all");
  const [topic, setTopic] = useState("all");
  const [data, setData] = useState<Payload | null>(null);
  const [prompts, setPrompts] = useState<BrandPrompt[] | null>(null);
  const [maxPrompts, setMaxPrompts] = useState(200);
  const [latestCycle, setLatestCycle] = useState<Cycle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const stopRef = useRef(false);
  const api = `/api/ai-area/${projectId}/brand`;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ range, platform, type: promptType, topic });
    const res = await fetch(`/api/ai-area/${projectId}/brand?${params}`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Payload & { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Couldn't load brand mentions");
      return;
    }
    setError(null);
    setData(body);
  }, [projectId, range, platform, promptType, topic]);

  const loadPrompts = useCallback(async () => {
    const res = await fetch(`/api/ai-area/${projectId}/brand/prompts`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { prompts?: BrandPrompt[]; max?: number };
    setPrompts(body.prompts ?? []);
    if (body.max) setMaxPrompts(body.max);
  }, [projectId]);

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

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) await loadPrompts();
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadPrompts]);

  // Latest run's answers, for the per-prompt "mentioned" column.
  const latestId = data?.allCycles.at(-1)?.id;
  const latestDone = data?.allCycles.at(-1)?.done;
  useEffect(() => {
    if (!latestId) return;
    let cancelled = false;
    async function run(id: string) {
      const res = await fetch(`/api/ai-area/${projectId}/brand/cycle?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { cycle?: Cycle };
      if (!cancelled) setLatestCycle(body.cycle ?? null);
    }
    void run(latestId);
    return () => {
      cancelled = true;
    };
  }, [projectId, latestId, latestDone]);

  const mentionRate = useMemo(() => {
    const out: Record<string, { mentioned: number; answered: number }> = {};
    for (const r of latestCycle?.responses ?? []) {
      const e = (out[r.promptId] ??= { mentioned: 0, answered: 0 });
      if (r.present) e.answered++;
      if (r.analysis?.brandMentioned) e.mentioned++;
    }
    return out;
  }, [latestCycle]);

  /** Runs in chunks (each call stops before the server time limit) until the run is finished or stopped. */
  async function runNow() {
    setConfirming(false);
    setRunning(true);
    setRunMessage("Starting…");
    stopRef.current = false;
    try {
      let runId: string | null = null;
      for (let i = 0; i < 100; i++) {
        if (stopRef.current && runId) {
          setRunMessage("Paused between batches. The run is released after 20 minutes without progress; Run again then to continue the same cycle.");
          break;
        }
        const res = await fetch(`${api}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(runId ? { runId } : {}) });
        const body = (await res.json().catch(() => ({}))) as { runId?: string; finished?: boolean; status?: string; error?: string | null; actual?: BrandActual; cycle?: CycleSummary | null };
        if (!res.ok) throw new Error(body.error || `Run failed (status ${res.status})`);
        runId = body.runId ?? runId;
        const c = body.cycle;
        const a = body.actual;
        const spent = a ? ` · ${a.serpRequests} SerpApi requests · $${a.costUsd.toFixed(3)} estimated model spend` : "";
        if (body.status === "busy") {
          setRunMessage("Another tab is working on this run; waiting…");
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (body.finished) {
          setRunMessage(
            body.status === "done"
              ? `Run finished: ${c?.done ?? 0} answers${spent}.${c?.note ? ` ${c.note}` : ""}`
              : `Run ${body.status}: ${body.error ?? ""}${spent}. Answers collected so far are kept.`,
          );
          await load();
          break;
        }
        setRunMessage(`Collecting answers… ${c?.done ?? 0} of ${c?.total ?? "?"}${spent}`);
        await load();
      }
    } catch (err) {
      setRunMessage(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function setVerdict(key: string, verdict: FactVerdict | null) {
    setData((d) => (d ? { ...d, dashboard: { ...d.dashboard, facts: d.dashboard.facts.map((f) => (f.key === key ? { ...f, verdict } : f)) } } : d));
    await fetch(`${api}/facts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, verdict }) });
  }

  async function saveSettings(patch: Partial<BrandSettings>) {
    await fetch(api, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    await load();
  }

  if (error) {
    return (
      <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
        {error}
      </p>
    );
  }
  if (!data || prompts === null) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading brand mentions...
      </p>
    );
  }

  const d = data.dashboard;
  const current = data.allCycles.at(-1);
  const unfinished = current && current.status !== "done" ? current : null;
  const brandName = data.brand.name;
  const brandTerms = [data.brand.name, ...data.brand.aliases].filter(Boolean);
  const otherBrands = [...new Set([...data.competitors.map((c) => c.name), ...d.brands.filter((b) => !b.isTarget).map((b) => b.name)])];
  const activePrompts = prompts.filter((p) => p.active).length;
  const unavailable = PLATFORMS.filter((p) => data.settings.platforms[p] && data.costs.unavailable[p]);
  const est = data.estimate;
  const serp = data.costs.serp;
  // The tightest SerpApi limit that applies (Preview smoke test, project per month, account per month).
  const serpLeft = serp.allowed ? serp.left : null;
  const modelLeft = data.costs.modelLeft;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg p-0.5" style={{ background: "var(--page-plane)", border: "1px solid var(--border-hairline)" }} role="tablist" aria-label="Brand mentions sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              onClick={() => setSection(s.id)}
              className="rounded-md px-3 py-1 text-xs font-medium"
              style={{ background: section === s.id ? "var(--surface-1)" : "transparent", color: section === s.id ? "var(--text-primary)" : "var(--text-muted)", boxShadow: section === s.id ? "0 1px 2px rgba(0,0,0,0.08)" : undefined }}
            >
              {s.label}
              {s.id === "prompts" ? ` (${activePrompts})` : ""}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {!data.costs.llmPolicy.allowed
              ? "Paid model calls are off here"
              : modelLeft != null
                ? `$${modelLeft.toFixed(2)} of model spend left under your limits (estimated)`
                : "No model spending limit set"}
            {serpLeft != null ? ` · ${serpLeft} SerpApi requests left under your limits` : ""} ·{" "}
            <button type="button" className="underline" onClick={onOpenBudgets}>
              Manage usage and budget
            </button>
          </span>
          {running ? (
            <button type="button" onClick={() => (stopRef.current = true)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
              Stop after this batch
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={running || confirming}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {running ? "Running…" : unfinished ? `Continue run (${unfinished.done}/${unfinished.total})` : "Run brand check now"}
          </button>
        </div>
      </div>

      {confirming && (
        <div role="dialog" aria-label="Confirm brand check" className="rounded-lg border p-4 text-sm" style={{ borderColor: "var(--series-1)", background: "var(--surface-1)" }}>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {est.answers
              ? `${est.continues ? "Continue the unfinished run" : "Run a brand check"}: ${est.answers} answer${est.answers === 1 ? "" : "s"} (${est.prompts} prompt${est.prompts === 1 ? "" : "s"} on ${est.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")})?`
              : "Nothing can run right now."}
          </p>
          {est.answers > 0 && (
            <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
              Estimated: {est.serpRequests.min === est.serpRequests.max ? est.serpRequests.max : `${est.serpRequests.min}–${est.serpRequests.max}`} SerpApi requests
              {est.platforms.some((p) => p === "chatgpt" || p === "claude" ) || est.modelUsd > 0 ? ` and about $${est.modelUsd.toFixed(2)} of model calls (answers and their analysis)` : ""}.
            </p>
          )}
          <p className="mt-1" style={{ color: serpLeft != null && serpLeft < est.serpRequests.max ? "var(--status-critical)" : "var(--text-secondary)" }}>
            {serp.scope}.{serpLeft != null ? ` ${serpLeft} left.` : ""}
            {serpLeft != null && serpLeft < est.serpRequests.max ? " The run stops when the allowance runs out; answers fetched by then are kept." : ""}
          </p>
          <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
            {data.costs.llmPolicy.scope}
            {!data.costs.llmPolicy.allowed ? " Answers are stored without analysis (mentions, sentiment and claims need the analysis model)." : ""}
          </p>
          {Object.entries(est.unavailable).map(([p, why]) => (
            <p key={p} className="mt-1" style={{ color: "var(--text-muted)" }}>
              {PLATFORM_LABEL[p as Platform]} skipped: {why}
            </p>
          ))}
          <div className="mt-3 flex gap-2">
            {est.answers > 0 && (
              <button type="button" onClick={() => void runNow()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--series-1)" }}>
                Run now
              </button>
            )}
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--border-hairline)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {runMessage || unfinished?.note ? (
        <div className="rounded-lg border px-4 py-2.5 text-sm" role="status" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
          {runMessage ?? unfinished?.note}
        </div>
      ) : null}
      {unavailable.length ? (
        <div className="rounded-lg border px-4 py-2.5 text-xs" role="note" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
          {unavailable.map((p) => (
            <p key={p}>
              <strong>{PLATFORM_LABEL[p]}</strong> unavailable: {data.costs.unavailable[p]}
            </p>
          ))}
        </div>
      ) : null}

      {!brandName ? (
        <EmptyState
          title="Set your brand first"
          body="Brand Mentions uses the brand name, aliases and competitors from Google Search Tracking → Settings."
          action={
            <button type="button" onClick={onOpenTrackingSettings} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--series-1)" }}>
              Open settings
            </button>
          }
        />
      ) : section === "customers" ? (
        <CustomersSection projectId={projectId} brandName={brandName} onOpenReviews={onOpenReviews} />
      ) : section === "prompts" ? (
        <PromptsPanel projectId={projectId} prompts={prompts} max={maxPrompts} brandName={brandName} onChange={setPrompts} mentionRate={mentionRate} />
      ) : section === "responses" ? (
        <ResponsesPanel key={data.allCycles.length} projectId={projectId} cycles={data.allCycles} brandTerms={brandTerms} otherBrands={otherBrands} />
      ) : section === "costs" ? (
        <CostsPanel costs={data.costs} settings={data.settings} onSave={saveSettings} onOpenBudgets={onOpenBudgets} />
      ) : data.allCycles.length === 0 ? (
        <EmptyState
          title={prompts.length ? "No brand check yet" : "Add the prompts to track"}
          body={
            prompts.length
              ? `Run a brand check to ask ${activePrompts} prompt${activePrompts === 1 ? "" : "s"} on the enabled platforms. Runs start only when you click Run.`
              : "Add questions people ask AI about your brand, products and category - type them or upload a CSV (suggestions need the OpenAI key)."
          }
          action={
            <button
              type="button"
              onClick={() => (prompts.length ? setConfirming(true) : setSection("prompts"))}
              disabled={running}
              className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--series-1)" }}
            >
              {prompts.length ? "Run brand check now" : "Add prompts"}
            </button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SelectControl
              ariaLabel="Date range"
              icon={<IconCalendar />}
              value={range}
              onChange={setRange}
              options={[
                { value: "30", label: "Last 30 days" },
                { value: "90", label: "Last 90 days" },
                { value: "180", label: "Last 6 months" },
                { value: "365", label: "Last 12 months" },
                { value: "all", label: "All time" },
              ]}
            />
            <SelectControl
              ariaLabel="Platform"
              icon={<IconLayers />}
              value={platform}
              onChange={setPlatform}
              options={[{ value: "all" as const, label: "All platforms" }, ...PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))]}
            />
            <SelectControl
              ariaLabel="Prompt type"
              value={promptType}
              onChange={setPromptType}
              options={[
                { value: "all", label: "Branded & Unbranded" },
                { value: "branded", label: "Branded" },
                { value: "unbranded", label: "Unbranded" },
              ]}
            />
            <SelectControl ariaLabel="Topic" value={topic} onChange={setTopic} options={[{ value: "all", label: "All topics" }, ...d.topics.map((t) => ({ value: t, label: t }))]} />
            <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
              {d.answers.unanalysed > 0
                ? `Latest run: ${d.answers.collected} answers collected, ${d.answers.unanalysed} not analysed; ${d.answers.literal} name ${brandName} word for word`
                : `Latest run: ${d.answers.mentioned} of ${d.answers.present} answers mention ${brandName}`}
            </span>
          </div>
          <PerceptionCard data={d} brandName={brandName} platform={platform} />
          <AiVsCustomersCard projectId={projectId} aiScore={d.perception.score} hasRuns={data.allCycles.some((c) => c.done > 0)} onOpenSection={() => setSection("customers")} onOpenReviews={onOpenReviews} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <SentimentTrend trend={d.trend} />
            <HeadToHead brands={d.brands} websites={Object.fromEntries([[brandName, data.brand.website], ...data.competitors.map((c) => [c.name, c.website])])} />
            <AttributesGrid attributes={d.attributes} />
            <BrandFacts facts={d.facts} onVerdict={(k, v) => void setVerdict(k, v)} />
          </div>
          <SourceSentiment sources={d.sources} brandName={brandName} />
        </>
      )}
    </div>
  );
}
