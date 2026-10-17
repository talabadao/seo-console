"use client";

import { useState } from "react";
import type { SeAudit } from "@/lib/seranking/donor/types";
import { Delta, EmptyState, Headline, Panel, Segmented } from "../ai-area/tracking/ui";
import { Th, fmtDate, fmtInt } from "./shared";

const SEVERITY = {
  error: { label: "Error", color: "var(--status-critical)", mark: "×" },
  warning: { label: "Warning", color: "var(--status-warning)", mark: "!" },
  notice: { label: "Notice", color: "var(--text-muted)", mark: "i" },
} as const;

const VITALS = ["Good", "Needs improvement", "Poor"];

export function AuditSection({ audit }: { audit: SeAudit | null }) {
  const [severity, setSeverity] = useState<"all" | "error" | "warning" | "notice">("all");
  if (!audit) {
    return (
      <EmptyState
        title="No site audit for this project"
        body="Start a website audit for this project in SE Ranking (Website Audit). The latest audit appears here after the next sync."
      />
    );
  }
  const issues = audit.issues.filter((i) => severity === "all" || i.status === severity);
  const ringColor = audit.score === null ? "var(--gridline)" : audit.score >= 80 ? "var(--status-good)" : audit.score >= 60 ? "var(--status-warning)" : "var(--status-critical)";
  const pct = Math.max(0, Math.min(100, audit.score ?? 0));

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center gap-6 rounded-xl border p-4" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }} aria-label="Audit summary">
        <div className="flex items-center gap-3">
          <svg width={84} height={84} viewBox="0 0 84 84" role="img" aria-label={`Site health ${audit.score ?? "unknown"} out of 100`}>
            <circle cx={42} cy={42} r={34} fill="none" stroke="var(--meter-track)" strokeWidth={8} />
            <circle
              cx={42}
              cy={42}
              r={34}
              fill="none"
              stroke={ringColor}
              strokeWidth={8}
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 2 * Math.PI * 34} ${2 * Math.PI * 34}`}
              transform="rotate(-90 42 42)"
            />
            <text x={42} y={47} textAnchor="middle" fontSize={20} fontWeight={600} fill="var(--text-primary)">
              {audit.score ?? "–"}
            </text>
          </svg>
          <div className="flex flex-col">
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Site health
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {audit.title} · {audit.status === "finished" ? `audited ${fmtDate(audit.auditTime ?? audit.lastUpdate)}` : `status: ${audit.status}`}
            </span>
            {audit.score !== null && audit.prevScore !== null ? <Delta value={audit.score - audit.prevScore} format={(v) => `${v} vs previous audit`} /> : null}
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          <Headline label="Pages crawled" value={fmtInt(audit.pages)} />
          <Headline label="Errors" value={fmtInt(audit.errors)} />
          <Headline label="Warnings" value={fmtInt(audit.warnings)} />
          <Headline label="Notices" value={fmtInt(audit.notices)} />
          <Headline label="Checks passed" value={fmtInt(audit.passed)} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Issues to fix"
          subtitle="checks that failed, with the number of affected pages"
          actions={
            <Segmented
              value={severity}
              onChange={setSeverity}
              ariaLabel="Severity"
              options={[
                { value: "all", label: `All (${audit.issues.length})` },
                { value: "error", label: "Errors" },
                { value: "warning", label: "Warnings" },
                { value: "notice", label: "Notices" },
              ]}
            />
          }
        >
          {issues.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr style={{ color: "var(--text-muted)" }}>
                    <Th>Issue</Th>
                    <Th>Category</Th>
                    <Th>Severity</Th>
                    <Th align="right">Pages</Th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i) => {
                    const s = SEVERITY[i.status];
                    return (
                      <tr key={`${i.section}-${i.code}`} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                        <td className="py-1.5 pr-3 font-medium" style={{ color: "var(--text-primary)" }}>
                          {i.name}
                        </td>
                        <td className="py-1.5 pr-3" style={{ color: "var(--text-secondary)" }}>
                          {i.section}
                        </td>
                        <td className="py-1.5 pr-3">
                          <span className="inline-flex items-center gap-1 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                            <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: s.color }}>
                              {s.mark}
                            </span>
                            {s.label}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-primary)" }}>
                          {fmtInt(i.pages)}
                          {audit.pages ? (
                            <span style={{ color: "var(--text-muted)" }}> ({Math.max(1, Math.round((i.pages / audit.pages) * 100))}%)</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {audit.status === "finished" ? "Nothing failed at this severity." : "The audit hasn't finished yet."}
            </p>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="By category" subtitle="failed checks">
            <ul className="flex flex-col gap-1.5 text-xs">
              {audit.sections.map((s) => (
                <li key={s.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <span style={{ color: "var(--text-primary)" }}>{s.name}</span>
                  <span className="tabular" style={{ color: "var(--text-secondary)" }}>
                    {[
                      [s.errors, "error"],
                      [s.warnings, "warning"],
                      [s.notices, "notice"],
                    ]
                      .filter(([n]) => (n as number) > 0)
                      .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Domain" subtitle="from the audit">
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {[
                ["Domain Trust", fmtInt(audit.domain.dt)],
                ["Backlinks", fmtInt(audit.domain.backlinks)],
                ["Referring domains", fmtInt(audit.domain.refDomains)],
                ["Indexed in Google", fmtInt(audit.domain.indexGoogle)],
                ["Core Web Vitals (mobile)", audit.vitals?.mobile != null ? VITALS[audit.vitals.mobile] ?? "–" : "–"],
                ["Core Web Vitals (desktop)", audit.vitals?.desktop != null ? VITALS[audit.vitals.desktop] ?? "–" : "–"],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt style={{ color: "var(--text-muted)" }}>{k}</dt>
                  <dd className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
