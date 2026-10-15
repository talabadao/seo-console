"use client";

// Chooses which GA4 events count as "leads" for a project. One project-level
// list, shared by the project dashboard, GA4 reports and the Weekly Report
// (see lib/projectSettings.ts). Used in v2 Project settings → Analytics and,
// for the classic view, inside the Weekly Report's settings.

import { useEffect, useState } from "react";

interface Loaded {
  events: string[];
  source: "project" | "weekly-report" | "none";
  legacyMonth: string | null;
  projectLevelAvailable: boolean;
  availableEvents: { name: string; count: number; isKeyEvent: boolean }[] | null;
  eventsError: string | null;
}

export function LeadEventsEditor({ projectId, onSaved }: { projectId: number; onSaved?: (events: string[]) => void }) {
  const [data, setData] = useState<{ id: number; value: Loaded | null; error: string | null } | null>(null);
  const [selected, setSelected] = useState<{ id: number; list: string[] } | null>(null);
  const [save, setSave] = useState<{ state: "saving" | "saved" | "error"; message?: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${projectId}/lead-events`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
        if (live) setData({ id: projectId, value: body as Loaded, error: null });
      })
      .catch((e) => live && setData({ id: projectId, value: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [projectId]);

  const current = data?.id === projectId ? data : null;
  if (!current) return <p className="text-sm text-muted">Loading lead events…</p>;
  if (!current.value) {
    return (
      <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
        Couldn&apos;t load lead events: {current.error}
      </p>
    );
  }
  const v = current.value;
  const list = selected?.id === projectId ? selected.list : v.events;
  const toggle = (name: string) => setSelected({ id: projectId, list: list.includes(name) ? list.filter((e) => e !== name) : [...list, name] });
  // Events chosen earlier that GA4 didn't report in the last 30 days stay listed so they can be removed.
  const names = [...new Set([...(v.availableEvents ?? []).map((e) => e.name), ...list])];

  async function saveEvents() {
    setSave({ state: "saving" });
    try {
      const res = await fetch(`/api/projects/${projectId}/lead-events`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: list }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setSave({ state: "saved" });
      onSaved?.(list);
    } catch (e) {
      setSave({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Leads are the GA4 events chosen here. Lead KPIs and lead counts use only these events. Key event totals elsewhere count every GA4 key
        event.
      </p>
      {v.source === "weekly-report" && (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted">
          Showing the selection last saved in the Weekly Report{v.legacyMonth ? ` (${v.legacyMonth})` : ""}. Saving here makes it this project&apos;s
          setting.
        </p>
      )}
      {!v.projectLevelAvailable && (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted">
          This database hasn&apos;t run migration 0002 yet, so the selection is saved where the Weekly Report has always kept it.
        </p>
      )}
      {v.eventsError && <p className="text-xs" style={{ color: "var(--bad)" }}>GA4 events couldn&apos;t be listed: {v.eventsError}</p>}
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
        {!names.length && <p className="px-1 py-2 text-xs text-muted">No events found in the last 30 days.</p>}
        {names.map((name) => {
          const ev = v.availableEvents?.find((e) => e.name === name);
          return (
            <label key={name} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-accent-soft/40">
              <span className="flex min-w-0 items-center gap-2">
                <input type="checkbox" checked={list.includes(name)} onChange={() => toggle(name)} />
                <span className="truncate">{name}</span>
                {ev?.isKeyEvent && (
                  <span className="rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent" title="Marked as a key event in GA4">
                    Key event
                  </span>
                )}
                {!ev && <span className="text-[10px] text-muted">not seen in 30 days</span>}
              </span>
              <span className="text-xs tabular-nums text-muted">{ev ? ev.count.toLocaleString("en-US") : "—"}</span>
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={saveEvents}
          disabled={save?.state === "saving"}
          className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {save?.state === "saving" ? "Saving…" : "Save lead events"}
        </button>
        {save?.state === "saved" && <span className="text-muted">Saved. The dashboard, GA4 reports and Weekly Report now use this list.</span>}
        {save?.state === "error" && (
          <span role="alert" style={{ color: "var(--bad)" }}>
            {save.message}
          </span>
        )}
      </div>
    </div>
  );
}
