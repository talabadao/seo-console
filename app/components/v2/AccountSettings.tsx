"use client";

// Account settings: everything that belongs to the signed-in person rather than one project, addressed as
// /account/<section> (?project=<id> keeps the open project as a filter). Personal: Profile, Linked logins, API
// credentials (encrypted, used only for this person's runs), Usage & Costs, Budgets & limits, Scheduled spending,
// Notification preferences. Workspace-level: Data connections (shared Google accounts, Asana) and Sync & cache.

import { useCallback, useEffect, useState } from "react";
import type { Project } from "../ProjectManager";
import { CREDENTIAL_PROVIDERS, type CredentialStatus } from "@/lib/credentials/providers";
import type { LegacySerpState } from "@/lib/credentials/resolve";
import { Card, buttonClass } from "./ui";
import { CredentialField } from "./CredentialField";
import { UsageCostsPage } from "./UsageCosts";
import { BudgetLimits } from "./BudgetLimits";
import { SyncStatusPage } from "./SyncStatus";
import { NotificationSettingsPage } from "./NotificationSettings";
import { DataConnections, LinkedLogins, NotificationMutes, ProfileSection, ScheduledSpending } from "./AccountWorkspace";

export const ACCOUNT_SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "logins", label: "Linked logins" },
  { id: "credentials", label: "API credentials" },
  { id: "usage", label: "Usage & Costs" },
  { id: "budgets", label: "Budgets & limits" },
  { id: "spending", label: "Scheduled spending" },
  { id: "notifications", label: "Notification preferences" },
  { id: "connections", label: "Data connections" },
  { id: "sync", label: "Sync & cache" },
] as const;
type SectionId = (typeof ACCOUNT_SECTIONS)[number]["id"];

export function AccountSettings({
  sub,
  projectId,
  projects,
  onSub,
  onProjectsChanged,
  bingConnected,
  onOpenConnections,
}: {
  sub: string;
  /** The project open when Settings was reached, used as the default filter; null from All projects. */
  projectId: number | null;
  projects: Project[];
  onSub: (sub: string) => void;
  onProjectsChanged: () => void | Promise<void>;
  bingConnected: boolean;
  /** Opens the editor for the Bing Webmaster key (Tracking & connections). */
  onOpenConnections: () => void;
}) {
  const section: SectionId = ACCOUNT_SECTIONS.some((s) => s.id === sub) ? (sub as SectionId) : "credentials";
  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
      <nav aria-label="Account settings sections" className="flex gap-1 overflow-x-auto lg:flex-col">
        {ACCOUNT_SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => onSub(s.id === "credentials" ? "" : s.id)}
            aria-current={section === s.id ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm ${section === s.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-accent-soft/50 hover:text-foreground"}`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 space-y-4">
        {section === "profile" && <ProfileSection />}
        {section === "logins" && <LinkedLogins />}
        {section === "credentials" && <Credentials projects={projects} projectId={projectId} onProjectsChanged={onProjectsChanged} />}
        {section === "spending" && <ScheduledSpending onOpenCredentials={() => onSub("")} />}
        {section === "connections" && (
          <>
            <DataConnections />
            <OtherConnections bingConnected={bingConnected} onOpen={onOpenConnections} />
          </>
        )}
        {section === "usage" && <UsageCostsPage projectId={projectId} projects={projects} onOpenBudgets={() => onSub("budgets")} />}
        {section === "budgets" && <BudgetLimits projectId={null} />}
        {section === "notifications" && (
          <>
            <NotificationMutes projects={projects} />
            <NotificationSettingsPage />
          </>
        )}
        {section === "sync" && <SyncStatusPage projectId={projectId} onOpenUsage={() => onSub("usage")} />}
      </div>
    </div>
  );
}

interface CredentialsPayload {
  account: { email: string };
  storageConfigured: boolean;
  providers: CredentialStatus[];
  legacySerp: LegacySerpState;
}

function Credentials({ onProjectsChanged }: { projects: Project[]; projectId: number | null; onProjectsChanged: () => void | Promise<void> }) {
  const [data, setData] = useState<CredentialsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    fetch("/api/account/credentials", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `Couldn't load credentials (status ${r.status}).`);
        if (live) {
          setData(body as CredentialsPayload);
          setError(null);
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [nonce]);

  const refresh = useCallback(async () => {
    setNonce((n) => n + 1);
    await onProjectsChanged();
  }, [onProjectsChanged]);

  async function call(url: string, init: RequestInit): Promise<string | null> {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as { error?: string; outcome?: { ok: boolean; message: string } };
    if (!res.ok) return body.error ?? `Request failed (status ${res.status}).`;
    await refresh();
    if (body.outcome && !body.outcome.ok) return body.outcome.message;
    return null;
  }

  if (error) {
    return (
      <Card title="API credentials">
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card title="API credentials">
        <p className="text-sm text-muted">Loading…</p>
      </Card>
    );
  }

  return (
    <>
      <Card title="API credentials">
        <p className="text-sm text-muted">
          These keys are yours: they pay for the paid runs you start in any project you manage, and for scheduled work on projects where you are the
          primary manager (only if you allow it under Scheduled spending). Teammates never see or use them, and you never use theirs. Saved values are
          encrypted on the server and never shown again.
        </p>
        <p className="mt-2 text-xs text-muted">
          Saving a credential never starts a search, generation or tracking run, and doesn&apos;t lift spending limits. On Preview, paid provider calls stay switched off
          except the capped SerpApi smoke test.
        </p>
        {!data.storageConfigured && (
          <p role="alert" className="mt-3 rounded-md border px-3 py-2 text-sm" style={{ color: "var(--bad)" }}>
            Credential storage isn&apos;t configured on this server (CREDENTIALS_ENCRYPTION_KEY), so credentials can&apos;t be saved here.
          </p>
        )}
      </Card>

      <LegacySerpKeys state={data.legacySerp} onAction={(body) => call("/api/account/credentials/legacy-serpapi", { method: "POST", body: JSON.stringify(body) })} />

      <Card title="Providers">
        {CREDENTIAL_PROVIDERS.map((spec) => {
          const status = data.providers.find((p) => p.provider === spec.id)!;
          const base = `/api/account/credentials/${spec.id}`;
          return (
            <CredentialField
              key={spec.id}
              label={spec.label}
              usedFor={spec.usedFor}
              fields={spec.fields}
              docsHref={spec.docsHref}
              checkNote={spec.checkNote}
              status={status}
              onSave={(values) => call(base, { method: "PUT", body: JSON.stringify({ values }) })}
              onRemove={() => call(base, { method: "DELETE" })}
              onCheck={() => call(`${base}/check`, { method: "POST" })}
            />
          );
        })}
      </Card>
    </>
  );
}

/** Legacy SerpApi keys stored on projects before account credentials, waiting for an explicit decision. */
function LegacySerpKeys({ state, onAction }: { state: LegacySerpState; onAction: (body: { action: "adopt" | "clear"; projectId: number }) => Promise<string | null> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (state.status === "none" && !state.consolidated) return null;
  const act = async (key: string, body: { action: "adopt" | "clear"; projectId: number }) => {
    setBusy(key);
    setError(await onAction(body));
    setBusy(null);
  };
  return (
    <Card title="SerpApi keys stored on projects">
      {state.consolidated > 0 && (
        <p className="text-sm text-muted">
          Moved {state.consolidated} identical project key{state.consolidated === 1 ? "" : "s"} into your account&apos;s SerpApi credential (encrypted) and removed the
          plain-text project cop{state.consolidated === 1 ? "y" : "ies"}.
        </p>
      )}
      {state.status === "storage-unavailable" && <p className="text-sm text-muted">These can be moved once credential storage is configured.</p>}
      {state.pending.length > 0 && (
        <>
          <p className="text-sm">
            {state.pending.length === 1
              ? "A project you owned before the team workspace still stores its own SerpApi key, different from yours. It isn't used for any run; decide whether it becomes your key or is removed."
              : `Projects you owned before the team workspace still store ${state.pending.length} different SerpApi keys. None is used for runs and nothing was chosen automatically; decide for each.`}
          </p>
          <ul className="mt-3 divide-y">
            {state.pending.map((k) => (
              <li key={k.fingerprint} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-mono">••••{k.last4}</span>
                <span className="min-w-0 flex-1 text-muted">Used by {k.projects.map((p) => p.name).join(", ")}</span>
                <button className={buttonClass} disabled={busy !== null} onClick={() => act(`adopt-${k.fingerprint}`, { action: "adopt", projectId: k.projects[0].id })}>
                  {busy === `adopt-${k.fingerprint}` ? "Saving…" : "Use as account key"}
                </button>
                {k.projects.map((p) => (
                  <button key={p.id} className="text-xs text-muted hover:text-bad" disabled={busy !== null} onClick={() => act(`clear-${p.id}`, { action: "clear", projectId: p.id })}>
                    Remove from {p.name}
                  </button>
                ))}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            &ldquo;Use as account key&rdquo; replaces your own SerpApi credential with this key and removes its project copies. &ldquo;Remove from …&rdquo; deletes the stored copy
            from that project.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
    </Card>
  );
}

/** The Bing Webmaster key, kept in its existing editor (Tracking & connections). */
function OtherConnections({ bingConnected, onOpen }: { bingConnected: boolean; onOpen: () => void }) {
  const badge = (on: boolean | null) => (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? "var(--good)" : on === null ? "var(--muted, #888)" : "var(--bad)" }} aria-hidden="true" />
      {on === null ? "Unknown" : on ? "Connected" : "Not connected"}
    </span>
  );
  return (
    <Card
      title="Bing Webmaster Tools"
      actions={
        <button className={buttonClass} onClick={onOpen}>
          Edit
        </button>
      }
    >
      <ul className="divide-y text-sm">
        <li className="flex flex-wrap items-center gap-3 py-2.5">
          <span className="w-48 font-medium">Bing Webmaster Tools</span>
          {badge(bingConnected)}
          <span className="text-muted">API key for every verified Bing site.</span>
        </li>
      </ul>
    </Card>
  );
}
