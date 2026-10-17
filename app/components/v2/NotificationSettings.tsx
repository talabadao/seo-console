"use client";

// Account settings → Notifications: which in-app alerts to create and their thresholds and minimum volumes.
// Alerts come only from saved, complete, non-demo sync results; nothing is emailed or posted anywhere.

import { useEffect, useState } from "react";
import type { NotificationSettings as Settings } from "@/lib/notifications/rules";
import { Card, primaryButtonClass } from "./ui";

type NumKey<G extends keyof Settings> = { [K in keyof Settings[G]]: Settings[G][K] extends number ? K : never }[keyof Settings[G]];

export function NotificationSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/notifications/settings", { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? `Request failed (${r.status})`);
        setS(b.settings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <Card title="Notifications">
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      </Card>
    );
  }
  if (!s) {
    return (
      <Card title="Notifications">
        <p className="text-sm text-muted">Loading…</p>
      </Card>
    );
  }

  const toggle = <G extends keyof Settings>(g: G, k: keyof Settings[G]) => (
    <input type="checkbox" checked={Boolean(s[g][k])} onChange={(e) => setS({ ...s, [g]: { ...s[g], [k]: e.target.checked } })} />
  );
  const number = <G extends keyof Settings>(g: G, k: NumKey<G>, label: string, step = 1) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        className="w-24 rounded-md border bg-surface px-2 py-1 text-right tabular-nums"
        value={Number(s[g][k])}
        onChange={(e) => setS({ ...s, [g]: { ...s[g], [k]: Number(e.target.value) } })}
      />
    </label>
  );

  async function save() {
    setStatus("Saving…");
    const r = await fetch("/api/notifications/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return setStatus(b.error ?? "Couldn't save.");
    setS(b.settings);
    setStatus(`Saved.${b.created ? ` ${b.created} new notification${b.created === 1 ? "" : "s"} from saved data.` : ""}`);
  }

  return (
    <Card title="Notifications" actions={<button className={primaryButtonClass} onClick={save}>Save</button>}>
      <p className="mb-4 text-sm text-muted">
        In-app only (the bell, top right). Alerts are created from saved sync results — never from demo, failed or incomplete data — and each change,
        task or digest is notified once. Changing thresholds doesn&apos;t remove existing notifications.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="mb-1 flex items-center gap-2 text-sm font-medium">{toggle("performance", "enabled")} Performance changes</legend>
          <p className="text-xs text-muted">Last 28 days vs the previous 28: Search Console clicks and GA4 organic sessions. At most once a week per metric.</p>
          {number("performance", "minChangePct", "Change of at least (%)")}
          {number("performance", "minClicks", "Minimum clicks in the earlier period")}
          {number("performance", "minSessions", "Minimum sessions in the earlier period")}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 flex items-center gap-2 text-sm font-medium">{toggle("rankings", "enabled")} Ranking changes (SE Ranking)</legend>
          <p className="text-xs text-muted">Compared with the earlier check shown on the dashboard. At most once a week per project.</p>
          {number("rankings", "minTop10Change", "Top 10 changes by at least (keywords)")}
          {number("rankings", "minAvgPositionChange", "Or average position changes by at least", 0.5)}
          {number("rankings", "minKeywords", "Minimum checked keywords")}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 flex items-center gap-2 text-sm font-medium">{toggle("tasks", "enabled")} Asana tasks and content progress</legend>
          {number("tasks", "upcomingDays", "Notify tasks due within (days)")}
          <label className="flex items-center gap-2 text-sm">
            {toggle("tasks", "overdue")} Overdue tasks
          </label>
          <label className="flex items-center gap-2 text-sm">
            {toggle("tasks", "completed")} Completed tasks (content progress, last 7 days)
          </label>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Other</legend>
          <label className="flex items-center gap-2 text-sm">
            {toggle("docs", "enabled")} Newly published Docs (examples marked demo never notify)
          </label>
          <label className="flex items-center gap-2 text-sm">
            {toggle("digest", "enabled")} Weekly digest
          </label>
        </fieldset>
      </div>
      {status && (
        <p role="status" className="mt-3 text-sm text-muted">
          {status}
        </p>
      )}
    </Card>
  );
}
