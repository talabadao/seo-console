"use client";

// SerpApi readiness for the open project (lib/providers/serpReadiness.ts): which key applies and whether it was
// verified, whether a search may run now and why not (with the remedy), the Preview smoke-test allowance, and how
// the last request ended. Shown above the run controls; reads local records only.

import type { SerpReadiness } from "@/lib/providers/serpReadiness";

const SOURCE: Record<string, string> = { account: "your account key", "project-legacy": "this project's legacy key", "server-legacy": "the server key" };
const ATTEMPT: Record<string, string> = {
  ok: "succeeded",
  "invalid-key": "failed: SerpApi rejected the key",
  "out-of-searches": "failed: the SerpApi account has no searches left",
  "rate-limited": "failed: SerpApi rate-limited the key",
  timeout: "failed: SerpApi didn't answer in time",
  network: "failed: SerpApi couldn't be reached",
  refused: "was refused before sending",
  "provider-error": "failed with a SerpApi error",
};

export function SerpReadinessPanel({ readiness, onOpenCredentials, onOpenBudgets }: { readiness: SerpReadiness | null; onOpenCredentials?: () => void; onOpenBudgets?: () => void }) {
  if (!readiness) return null;
  const { credential: c, execution: x, previewAllowance: p, lastAttempt: a } = readiness;
  const link = (label: string, on?: () => void) =>
    on ? (
      <button type="button" onClick={on} className="font-medium hover:underline" style={{ color: "var(--series-1)" }}>
        {label}
      </button>
    ) : null;
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border px-4 py-2.5 text-xs"
      role={x.allowed ? "note" : "alert"}
      style={{ borderColor: x.allowed ? "var(--border-hairline)" : "var(--status-warning)", color: "var(--text-secondary)", background: "var(--surface-1)" }}
    >
      <p>
        <strong style={{ color: "var(--text-primary)" }}>SerpApi key:</strong>{" "}
        {c.state === "missing" ? (
          <>none applies to this project. {link("Add one in API credentials", onOpenCredentials)}</>
        ) : (
          <>
            {SOURCE[c.source ?? ""] ?? c.source} ·{" "}
            {c.verification === "verified" ? (
              <span style={{ color: "var(--success-text)" }}>verified{c.verifiedAt ? ` ${new Date(c.verifiedAt).toLocaleDateString("en-GB")}` : ""}</span>
            ) : c.verification === "invalid" ? (
              <span style={{ color: "var(--status-critical)" }}>verification failed{c.message ? `: ${c.message}` : ""}</span>
            ) : (
              <>saved, not verified {c.source === "account" ? <>({link("verify it for free", onOpenCredentials)})</> : null}</>
            )}
          </>
        )}
      </p>
      <p>
        <strong style={{ color: "var(--text-primary)" }}>Searches:</strong>{" "}
        {x.allowed ? (
          <span style={{ color: "var(--success-text)" }}>allowed for this project</span>
        ) : (
          <>
            <span style={{ color: "var(--status-critical)" }}>blocked</span> — {x.reason} {x.remedy}{" "}
            {x.code === "limit-reached" ? link("Budgets & limits", onOpenBudgets) : null}
          </>
        )}
        {p ? ` · Preview smoke test: ${p.used} of ${p.max} requests used (cumulative, never refills)` : ""}
      </p>
      {a ? (
        <p>
          <strong style={{ color: "var(--text-primary)" }}>Last request:</strong> {new Date(a.at).toLocaleString("en-GB")} ({a.operation}) {ATTEMPT[a.code] ?? a.code}
          {a.code !== "ok" && a.message ? ` — ${a.message}` : ""}
        </p>
      ) : (
        <p>
          <strong style={{ color: "var(--text-primary)" }}>Last request:</strong> none recorded for this project.
        </p>
      )}
    </div>
  );
}
