"use client";

// Team workspace UI shared by the v2 shell: the team directory, a project's managers and sharing, its spending
// status, and the read-only explanation shown to viewers. Permissions are enforced by the server on every call;
// these components only explain them and hide controls that would be refused.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Project } from "../ProjectManager";
import { Card, EmptyState, ErrorState, LoadingState, buttonClass, primaryButtonClass } from "./ui";

// ---------- viewer / manager context ----------

/** Whether the signed-in person manages the project being shown (true outside a project page: the server decides). */
const CanManage = createContext<boolean>(true);
export const CanManageProvider = ({ value, children }: { value: boolean; children: ReactNode }) => <CanManage.Provider value={value}>{children}</CanManage.Provider>;
export const useCanManage = () => useContext(CanManage);

/** Shown on every page of a project the person views but doesn't manage. */
export function ViewOnlyBanner({ project, onOpenSharing }: { project: Project; onOpenSharing: () => void }) {
  if (project.canManage) return null;
  return (
    <div role="note" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-surface px-3 py-2 text-sm">
      <span className="rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">View only</span>
      <span className="min-w-0 flex-1 text-muted">
        Everyone on the team can view every project. Changing, refreshing or running anything in {project.name} needs management access
        {project.primaryManagerName ? ` — ask ${project.primaryManagerName} or another manager to share it with you.` : " — it has no manager yet; ask the operator."}
      </span>
      <button className="text-accent hover:underline" onClick={onOpenSharing}>
        Who manages it
      </button>
    </div>
  );
}

// ---------- team data ----------

export interface TeamPerson {
  id: number;
  name: string | null;
  picture: string | null;
  jobTitle: string | null;
  emails: string[];
  asana: string | null;
  projects: Array<{ id: number; name: string; primary: boolean }>;
}
export interface Brand {
  id: number;
  name: string;
  domain: string;
}
interface TeamPayload {
  me: number;
  brands: Brand[];
  people: TeamPerson[];
}

export function useTeam(): { data: TeamPayload | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<TeamPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/team", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `Couldn't load the team (status ${r.status}).`);
        if (live) {
          setData(body as TeamPayload);
          setError(null);
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [nonce]);
  return { data, error, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

export const personLabel = (p: { name: string | null; emails?: string[]; email?: string }) => p.name || p.emails?.[0] || p.email || "Team member";

export function PersonAvatar({ person, size = 28 }: { person: { name: string | null; picture: string | null; emails?: string[]; email?: string }; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (person.picture && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={person.picture} alt="" width={size} height={size} className="shrink-0 rounded-full" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  const initial = (personLabel(person)[0] ?? "?").toUpperCase();
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {initial}
    </span>
  );
}

// ---------- team directory ----------

export function TeamPage({ onOpenProject }: { onOpenProject: (id: number) => void }) {
  const { data, error } = useTeam();
  const [q, setQ] = useState("");
  if (error) return <ErrorState title="Couldn't load the team." body={error} />;
  if (!data) return <LoadingState label="Loading the team…" rows={5} />;
  const needle = q.trim().toLowerCase();
  const people = needle
    ? data.people.filter((p) => [p.name ?? "", p.jobTitle ?? "", ...p.emails].some((s) => s.toLowerCase().includes(needle)))
    : data.people;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        Everyone here signed in with an Artemis Digital or Heads on Pillows company account (or is the one approved personal account). Everyone can view
        every project; the people listed under a project manage it. Job titles are profile information, not permissions.
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, title or email…"
        aria-label="Search the team"
        className="w-full max-w-sm rounded-md border bg-background px-3 py-1.5 text-sm"
      />
      {people.length ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {people.map((p) => (
            <li key={p.id} className="rounded-xl border bg-surface p-4">
              <div className="flex items-center gap-3">
                <PersonAvatar person={p} size={36} />
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {personLabel(p)}
                    {p.id === data.me && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted">{p.jobTitle || "No job title"}</p>
                </div>
              </div>
              <ul className="mt-3 space-y-0.5 text-xs text-muted">
                {p.emails.map((e) => (
                  <li key={e} className="truncate">
                    {e}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">Asana: {p.asana ?? "not confirmed"}</p>
              <div className="mt-3 border-t pt-2">
                <p className="text-xs font-medium text-muted">Manages {p.projects.length ? `${p.projects.length} project${p.projects.length === 1 ? "" : "s"}` : "no projects"}</p>
                {p.projects.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {p.projects.map((pr) => (
                      <button key={pr.id} onClick={() => onOpenProject(pr.id)} className="rounded-full border px-2 py-0.5 text-xs hover:border-accent" title={pr.primary ? "Primary manager" : "Manager"}>
                        {pr.name}
                        {pr.primary ? " ★" : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nobody matches." />
      )}
    </div>
  );
}

// ---------- project sharing ----------

interface Manager {
  userId: number;
  name: string | null;
  email: string;
  picture: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
  addedAt: number;
  addedByName: string | null;
}

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export const SHARING_EXPLANATION = (
  <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
    <li>Everyone on the team can view this project, its dashboards and cached reports.</li>
    <li>
      Managers can edit its settings and mappings, refresh data, run paid tools with their own API keys, share it with other team members, remove
      managers, transfer primary management and delete it. All managers have the same powers.
    </li>
    <li>
      The primary manager is also who pays for scheduled paid work — only after they enable scheduled spending in their own settings. Manual runs are
      always billed to the person who starts them.
    </li>
    <li>A project always keeps at least one manager. Sharing gives access to the project only, never to anyone&apos;s keys, budgets, usage or inbox.</li>
  </ul>
);

export function ProjectSharing({
  project,
  onChanged,
  onDeleted,
}: {
  project: Project;
  onChanged: () => void | Promise<void>;
  onDeleted: () => void;
}) {
  const team = useTeam();
  const [managers, setManagers] = useState<Manager[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState<number[]>([]);
  const [removing, setRemoving] = useState<{ userId: number; newPrimaryId: number | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${project.id}/members`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { managers?: Manager[] }) => live && setManagers(j.managers ?? []))
      .catch(() => live && setManagers([]));
    return () => {
      live = false;
    };
  }, [project.id, nonce]);

  async function act(key: string, url: string, method: string, body?: unknown, done?: string) {
    setBusy(key);
    setMessage(null);
    const r = await send(url, method, body);
    setBusy(null);
    if (!r.ok) {
      setMessage({ ok: false, text: String(r.json.error ?? "That didn't work.") });
      return false;
    }
    if (done) setMessage({ ok: true, text: done });
    setNonce((n) => n + 1);
    team.reload();
    await onChanged();
    return true;
  }

  const base = `/api/projects/${project.id}/members`;
  const canManage = project.canManage;
  const memberIds = new Set((managers ?? []).map((m) => m.userId));
  const candidates = (team.data?.people ?? []).filter((p) => !memberIds.has(p.id));

  return (
    <>
      <Card title="Managers">
        {!managers ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <ul className="divide-y">
            {managers.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <PersonAvatar person={m} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {m.name || m.email}
                    {m.isPrimary && <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[11px] font-medium text-accent">Primary manager</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {m.email}
                    {m.jobTitle ? ` · ${m.jobTitle}` : ""}
                    {m.addedByName ? ` · added by ${m.addedByName}` : ""}
                  </span>
                </span>
                {canManage && !m.isPrimary && (
                  <button className={buttonClass} disabled={busy !== null} onClick={() => act(`primary-${m.userId}`, base, "PUT", { primaryManagerId: m.userId }, `${m.name || m.email} is now the primary manager. Paid schedules pause until they enable scheduled spending.`)}>
                    {busy === `primary-${m.userId}` ? "Saving…" : "Make primary"}
                  </button>
                )}
                {canManage && managers.length > 1 && (
                  <button className="text-sm text-muted hover:text-bad" disabled={busy !== null} onClick={() => setRemoving({ userId: m.userId, newPrimaryId: null })}>
                    Remove
                  </button>
                )}
              </li>
            ))}
            {!managers.length && <li className="py-2.5 text-sm text-muted">No manager yet. The operator assigns one for projects moved from the shared analytics accounts.</li>}
          </ul>
        )}

        {removing && managers && (
          <div className="mt-3 rounded-lg border p-3 text-sm">
            {(() => {
              const m = managers.find((x) => x.userId === removing.userId);
              if (!m) return null;
              const others = managers.filter((x) => x.userId !== m.userId);
              return (
                <>
                  <p>
                    Remove <strong>{m.name || m.email}</strong> as a manager? They keep viewing the project.
                  </p>
                  {m.isPrimary && (
                    <label className="mt-2 block">
                      <span className="text-xs text-muted">They are the primary manager. Choose who takes over (queued paid work billed to them is cancelled):</span>
                      <select
                        className="mt-1 w-full rounded-md border bg-background px-2 py-1.5"
                        value={removing.newPrimaryId ?? ""}
                        onChange={(e) => setRemoving({ ...removing, newPrimaryId: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">Choose…</option>
                        {others.map((o) => (
                          <option key={o.userId} value={o.userId}>
                            {o.name || o.email}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      className={primaryButtonClass}
                      disabled={busy !== null || (m.isPrimary && !removing.newPrimaryId)}
                      onClick={async () => {
                        if (await act("remove", base, "DELETE", { userId: m.userId, newPrimaryId: removing.newPrimaryId }, "Manager removed.")) setRemoving(null);
                      }}
                    >
                      {busy === "remove" ? "Removing…" : "Remove manager"}
                    </button>
                    <button className={buttonClass} onClick={() => setRemoving(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {canManage && (
          <div className="mt-4 border-t pt-3">
            <p className="text-sm font-medium">Share management</p>
            {team.error ? (
              <p className="mt-1 text-xs" style={{ color: "var(--bad)" }}>
                {team.error}
              </p>
            ) : !team.data ? (
              <p className="mt-1 text-xs text-muted">Loading the team…</p>
            ) : candidates.length ? (
              <>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                  {candidates.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={adding.includes(p.id)}
                        onChange={(e) => setAdding((a) => (e.target.checked ? [...a, p.id] : a.filter((x) => x !== p.id)))}
                      />
                      <PersonAvatar person={p} size={20} />
                      <span className="min-w-0 flex-1 truncate">
                        {personLabel(p)}
                        <span className="text-xs text-muted"> · {p.emails[0] ?? ""}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  className={`mt-2 ${primaryButtonClass}`}
                  disabled={!adding.length || busy !== null}
                  onClick={async () => {
                    if (await act("add", base, "POST", { userIds: adding }, `Shared with ${adding.length} team member${adding.length === 1 ? "" : "s"}. They now get this project's alerts.`)) setAdding([]);
                  }}
                >
                  {busy === "add" ? "Sharing…" : "Make managers"}
                </button>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted">Every active team member already manages this project.</p>
            )}
          </div>
        )}

        {message && (
          <p role={message.ok ? "status" : "alert"} className="mt-3 text-sm" style={{ color: message.ok ? "var(--good)" : "var(--bad)" }}>
            {message.text}
          </p>
        )}
      </Card>

      <Card title="What sharing means">{SHARING_EXPLANATION}</Card>

      {canManage && (
        <Card title="Delete project">
          <p className="text-sm text-muted">
            Deleting hides the project from everyone, cancels its queued refreshes and queued paid runs, and keeps its history. It can be restored by the
            operator. The Search Console and GA4 data it pointed at is not touched.
          </p>
          {confirmDelete ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span>Delete {project.name} for the whole team?</span>
              <button
                className={primaryButtonClass}
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("delete");
                  const r = await send(`/api/projects/${project.id}`, "DELETE");
                  setBusy(null);
                  if (!r.ok) return setMessage({ ok: false, text: String(r.json.error ?? "Couldn't delete the project.") });
                  onDeleted();
                }}
              >
                {busy === "delete" ? "Deleting…" : "Delete project"}
              </button>
              <button className={buttonClass} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className={`mt-3 ${buttonClass}`} onClick={() => setConfirmDelete(true)}>
              Delete project…
            </button>
          )}
        </Card>
      )}
    </>
  );
}

// ---------- spending status ----------

const PROVIDER_LABEL: Record<string, string> = { serpapi: "SerpApi", openai: "OpenAI", anthropic: "Anthropic", dataforseo: "DataForSEO" };

export function SpendingStatus({ project, onOpenMySpending }: { project: Project; onOpenMySpending: () => void }) {
  type Payload = { primaryManager: { id: number; name: string | null } | null; isPrimaryManager: boolean; providers: Array<{ provider: string; active: boolean; reason: string | null }> };
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${project.id}/spending`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Payload) => live && setData(j))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [project.id]);
  return (
    <Card title="Who pays">
      <ul className="space-y-2 text-sm">
        <li>
          <span className="font-medium">Manual runs</span>
          <span className="text-muted"> — billed to the manager who starts them, with their own API key and budget. Nobody else&apos;s key is ever used.</span>
        </li>
        <li>
          <span className="font-medium">Scheduled paid work</span>
          <span className="text-muted">
            {" "}
            — billed to the primary manager{data?.primaryManager ? ` (${data.primaryManager.name ?? "unnamed"})` : ""}, only while they allow scheduled spending for
            that provider in their own settings. No paid feature runs on a schedule yet; this is the rule any schedule will follow.
          </span>
        </li>
      </ul>
      {data && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {data.providers.map((p) => (
            <li key={p.provider} className="rounded-lg border p-2.5 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.active ? "var(--good)" : "var(--muted, #888)" }} aria-hidden="true" />
                {PROVIDER_LABEL[p.provider] ?? p.provider}: {p.active ? "scheduled work can run" : "paused"}
              </span>
              {p.reason && <span className="mt-0.5 block text-xs text-muted">{p.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      {data?.isPrimaryManager && (
        <button className={`mt-3 ${buttonClass}`} onClick={onOpenMySpending}>
          My scheduled spending settings
        </button>
      )}
    </Card>
  );
}
