"use client";

// Costs & limits for Brand Mentions, ported from the AI Brand Mention app. Spend comes from the SEO Console ledger
// (estimated from recorded token usage, with the pricing version); the limits are the server's allowances and
// aren't edited here. No weekly schedule in this phase.

import { useState } from "react";
import type { CostReport } from "@/lib/ai-area/brand/costs";
import { PLATFORMS, PLATFORM_LABEL, type BrandSettings, type Platform } from "@/lib/ai-area/brand/types";
import { Panel, Switch } from "../tracking/ui";
import { PlatformIcon } from "./BrandCards";

const usd = (v: number) => (v < 0.1 && v > 0 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);

export function CostsPanel({
  costs,
  settings,
  onSave,
}: {
  costs: CostReport;
  settings: BrandSettings;
  onSave: (patch: Partial<BrandSettings>) => Promise<void>;
}) {
  const [, setSaving] = useState(false);
  const limit = costs.limit;
  const usedPct = limit != null && limit > 0 ? Math.min(100, (costs.today.totalUsd / limit) * 100) : 0;
  const save = async (patch: Partial<BrandSettings>) => {
    setSaving(true);
    try {
      await onSave(patch);
    } finally {
      setSaving(false);
    }
  };
  const maxRecent = Math.max(limit ?? 0, ...costs.recent.map((d) => d.totalUsd), 0.01);
  const serpLeft = costs.serp.allowed && costs.serp.max != null && costs.serp.used != null ? Math.max(0, costs.serp.max - costs.serp.used) : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title="Daily model spending limit" subtitle="ChatGPT + Claude + analysis, for your account across projects (UTC day); estimated from token usage">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Spent today
            </span>
            <span className="tabular text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {usd(costs.today.totalUsd)}
              <span className="text-base font-normal" style={{ color: "var(--text-muted)" }}>
                {" "}
                {limit != null ? `of ${usd(limit)}` : ""}
              </span>
            </span>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              OpenAI {usd(costs.today.byProvider.openai)} · Anthropic {usd(costs.today.byProvider.anthropic)} · {costs.today.calls} calls
            </span>
          </div>
          <span className="max-w-xs text-xs" style={{ color: "var(--text-secondary)" }}>
            {costs.llmPolicy.scope}
            {costs.llmPolicy.allowed ? ". Set on the server (AI_AREA_DAILY_USD_LIMIT)." : ""}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--meter-track)" }} role="img" aria-label={`${Math.round(usedPct)}% of today's limit used`}>
          <div className="h-full rounded-full" style={{ width: `${usedPct}%`, background: usedPct >= 90 ? "var(--status-critical)" : "var(--series-1)" }} />
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          When the limit is reached, the run pauses; answers collected so far are kept and Run continues the same cycle (the next day, once the limit resets). SerpApi requests are capped separately, below. Prices: {costs.pricingVersion}.
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Last 14 days
          </span>
          <div className="flex h-16 items-end gap-1" role="img" aria-label="Daily spend, last 14 days">
            {costs.recent.map((d) => (
              <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end" title={`${d.day}: ${usd(d.totalUsd)}`}>
                <div className="w-full rounded-t" style={{ height: `${Math.max(2, (d.totalUsd / maxRecent) * 100)}%`, background: d.totalUsd ? "var(--series-1)" : "var(--gridline)" }} />
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Projected cost per run" subtitle={`${costs.promptCount} active prompts × ${costs.platforms.length} platforms; runs start only when you click Run`}>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Model calls per run (estimated)", value: usd(costs.perRun.total) },
            { label: "SerpApi requests per run (at most)", value: String(costs.perRun.serpCredits) },
          ].map((s) => (
            <div key={s.label} className="flex flex-col rounded-lg border px-3 py-2" style={{ borderColor: "var(--border-hairline)" }}>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {s.label}
              </span>
              <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
        <table className="w-full text-xs">
          <tbody>
            {[
              { label: `ChatGPT (${settings.chatgptModel})`, value: costs.perRun.chatgpt, basis: costs.basis.chatgpt, on: settings.platforms.chatgpt },
              { label: `Claude (${settings.claudeModel})`, value: costs.perRun.claude, basis: costs.basis.claude, on: settings.platforms.claude },
              { label: "Answer analysis (OpenAI)", value: costs.perRun.analysis, basis: "estimate" as const, on: true },
            ].map((r) => (
              <tr key={r.label} className="border-t" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", opacity: r.on ? 1 : 0.5 }}>
                <td className="py-1.5">{r.label}</td>
                <td className="py-1.5 text-right" style={{ color: "var(--text-muted)" }}>
                  {r.on ? (r.basis === "observed" ? "from last run" : "estimate") : "off"}
                </td>
                <td className="tabular py-1.5 text-right" style={{ color: "var(--text-primary)" }}>
                  {usd(r.value)}
                </td>
              </tr>
            ))}
            <tr className="border-t" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
              <td className="py-1.5">SerpApi (AI Mode + AI Overview)</td>
              <td />
              <td className="tabular py-1.5 text-right" style={{ color: "var(--text-primary)" }}>
                {costs.perRun.serpCredits} requests / run
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {costs.runsLeftToday !== null && limit != null && costs.perRun.total > limit
            ? `One run costs more than the daily limit, so each run spreads over about ${Math.ceil(costs.perRun.total / Math.max(0.01, limit))} days.`
            : costs.runsLeftToday !== null
              ? `Today's remaining budget covers about ${costs.runsLeftToday.toFixed(1)} runs.`
              : ""}{" "}
          Estimates use typical web-search answers (search results count as input tokens); after a run they switch to the real average cost.
        </p>
      </Panel>

      <Panel title="SerpApi limit" subtitle="Google AI Mode and AI Overview answers, shared with Google Search Tracking">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {costs.serp.scope}
          {serpLeft != null ? `: ${costs.serp.used} used, ${serpLeft} left.` : "."}
        </p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Every request is recorded before it&apos;s sent, including retries and the second request that loads an AI Overview. Details in AI Area → Usage &amp; Costs.
        </p>
      </Panel>

      <Panel title="Platforms">
        <div className="flex flex-col gap-3">
          {PLATFORMS.map((p: Platform) => (
            <div key={p} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm" style={{ color: "var(--text-primary)" }}>
                <PlatformIcon platform={p} />
                {PLATFORM_LABEL[p]}
                {costs.unavailable[p] ? (
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }} title={costs.unavailable[p] ?? undefined}>
                    unavailable here
                  </span>
                ) : null}
              </span>
              <Switch checked={settings.platforms[p]} onChange={(v) => void save({ platforms: { ...settings.platforms, [p]: v } })} label={`Track ${PLATFORM_LABEL[p]}`} />
            </div>
          ))}
          <p className="border-t pt-3 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-muted)" }}>
            Scheduled runs are off in this phase; runs start only from Run.
          </p>
        </div>
      </Panel>

      <Panel title="Models" subtitle="projected per run with your current prompts">
        {(["openai", "anthropic"] as const).map((provider) => (
          <div key={provider} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              {provider === "openai" ? "ChatGPT (OpenAI, with web search)" : "Claude (Anthropic, with web search)"}
            </span>
            {costs.models
              .filter((m) => m.provider === provider)
              .map((m) => {
                const current = provider === "openai" ? settings.chatgptModel === m.id : settings.claudeModel === m.id;
                return (
                  <label key={m.id} className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: current ? "var(--series-1)" : "var(--border-hairline)" }}>
                    <span className="flex items-start gap-2">
                      <input type="radio" name={provider} checked={current} onChange={() => void save(provider === "openai" ? { chatgptModel: m.id } : { claudeModel: m.id })} className="mt-1" />
                      <span className="flex flex-col">
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {m.label}
                        </span>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {m.note}
                        </span>
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-right text-xs" style={{ color: "var(--text-secondary)" }}>
                      ≈{usd(m.perAnswer)}/answer
                      <br />
                      {usd(m.perRun)}/run
                    </span>
                  </label>
                );
              })}
          </div>
        ))}
      </Panel>
    </div>
  );
}
