"use client";

// The signed-in person's own settings in the team workspace: Profile, Linked logins (with the merge preview when a
// login already has its own record), Data connections (shared Google accounts and Asana tokens), Scheduled spending
// consent and per-project notification mutes. Everything here is personal or workspace-level; nothing on these
// pages can read another person's keys, budgets, usage or inbox.

import { useCallback, useEffect, useState } from "react";
import type { Project } from "../ProjectManager";
import { authErrorMessage } from "@/lib/auth/messages";
import { Card, buttonClass, primaryButtonClass } from "./ui";

const errorStyle = { color: "var(--bad)" } as const;

function useJson<T>(url: string): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `Request failed (status ${r.status}).`);
        if (live) {
          setData(body as T);
          setError(null);
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [url, nonce]);
  return { data, error, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** ?error= / ?merge= / ?linked= / ?connected= left by the OAuth callback on this page, read once. */
function useCallbackParams(): { error: string | null; merge: number | null; linked: boolean; connected: number | null; clear: () => void } {
  const [p] = useState(() => {
    if (typeof window === "undefined") return { error: null, merge: null, linked: false, connected: null };
    const q = new URLSearchParams(window.location.search);
    return { error: q.get("error"), merge: Number(q.get("merge")) || null, linked: q.get("linked") === "1", connected: Number(q.get("connected")) || null };
  });
  const clear = useCallback(() => {
    const q = new URLSearchParams(window.location.search);
    for (const k of ["error", "merge", "linked", "connected"]) q.delete(k);
    const s = q.toString();
    window.history.replaceState(null, "", window.location.pathname + (s ? `?${s}` : ""));
  }, []);
  return { ...p, clear };
}

function Status({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className="mt-3 text-sm" style={{ color: msg.ok ? "var(--good)" : "var(--bad)" }}>
      {msg.text}
    </p>
  );
}

// ---------- profile ----------

interface ProfilePayload {
  id: number;
  name: string | null;
  email: string;
  picture: string | null;
  jobTitle: string | null;
  signedInAs: string | null;
  identities: Array<{ id: number; email: string; hostedDomain: string | null; createdAt: number; lastLoginAt: number | null; current: boolean }>;
  asana: { gid: string; name: string | null } | null;
  docsPublisher: boolean;
}

export function ProfileSection() {
  const { data, error, reload } = useJson<ProfilePayload>("/api/account/profile");
  const [name, setName] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Card title="Profile"><p role="alert" className="text-sm" style={errorStyle}>{error}</p></Card>;
  if (!data) return <Card title="Profile"><p className="text-sm text-muted">Loading…</p></Card>;
  const nameValue = name ?? data.name ?? "";
  const titleValue = title ?? data.jobTitle ?? "";
  return (
    <>
      <Card
        title="Profile"
        actions={
          <button
            className={primaryButtonClass}
            onClick={async () => {
              const r = await send("/api/account/profile", "PUT", { name: nameValue, jobTitle: titleValue });
              setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: String(r.json.error ?? "Couldn't save.") });
              if (r.ok) reload();
            }}
          >
            Save
          </button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-xs font-medium text-muted">Name</span>
            <input value={nameValue} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-1.5" />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-muted">Job title</span>
            <input value={titleValue} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SEO specialist" className="mt-1 w-full rounded-md border bg-background px-3 py-1.5" />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted">
          Your name and job title appear in the team directory and on the projects you manage. A job title is profile information; it grants no
          permissions. Signed in with <strong className="text-foreground">{data.signedInAs ?? data.email}</strong>
          {data.identities.length > 1 ? ` (${data.identities.length} linked logins)` : ""}.
          {data.docsPublisher ? " You can publish Docs." : ""}
        </p>
        <Status msg={msg} />
      </Card>
      <AsanaIdentityCard current={data.asana} onChanged={reload} />
    </>
  );
}

/** The person's own Asana user (one verified gid): task alerts follow it. */
function AsanaIdentityCard({ current, onChanged }: { current: { gid: string; name: string | null } | null; onChanged: () => void }) {
  const { data, reload } = useJson<{ current: unknown; suggestions: Array<{ gid: string; name: string; email: string }>; error: string | null }>("/api/account/asana-identity");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function confirm(body: { gid?: string; token?: string }) {
    setBusy(true);
    const r = await send("/api/account/asana-identity", "POST", body);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Asana user confirmed." } : { ok: false, text: String(r.json.error ?? "Couldn't confirm.") });
    if (r.ok) {
      setToken("");
      reload();
      onChanged();
    }
  }
  return (
    <Card title="Your Asana user">
      <p className="text-sm text-muted">
        Task alerts (due soon, overdue) go to the person a task is assigned to in Asana. Confirm which Asana user is you; each Asana user can belong
        to one team member only. {current ? <>Confirmed: <strong className="text-foreground">{current.name ?? current.gid}</strong>.</> : "Not confirmed yet."}
      </p>
      {data?.suggestions?.length ? (
        <div className="mt-3 space-y-1">
          <p className="text-xs font-medium text-muted">Asana users whose email matches one of your verified logins:</p>
          {data.suggestions.map((s) => (
            <div key={s.gid} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {s.name} <span className="text-xs text-muted">· {s.email}</span>
              </span>
              <button className={buttonClass} disabled={busy || current?.gid === s.gid} onClick={() => confirm({ gid: s.gid })}>
                {current?.gid === s.gid ? "Confirmed" : "This is me"}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {data?.error && <p className="mt-2 text-xs text-muted">{data.error}</p>}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted">Confirm with your own Asana token instead</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Your Asana personal access token"
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5"
          />
          <button className={buttonClass} disabled={busy || !token.trim()} onClick={() => confirm({ token })}>
            Verify
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">Used once to read which Asana user it belongs to; it isn&apos;t stored.</p>
      </details>
      <Status msg={msg} />
    </Card>
  );
}

// ---------- linked logins ----------

interface MergePreview {
  requestId: number;
  identityEmail: string;
  expiresAt: number;
  target: { id: number; email: string; name: string | null };
  source: { id: number; email: string; name: string | null; identities: string[] };
  moves: { projectsManaged: number; credentials: number; budgets: number; notifications: number; savedReports: number; usageRows: number; runs: number };
  conflicts: Array<{ area: string; key: string; label: string }>;
}

export function LinkedLogins() {
  const params = useCallbackParams();
  const { data, error, reload } = useJson<ProfilePayload>("/api/account/profile");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(() =>
    params.error ? { ok: false, text: authErrorMessage(params.error)! } : params.linked ? { ok: true, text: "Login linked to your profile." } : null,
  );
  const [merge, setMerge] = useState<number | null>(params.merge);
  useEffect(() => {
    if (params.error || params.linked || params.merge) params.clear();
  }, [params]);

  if (error) return <Card title="Linked logins"><p role="alert" className="text-sm" style={errorStyle}>{error}</p></Card>;
  if (!data) return <Card title="Linked logins"><p className="text-sm text-muted">Loading…</p></Card>;
  return (
    <>
      {merge != null && (
        <MergeReview
          requestId={merge}
          onDone={(text, ok) => {
            setMerge(null);
            setMsg({ ok, text });
            reload();
          }}
        />
      )}
      <Card
        title="Linked logins"
        actions={
          <a className={primaryButtonClass} href="/api/auth/google?purpose=link">
            Link another Google login
          </a>
        }
      >
        <p className="text-sm text-muted">
          One profile can have several Google logins (for example your Artemis Digital and Heads on Pillows accounts). Linking needs proof: you sign in
          to the other account with Google while signed in here. If that login already has its own SEO Console profile, you review what moves and choose
          every difference before anything is combined.
        </p>
        <ul className="mt-3 divide-y">
          {data.identities.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {i.email}
                  {i.current && <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[11px] text-accent">This session</span>}
                </span>
                <span className="block text-xs text-muted">
                  {i.hostedDomain ? `Company account (${i.hostedDomain})` : "Personal Google account"} · linked {new Date(i.createdAt).toLocaleDateString("en-GB")}
                  {i.lastLoginAt ? ` · last sign-in ${new Date(i.lastLoginAt).toLocaleDateString("en-GB")}` : ""}
                </span>
              </span>
              {data.identities.length > 1 && !i.current && (
                <button
                  className="text-sm text-muted hover:text-bad"
                  onClick={async () => {
                    const r = await send(`/api/account/identities/${i.id}`, "DELETE");
                    setMsg(r.ok ? { ok: true, text: `${i.email} is no longer linked.` } : { ok: false, text: String(r.json.error ?? "Couldn't unlink.") });
                    reload();
                  }}
                >
                  Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Your only login can&apos;t be removed. Shared analytics accounts can&apos;t be linked; connect them under Data connections.</p>
        <Status msg={msg} />
      </Card>
    </>
  );
}

function MergeReview({ requestId, onDone }: { requestId: number; onDone: (text: string, ok: boolean) => void }) {
  const { data, error } = useJson<MergePreview>(`/api/account/identities/merge/${requestId}`);
  const [choices, setChoices] = useState<Record<string, "target" | "source">>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Card title="Combine profiles"><p role="alert" className="text-sm" style={errorStyle}>{error}</p></Card>;
  if (!data) return <Card title="Combine profiles"><p className="text-sm text-muted">Loading the preview…</p></Card>;
  const m = data.moves;
  const missing = data.conflicts.filter((c) => !choices[`${c.area}:${c.key}`]);
  const moveLine = [
    m.projectsManaged && `${m.projectsManaged} managed project${m.projectsManaged === 1 ? "" : "s"}`,
    m.credentials && `${m.credentials} saved API key${m.credentials === 1 ? "" : "s"}`,
    m.budgets && `${m.budgets} budget limit${m.budgets === 1 ? "" : "s"}`,
    m.notifications && `${m.notifications} notification${m.notifications === 1 ? "" : "s"}`,
    m.savedReports && `${m.savedReports} saved GA4 report${m.savedReports === 1 ? "" : "s"}`,
    m.usageRows && `${m.usageRows} usage record${m.usageRows === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return (
    <Card title="Combine profiles">
      <p className="text-sm">
        <strong>{data.identityEmail}</strong> already has its own SEO Console profile ({data.source.name ?? data.source.email}). Linking it combines that
        profile into yours ({data.target.name ?? data.target.email}). Its logins ({data.source.identities.join(", ")}) will open your profile.
      </p>
      <p className="mt-2 text-sm text-muted">Moves to your profile: {moveLine.length ? moveLine.join(", ") : "nothing besides the login"}. Usage history keeps its origin; consumed allowances are added to yours, never reset.</p>
      {data.conflicts.length > 0 && (
        <fieldset className="mt-3 space-y-2">
          <legend className="text-sm font-medium">Choose which value to keep for each difference</legend>
          {data.conflicts.map((c) => {
            const k = `${c.area}:${c.key}`;
            return (
              <div key={k} className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm">
                <span className="min-w-0 flex-1">{c.label}</span>
                {(["target", "source"] as const).map((side) => (
                  <label key={side} className="flex items-center gap-1.5">
                    <input type="radio" name={k} checked={choices[k] === side} onChange={() => setChoices((x) => ({ ...x, [k]: side }))} />
                    {side === "target" ? "Keep mine" : `Use ${data.source.email}'s`}
                  </label>
                ))}
              </div>
            );
          })}
        </fieldset>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={primaryButtonClass}
          disabled={busy || missing.length > 0}
          onClick={async () => {
            setBusy(true);
            const r = await send(`/api/account/identities/merge/${requestId}`, "POST", { choices });
            setBusy(false);
            if (r.ok) onDone(`${data.identityEmail} is now linked; the two profiles are combined.`, true);
            else setMsg({ ok: false, text: String(r.json.error ?? "Couldn't combine the profiles.") });
          }}
        >
          {busy ? "Combining…" : "Combine and link"}
        </button>
        <button
          className={buttonClass}
          onClick={async () => {
            await send(`/api/account/identities/merge/${requestId}`, "DELETE");
            onDone("Nothing was linked or changed.", true);
          }}
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">This offer expires {new Date(data.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}; link the login again after that.</p>
      <Status msg={msg} />
    </Card>
  );
}

// ---------- data connections ----------

interface GoogleConnection {
  id: number;
  email: string;
  status: "ok" | "needs-reconnect" | "disconnected";
  shared: boolean;
  grantedByUserId: number | null;
  grantedByName: string | null;
  lastError: string | null;
  updatedAt: number;
  identityBound: boolean;
  projects: number;
}
interface AsanaConnection {
  id: number;
  hint: string | null;
  asanaUserName: string | null;
  status: string;
  lastError: string | null;
  grantedByUserId: number | null;
  grantedByName: string | null;
  projects: number;
  updatedAt: number;
}

const HEALTH: Record<string, { label: string; dot: string }> = {
  ok: { label: "Healthy", dot: "var(--good)" },
  "needs-reconnect": { label: "Needs reconnect", dot: "var(--bad)" },
  disconnected: { label: "Disconnected", dot: "var(--muted, #888)" },
};

export function DataConnections() {
  const params = useCallbackParams();
  const { data, error, reload } = useJson<{ me: number; google: GoogleConnection[]; asana: AsanaConnection[] }>("/api/account/connections");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(() =>
    params.error ? { ok: false, text: authErrorMessage(params.error)! } : params.connected ? { ok: true, text: "Google account connected. Its Search Console sites and GA4 properties are listed for project mappings." } : null,
  );
  const [confirm, setConfirm] = useState<{ id: number; projects: Array<{ id: number; name: string; uses: string[] }> } | null>(null);
  const [asanaToken, setAsanaToken] = useState("");
  useEffect(() => {
    if (params.error || params.connected) params.clear();
  }, [params]);

  if (error) return <Card title="Data connections"><p role="alert" className="text-sm" style={errorStyle}>{error}</p></Card>;
  if (!data) return <Card title="Data connections"><p className="text-sm text-muted">Loading…</p></Card>;

  async function refresh(id: number) {
    setBusy(`refresh-${id}`);
    const r = await send(`/api/account/connections/google/${id}`, "POST");
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: `Refreshed: ${r.json.sites ?? 0} Search Console sites, ${r.json.gaProperties ?? 0} GA4 properties.` } : { ok: false, text: String(r.json.error ?? "Couldn't refresh.") });
    reload();
  }
  async function askDisconnect(id: number) {
    const r = await send(`/api/account/connections/google/${id}`, "GET");
    setConfirm({ id, projects: (r.json.projects as Array<{ id: number; name: string; uses: string[] }>) ?? [] });
  }

  return (
    <>
      <Card
        title="Google data connections"
        actions={
          <a className={primaryButtonClass} href="/api/auth/google?purpose=connect-google">
            Connect a Google account
          </a>
        }
      >
        <p className="text-sm text-muted">
          Search Console and GA4 are read through these shared connections — usually analytics@artemisdigital.com and analytics@headsonpillows.com — never
          through your personal sign-in. Connecting one opens Google for that account; your own session stays as it is. Tokens are stored encrypted and
          never shown.
        </p>
        <ul className="mt-3 divide-y">
          {data.google.map((c) => {
            const h = HEALTH[c.status] ?? HEALTH.ok;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.email}</span>
                  <span className="block text-xs text-muted">
                    {c.shared ? "Shared analytics account" : "Team member's own Google account"} · used by {c.projects} project{c.projects === 1 ? "" : "s"}
                    {c.grantedByName ? ` · connected by ${c.grantedByName}` : " · moved from the previous version"}
                    {!c.identityBound ? " · reconnect once to confirm the Google account" : ""}
                  </span>
                  {c.lastError && c.status !== "ok" && <span className="block text-xs" style={errorStyle}>{c.lastError}</span>}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} aria-hidden="true" />
                  {h.label}
                </span>
                {c.status === "ok" ? (
                  <button className={buttonClass} disabled={busy !== null} onClick={() => refresh(c.id)}>
                    {busy === `refresh-${c.id}` ? "Refreshing…" : "Refresh list"}
                  </button>
                ) : (
                  <a className={buttonClass} href="/api/auth/google?purpose=connect-google">
                    Reconnect
                  </a>
                )}
                {c.status !== "disconnected" && c.grantedByUserId === data.me && (
                  <button className="text-sm text-muted hover:text-bad" onClick={() => askDisconnect(c.id)}>
                    Disconnect
                  </button>
                )}
              </li>
            );
          })}
          {!data.google.length && <li className="py-2.5 text-sm text-muted">No Google account connected yet.</li>}
        </ul>
        {confirm && (
          <div className="mt-3 rounded-lg border p-3 text-sm">
            <p>
              Disconnect this Google account? {confirm.projects.length ? `These projects read data through it and will show "reconnect" until it's connected again: ${confirm.projects.map((p) => p.name).join(", ")}.` : "No project uses it."}{" "}
              Mappings are kept, so reconnecting the same account restores them.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                className={primaryButtonClass}
                onClick={async () => {
                  const r = await send(`/api/account/connections/google/${confirm.id}`, "DELETE");
                  setConfirm(null);
                  setMsg(r.ok ? { ok: true, text: "Disconnected." } : { ok: false, text: String(r.json.error ?? "Couldn't disconnect.") });
                  reload();
                }}
              >
                Disconnect
              </button>
              <button className={buttonClass} onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Only the person who connected an account can disconnect it. Anyone who can sign in to that Google account can reconnect it.</p>
        <Status msg={msg} />
      </Card>

      <Card title="Asana reporting connections">
        <p className="text-sm text-muted">
          A project&apos;s Asana tasks and weekly status updates are read and posted through the Asana connection mapped in its settings. Adding your Asana
          personal access token here creates one (verified, stored encrypted). Task alerts still go to each task&apos;s assignee, never to the token&apos;s
          owner.
        </p>
        <ul className="mt-3 divide-y">
          {data.asana.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {a.asanaUserName ?? "Asana token"} {a.hint ? <span className="font-mono text-xs text-muted">••••{a.hint}</span> : null}
                </span>
                <span className="block text-xs text-muted">
                  used by {a.projects} project{a.projects === 1 ? "" : "s"}
                  {a.grantedByName ? ` · added by ${a.grantedByName}` : ""}
                </span>
              </span>
              <span className="text-xs text-muted">{a.status === "ok" ? "Healthy" : a.status}</span>
              {a.grantedByUserId === data.me && (
                <button
                  className="text-sm text-muted hover:text-bad"
                  onClick={async () => {
                    const r = await send(`/api/account/connections/asana/${a.id}`, "DELETE");
                    setMsg(r.ok ? { ok: true, text: "Asana connection removed." } : { ok: false, text: String(r.json.error ?? "Couldn't remove it.") });
                    reload();
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {!data.asana.length && <li className="py-2.5 text-sm text-muted">No Asana connection yet.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="password"
            autoComplete="off"
            value={asanaToken}
            onChange={(e) => setAsanaToken(e.target.value)}
            placeholder="Asana personal access token"
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
          />
          <button
            className={buttonClass}
            disabled={!asanaToken.trim() || busy !== null}
            onClick={async () => {
              setBusy("asana");
              const r = await send("/api/settings/asana", "POST", { apiKey: asanaToken });
              setBusy(null);
              setMsg(r.ok ? { ok: true, text: `Asana connection saved (${r.json.name ?? "verified"}).` } : { ok: false, text: String(r.json.error ?? "Couldn't save it.") });
              if (r.ok) setAsanaToken("");
              reload();
            }}
          >
            {busy === "asana" ? "Verifying…" : "Add Asana connection"}
          </button>
        </div>
      </Card>
    </>
  );
}

// ---------- scheduled spending ----------

const PROVIDER_LABEL: Record<string, string> = { serpapi: "SerpApi", openai: "OpenAI", anthropic: "Anthropic", dataforseo: "DataForSEO" };

export function ScheduledSpending({ onOpenCredentials }: { onOpenCredentials: () => void }) {
  const { data, error, reload } = useJson<{ settings: Array<{ provider: string; enabled: boolean; updatedAt: number | null }>; primaryProjects: Array<{ id: number; name: string }> }>(
    "/api/account/spending",
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Card title="Scheduled spending"><p role="alert" className="text-sm" style={errorStyle}>{error}</p></Card>;
  if (!data) return <Card title="Scheduled spending"><p className="text-sm text-muted">Loading…</p></Card>;
  return (
    <Card title="Scheduled spending">
      <p className="text-sm text-muted">
        Manual runs are always billed to the person who starts them, with their own key and budget. Scheduled paid work on a project is billed to its
        primary manager — and only for the providers you allow here. Turning one off pauses paid schedules on your projects; nobody else&apos;s key is
        used instead. No paid feature runs on a schedule yet.
      </p>
      <p className="mt-2 text-sm">
        {data.primaryProjects.length
          ? `You are the primary manager of: ${data.primaryProjects.map((p) => p.name).join(", ")}.`
          : "You aren't the primary manager of any project, so nothing scheduled is billed to you."}
      </p>
      <ul className="mt-3 divide-y">
        {data.settings.map((s) => (
          <li key={s.provider} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="w-32 font-medium">{PROVIDER_LABEL[s.provider] ?? s.provider}</span>
            <label className="flex flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={async (e) => {
                  const r = await send("/api/account/spending", "PUT", { provider: s.provider, enabled: e.target.checked });
                  setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: String(r.json.error ?? "Couldn't save.") });
                  reload();
                }}
              />
              Allow scheduled {PROVIDER_LABEL[s.provider] ?? s.provider} spending on projects I&apos;m primary manager of
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Scheduled work also needs your own key (
        <button className="text-accent hover:underline" onClick={onOpenCredentials}>
          API credentials
        </button>
        ) and stays within your budgets. Changing a key or this setting stops already-queued scheduled runs; they are never charged to someone else.
      </p>
      <Status msg={msg} />
    </Card>
  );
}

// ---------- notification routing and mutes ----------

const MUTE_LABEL: Record<string, string> = { all: "Everything", performance: "Performance", rankings: "Rankings", tasks: "Tasks", content: "Content progress" };

export function NotificationMutes({ projects }: { projects: Project[] }) {
  const { data, reload } = useJson<{ mutes: Array<{ projectId: number; category: string }>; categories: string[] }>("/api/notifications/mutes");
  const managed = projects.filter((p) => p.canManage);
  const muted = (projectId: number, category: string) => Boolean(data?.mutes.some((m) => m.projectId === projectId && m.category === category));
  async function set(projectId: number, category: string, value: boolean) {
    await send("/api/notifications/mutes", "PUT", { projectId, category, muted: value });
    reload();
  }
  const categories = ["all", ...(data?.categories ?? [])];
  return (
    <Card title="Who gets which alerts">
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>Project alerts (performance, rankings, content progress) go to each project&apos;s managers. Being added as a manager subscribes you.</li>
        <li>Task alerts (due soon, overdue) go to the task&apos;s Asana assignee — you, once your Asana user is confirmed in Profile — in any project.</li>
        <li>Mutes are yours alone; they never change what other managers receive.</li>
      </ul>
      {managed.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1.5 pr-3 font-medium">Mute for project</th>
                {categories.map((c) => (
                  <th key={c} className="px-2 py-1.5 text-center font-medium">
                    {MUTE_LABEL[c] ?? c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {[{ id: 0, name: "All my projects" }, ...managed].map((p) => (
                <tr key={p.id}>
                  <td className="py-1.5 pr-3">{p.name}</td>
                  {categories.map((c) => (
                    <td key={c} className="px-2 py-1.5 text-center">
                      <input type="checkbox" aria-label={`Mute ${MUTE_LABEL[c] ?? c} for ${p.name}`} checked={muted(p.id, c)} onChange={(e) => set(p.id, c, e.target.checked)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">You don&apos;t manage any project, so you receive no project alerts to mute.</p>
      )}
    </Card>
  );
}
