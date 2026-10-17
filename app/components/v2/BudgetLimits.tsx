"use client";

// The one budget form. Settings → Account → Budgets & limits shows the account-wide limits and every project's;
// Project settings → Budgets shows the same service scoped to one project (account limits read-only there, with
// a link). Limits are enforced together by lib/providers/policy.ts; changing one never resets usage.

import { useEffect, useState } from "react";
import type { EffectiveLimit } from "@/lib/budgets";
import { Card, buttonClass, primaryButtonClass } from "./ui";

interface Payload {
  account: EffectiveLimit[];
  projects: Array<{ id: number; name: string; limits: EffectiveLimit[] }>;
}

const show = (l: EffectiveLimit, v: number | null) =>
  v == null ? "No limit" : l.unit === "USD" ? `$${v.toFixed(2)} per ${l.period}` : `${v.toLocaleString("en-US")} requests per ${l.period}`;

function LimitRow({ limit, editable, onSaved }: { limit: EffectiveLimit; editable: boolean; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function put(next: number | null) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/account/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: limit.scope, projectId: limit.projectId, metric: limit.metric, value: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; limit?: EffectiveLimit };
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: body.error ?? `Couldn't save (status ${res.status}). The previous limit still applies.` });
      return;
    }
    setMessage({ ok: true, text: next == null ? "Back to the default." : "Saved." });
    setEditing(false);
    setValue("");
    onSaved();
  }
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 py-2.5 text-sm last:border-0">
      <span className="min-w-[14rem] flex-1">
        <span className="block font-medium">{limit.label}</span>
        <span className="block text-xs text-muted">
          {limit.source === "configured" ? `Set in Settings${limit.updatedAt ? ` · ${new Date(limit.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}` : "Server default"}
          {limit.source === "configured" ? ` · default: ${show(limit, limit.defaultValue)}` : ""}
        </span>
      </span>
      <span className="tabular-nums">{show(limit, limit.value)}</span>
      {editable && !editing && (
        <span className="flex gap-2">
          <button type="button" className={buttonClass} onClick={() => setEditing(true)}>
            Change
          </button>
          {limit.source === "configured" && (
            <button type="button" className="text-xs text-muted hover:text-foreground" disabled={busy} onClick={() => put(null)}>
              Use default
            </button>
          )}
        </span>
      )}
      {editing && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(value);
            if (value.trim() === "" || !Number.isFinite(n) || n < 0) {
              setMessage({ ok: false, text: "Enter a number of zero or more." });
              return;
            }
            void put(n);
          }}
        >
          <label className="flex items-center gap-1 text-xs">
            {limit.unit === "USD" ? "$" : null}
            <input
              type="number"
              min={0}
              step={limit.unit === "USD" ? "0.01" : "1"}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={limit.label}
              placeholder={limit.value == null ? "No limit" : String(limit.value)}
              className="w-28 rounded-md border bg-background px-2 py-1 text-sm"
            />
            <span className="text-muted">{limit.unit === "USD" ? `per ${limit.period}` : `requests per ${limit.period}`}</span>
          </label>
          <button type="submit" className={primaryButtonClass} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className={buttonClass} onClick={() => { setEditing(false); setValue(""); setMessage(null); }}>
            Cancel
          </button>
        </form>
      )}
      {message && (
        <span role={message.ok ? "status" : "alert"} className="w-full text-xs" style={{ color: message.ok ? "var(--good)" : "var(--bad)" }}>
          {message.text}
        </span>
      )}
    </li>
  );
}

export function BudgetLimits({ projectId, onOpenAccount }: { projectId: number | null; onOpenAccount?: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`/api/account/budgets${projectId != null ? `?project=${projectId}` : ""}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `Couldn't load limits (status ${r.status}).`);
        if (live) {
          setData(body as Payload);
          setError(null);
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [projectId, nonce]);
  const reload = () => setNonce((n) => n + 1);

  if (error) {
    return (
      <Card title="Budgets & limits">
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card title="Budgets & limits">
        <p className="text-sm text-muted">Loading…</p>
      </Card>
    );
  }
  return (
    <>
      <Card
        title={projectId == null ? "Account-wide limits" : "Account-wide limits (apply to this project too)"}
        actions={
          projectId != null && onOpenAccount ? (
            <button className={buttonClass} onClick={onOpenAccount}>
              Edit in Account settings
            </button>
          ) : undefined
        }
      >
        <ul>
          {data.account.map((l) => (
            <LimitRow key={l.metric} limit={l} editable={projectId == null} onSaved={reload} />
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Account-wide limits cover all of this account&apos;s projects together. A request must fit every limit that applies — the project&apos;s and the
          account&apos;s; concurrent requests and retries are counted against all of them. Changing a limit never resets what&apos;s already been used in the period.
        </p>
      </Card>
      {data.projects.map((p) => (
        <Card key={p.id} title={projectId == null ? `Project: ${p.name}` : "This project's limits"}>
          <ul>
            {p.limits.map((l) => (
              <LimitRow key={l.metric} limit={l} editable onSaved={reload} />
            ))}
          </ul>
        </Card>
      ))}
      <p className="text-xs text-muted">
        On Preview, the SerpApi smoke test keeps its own fixed allowance (at most 5 requests in total for the chosen project), whatever these limits say, and paid
        model calls stay off.
      </p>
    </>
  );
}
