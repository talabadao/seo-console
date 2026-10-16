"use client";

// Notification bell (top-right). Reads the app's own stored notifications — created from persisted sync results,
// Docs publications and the weekly digest — never asks a provider when it opens. Unread count, read/unread per
// item, project filter, severity, the source time and a link to the underlying report or item. Polls local
// records once a minute while the page is visible.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ShellLocation } from "@/lib/v2/nav";
import { Icon } from "./icons";

export interface NotificationItem {
  id: number;
  projectId: number | null;
  projectName: string | null;
  severity: "info" | "warning" | "critical";
  kind: string;
  title: string;
  body: string;
  /** When the underlying event happened (data date, task due date, publication time). */
  sourceAt: number;
  createdAt: number;
  readAt: number | null;
  /** In-app address of the underlying report or item. */
  href: string | null;
}

const SEVERITY: Record<NotificationItem["severity"], string> = { info: "var(--accent)", warning: "var(--warning, #b7791f)", critical: "var(--bad)" };
const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function NotificationBell({ projectId, onNavigate }: { projectId: number | null; onNavigate: (href: string) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "project">("all");
  const [data, setData] = useState<{ unread: number; items: NotificationItem[] } | null>(null);
  const [state, setState] = useState<"ok" | "unavailable" | "error">("ok");
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const scope = filter === "project" && projectId ? String(projectId) : "all";
    try {
      const res = await fetch(`/api/notifications?project=${scope}&limit=40`, { cache: "no-store" });
      if (res.status === 404 || res.status === 503) return setState("unavailable");
      if (!res.ok) return setState("error");
      setData(await res.json());
      setState("ok");
    } catch {
      setState("error");
    }
  }, [filter, projectId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function mark(body: Record<string, unknown>) {
    await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await load();
  }

  const unread = data?.unread ?? 0;
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative rounded-md p-1.5 text-muted hover:bg-accent-soft hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 text-white" style={{ background: "var(--bad)" }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div ref={panel} role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-50 mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-xl border bg-surface shadow-xl">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "project")} aria-label="Filter notifications" className="ml-auto rounded-md border bg-background px-2 py-1 text-xs">
              <option value="all">All projects</option>
              {projectId && <option value="project">This project</option>}
            </select>
            {unread > 0 && (
              <button className="text-xs text-accent hover:underline" onClick={() => mark({ all: true, project: filter === "project" ? projectId : null })}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {state === "unavailable" ? (
              <p className="p-4 text-sm text-muted">Notifications aren&apos;t set up on this server yet.</p>
            ) : state === "error" && !data ? (
              <p role="alert" className="p-4 text-sm" style={{ color: "var(--bad)" }}>
                Couldn&apos;t load notifications.
              </p>
            ) : !data ? (
              <p className="p-4 text-sm text-muted">Loading…</p>
            ) : data.items.length === 0 ? (
              <p className="p-4 text-sm text-muted">Nothing new. Alerts come from synced data — performance changes, Asana due dates, ranking changes, published Docs — and a weekly digest.</p>
            ) : (
              <ul>
                {data.items.map((n) => (
                  <li key={n.id} className={`border-b px-3 py-2.5 last:border-0 ${n.readAt ? "" : "bg-accent-soft/30"}`}>
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY[n.severity] }} aria-label={n.severity} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {n.href ? (
                            <a
                              href={n.href}
                              onClick={(e) => {
                                e.preventDefault();
                                if (!n.readAt) void mark({ ids: [n.id] });
                                setOpen(false);
                                onNavigate(n.href!);
                              }}
                              className="hover:underline"
                            >
                              {n.title}
                            </a>
                          ) : (
                            n.title
                          )}
                        </p>
                        {n.body && <p className="mt-0.5 text-xs text-muted">{n.body}</p>}
                        <p className="mt-1 text-[11px] text-muted">
                          {n.projectName ? `${n.projectName} · ` : ""}
                          {when(n.sourceAt)}
                        </p>
                      </div>
                      <button
                        className="shrink-0 text-[11px] text-muted hover:text-foreground"
                        onClick={() => mark(n.readAt ? { ids: [n.id], unread: true } : { ids: [n.id] })}
                        aria-label={n.readAt ? "Mark as unread" : "Mark as read"}
                      >
                        {n.readAt ? "Unread" : "Read"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
