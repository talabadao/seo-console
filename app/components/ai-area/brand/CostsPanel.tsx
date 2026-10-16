"use client";

// Platforms & cost estimate for Brand Mentions, ported from the AI Brand Mention app's "Costs & limits".
// Budgets and spending limits are configured in one place — Settings → Account → Budgets & limits (and
// Project settings → Budgets) — so this panel shows the run-cost estimate, which limits apply and how much is
// left, and links there. Platforms and models are Brand Mentions settings and stay here.

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
  onOpenBudgets,
}: {
  costs: CostReport;
  settings: BrandSettings;
  onSave: (patch: Partial<BrandSettings>) => Promise<void>;
  onOpenBudgets: () => void;
}) {
  const [, setSaving] = useState(false);
  const save = async (patch: Partial<BrandSettings>) => {
    setSaving(true);
    try {
      await onSave(patch);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
          {costs.runsLeft !== null ? `Your tightest model limit covers about ${costs.runsLeft.toFixed(1)} more runs. ` : ""}
          Estimates use typical web-search answers (search results count as input tokens); after a run they switch to the real average cost.
        </p>
      </Panel>

      <Panel
        title="Limits that apply"
        subtitle="set in Settings, shared with Google Search Tracking"
        actions={
          <button type="button" onClick={onOpenBudgets} className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
            Manage usage and budget
          </button>
        }
      >
        <ul className="flex flex-col gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          {!costs.serp.allowed ? (
            <li>SerpApi: {costs.serp.scope}</li>
          ) : costs.serp.limits.length ? (
            costs.serp.limits.map((l) => (
              <li key={l.label}>
                SerpApi — {l.label}: <strong>{l.left.toLocaleString("en-US")}</strong> left
              </li>
            ))
          ) : (
            <li>SerpApi: no limit set.</li>
          )}
          {!costs.llmPolicy.allowed ? (
            <li>Models: {costs.llmPolicy.scope}</li>
          ) : costs.llmPolicy.limits.length ? (
            costs.llmPolicy.limits.map((l) => (
              <li key={l.label}>
                Models — {l.label}: <strong>{usd(l.left)}</strong> left (estimated)
              </li>
            ))
          ) : (
            <li>Models: no spending limit set.</li>
          )}
        </ul>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          A run stops when a limit is reached; answers collected by then are kept. Every request is recorded before it&apos;s sent, including retries and the
          second request that loads an AI Overview.
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
