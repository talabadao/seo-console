"use client";

import { useEffect, useMemo, useState } from "react";
import { PLATFORMS, PLATFORM_LABEL, type BrandResponse, type Cycle, type CycleSummary, type Platform } from "@/lib/ai-area/brand/types";
import { Favicon } from "../tracking/Favicon";
import { Panel } from "../tracking/ui";
import { PlatformIcon } from "./BrandCards";

const field: React.CSSProperties = { borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" };

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Answer text with the tracked brand highlighted and competitors underlined. */
function Highlighted({ text, brand, others }: { text: string; brand: string[]; others: string[] }) {
  const terms = [...brand.map((t) => ({ t, kind: "brand" })), ...others.map((t) => ({ t, kind: "other" }))].filter((x) => x.t.trim().length > 2);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((x) => escapeRegExp(x.t)).join("|")})`, "gi");
  const kindOf = (s: string) => terms.find((x) => x.t.toLowerCase() === s.toLowerCase())?.kind;
  return (
    <>
      {text.split(re).map((part, i) => {
        const kind = kindOf(part);
        if (kind === "brand")
          return (
            <mark key={i} className="rounded px-0.5" style={{ background: "color-mix(in srgb, var(--series-1) 22%, transparent)", color: "var(--text-primary)" }}>
              {part}
            </mark>
          );
        if (kind === "other")
          return (
            <span key={i} className="underline decoration-dotted underline-offset-2">
              {part}
            </span>
          );
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function AnswerCard({ r, brand, others }: { r: BrandResponse | undefined; brand: string[]; others: string[] }) {
  if (!r) return <p className="text-sm" style={{ color: "var(--text-muted)" }}>Not collected yet in this run.</p>;
  if (r.error) return <p className="text-sm" style={{ color: "var(--status-critical)" }}>{r.error}</p>;
  if (!r.present) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {r.platform === "aiOverview" ? "Google showed no AI Overview for this query." : "No answer returned."}
      </p>
    );
  }
  const a = r.analysis;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        {a ? (
          <span className="rounded-full border px-2 py-0.5" style={{ borderColor: a.brandMentioned ? "var(--sentiment-positive)" : "var(--border-hairline)" }}>
            {a.brandMentioned ? `Mentioned${a.brandPosition ? ` · #${a.brandPosition}` : ""}` : "Not mentioned"}
          </span>
        ) : (
          <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--border-hairline)" }} title={r.analysisError}>
            Not analysed{r.analysisError ? `: ${r.analysisError}` : ""}
          </span>
        )}
        {a?.brandSentiment !== null && a?.brandSentiment !== undefined ? <span>Sentiment {a.brandSentiment}/100</span> : null}
        {a?.brands.length ? <span>Brands: {a.brands.map((b) => b.name).join(", ")}</span> : null}
        {r.model ? <span style={{ color: "var(--text-muted)" }}>{r.model}</span> : null}
        {r.costUsd > 0 ? <span style={{ color: "var(--text-muted)" }}>${r.costUsd.toFixed(3)}</span> : null}
        {r.serpCredits ? <span style={{ color: "var(--text-muted)" }}>{r.serpCredits} SerpApi request{r.serpCredits === 1 ? "" : "s"}</span> : null}
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
        <Highlighted text={r.text} brand={brand} others={others} />
      </div>
      {a?.claims.length ? (
        <ul className="flex flex-col gap-1">
          {a.claims.map((c, i) => (
            <li key={i} className="text-xs" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: c.sentiment === "positive" ? "var(--success-text)" : c.sentiment === "negative" ? "var(--status-critical)" : "var(--text-muted)" }}>
                {c.sentiment === "positive" ? "+" : c.sentiment === "negative" ? "−" : "·"}
              </span>{" "}
              <b>{c.claim}</b> ({c.attribute}, {c.kind}) - {c.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {r.sources.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Sources ({r.sources.length})
          </span>
          <ol className="flex flex-col gap-1">
            {r.sources.map((s, i) => (
              <li key={s.url} className="flex min-w-0 items-center gap-2 text-xs">
                <span className="tabular w-4 shrink-0 text-right" style={{ color: "var(--text-muted)" }}>
                  {i + 1}
                </span>
                <Favicon domain={s.domain} size={14} />
                <a href={s.url} target="_blank" rel="noreferrer" className="truncate hover:underline" style={{ color: "var(--text-secondary)" }} title={s.url}>
                  {s.title || s.domain}
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** Every answer from the four platforms for each prompt in a run, in full, with sources. */
export function ResponsesPanel({ projectId, cycles, brandTerms, otherBrands }: { projectId: number; cycles: CycleSummary[]; brandTerms: string[]; otherBrands: string[] }) {
  const [cycleId, setCycleId] = useState<string | null>(cycles.at(-1)?.id ?? null);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [promptId, setPromptId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>("chatgpt");
  const [query, setQuery] = useState("");
  const [onlyMentioned, setOnlyMentioned] = useState<"all" | "mentioned" | "missing">("all");

  useEffect(() => {
    if (!cycleId) return;
    let cancelled = false;
    async function load(id: string) {
      const res = await fetch(`/api/ai-area/${projectId}/brand/cycle?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { cycle?: Cycle };
      if (!cancelled) setCycle(data.cycle ?? null);
    }
    void load(cycleId);
    return () => {
      cancelled = true;
    };
  }, [projectId, cycleId]);

  const rows = useMemo(() => {
    if (!cycle) return [];
    const q = query.trim().toLowerCase();
    return Object.entries(cycle.prompts)
      .map(([id, p]) => {
        const responses = cycle.responses.filter((r) => r.promptId === id);
        const mentioned = responses.filter((r) => r.analysis?.brandMentioned).length;
        return { id, ...p, responses, mentioned };
      })
      .filter((r) => !q || r.text.toLowerCase().includes(q))
      .filter((r) => onlyMentioned === "all" || (onlyMentioned === "mentioned" ? r.mentioned > 0 : r.mentioned === 0));
  }, [cycle, query, onlyMentioned]);
  const current = rows.find((r) => r.id === promptId) ?? rows[0];
  const platforms = PLATFORMS.filter((p) => cycle?.plan.some((t) => t.platform === p));
  const shownPlatform = platforms.includes(platform) ? platform : platforms[0];

  if (!cycles.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        No runs yet - add prompts and click Run now.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Panel title="Prompts" subtitle={cycle ? `${Object.keys(cycle.prompts).length} in this run` : ""} bodyClassName="flex flex-col gap-2 p-3">
        <select value={cycleId ?? ""} onChange={(e) => setCycleId(e.target.value)} className="rounded-md border px-2 py-1.5 text-xs" style={field} aria-label="Run">
          {[...cycles].reverse().map((c) => (
            <option key={c.id} value={c.id}>
              Run {new Date(c.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {c.done}/{c.total}
              {c.status !== "done" ? ` (${c.status === "paused-budget" ? "paused" : "in progress"})` : ""}
            </option>
          ))}
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompts" className="rounded-md border px-2 py-1.5 text-xs outline-none" style={field} aria-label="Search prompts" />
        <select value={onlyMentioned} onChange={(e) => setOnlyMentioned(e.target.value as typeof onlyMentioned)} className="rounded-md border px-2 py-1.5 text-xs" style={field} aria-label="Mention filter">
          <option value="all">All prompts</option>
          <option value="mentioned">Brand mentioned</option>
          <option value="missing">Brand not mentioned</option>
        </select>
        <ul className="flex max-h-[560px] flex-col overflow-auto">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setPromptId(r.id)}
                className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left text-xs"
                style={{ background: current?.id === r.id ? "var(--page-plane)" : "transparent", color: "var(--text-primary)" }}
              >
                <span>
                  {r.text}
                  <span className="block" style={{ color: "var(--text-muted)" }}>
                    {r.topic} · {r.branded ? "branded" : "unbranded"}
                  </span>
                </span>
                <span className="tabular shrink-0" style={{ color: r.mentioned ? "var(--success-text)" : "var(--text-muted)" }} title="Platforms that mentioned your brand">
                  {r.mentioned}/{r.responses.length}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title={current ? current.text : "Answers"}
        actions={
          <div className="flex gap-1">
            {platforms.map((p) => {
              const r = current?.responses.find((x) => x.platform === p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  aria-pressed={shownPlatform === p}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                  style={{
                    borderColor: shownPlatform === p ? "var(--text-primary)" : "var(--border-hairline)",
                    color: "var(--text-primary)",
                    background: shownPlatform === p ? "var(--page-plane)" : "transparent",
                  }}
                >
                  <PlatformIcon platform={p} size={14} />
                  <span className="hidden sm:inline">{PLATFORM_LABEL[p]}</span>
                  {r?.analysis?.brandMentioned ? <span style={{ color: "var(--success-text)" }}>●</span> : null}
                </button>
              );
            })}
          </div>
        }
      >
        {current && shownPlatform ? (
          <AnswerCard r={current.responses.find((x) => x.platform === shownPlatform)} brand={brandTerms} others={otherBrands} />
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {cycle ? "No prompts match." : "Loading..."}
          </p>
        )}
      </Panel>
    </div>
  );
}
