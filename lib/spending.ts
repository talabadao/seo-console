// Who pays for paid provider work in the team workspace (docs/seo-console-v2/WORKSPACE-MEMBERS.md, section 5).
//
// - Manual paid actions: the acting User — a project management member — with their own key and budget
//   (lib/credentials/resolve.ts returns only their own credential). Routes enforce management access.
// - Scheduled paid actions: the project's PRIMARY MANAGER, and only after they enabled scheduled spending for that
//   provider in their own settings (a personal consent, not a project role). An editor can't consent for someone
//   else; transferring primary management pauses paid schedules until the new manager enables it.
// - Every scheduled job records the payer, the credential fingerprint and an authorization version, and
//   authorizeScheduledRun rechecks all of them right before execution: a changed primary manager, withdrawn
//   consent, replaced key, lost access, inactive payer or deleted project blocks the run with a reason — it never
//   picks another person's key. Budgets are enforced by the existing policy (lib/providers/policy.ts) for the payer.
// No paid feature runs on a schedule in this release (tracking and Brand Mentions start by hand); these are the
// rules any scheduled paid job must use.

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { credentialFingerprint } from "@/lib/credentials/store";
import type { CredentialProvider } from "@/lib/credentials/providers";

export const SPENDING_PROVIDERS: CredentialProvider[] = ["serpapi", "openai", "anthropic", "dataforseo"];

export interface ScheduledSpendingSetting {
  provider: CredentialProvider;
  enabled: boolean;
  version: number;
  updatedAt: number | null;
}

/** The User's own scheduled-spending consents (missing providers are off). */
export async function scheduledSpending(userId: number): Promise<ScheduledSpendingSetting[]> {
  const rows = (await db.prepare("SELECT provider, enabled, version, updated_at FROM scheduled_spending WHERE user_id = ?").all(userId)) as Array<Record<string, unknown>>;
  return SPENDING_PROVIDERS.map((provider) => {
    const r = rows.find((x) => x.provider === provider);
    return { provider, enabled: Boolean(r?.enabled), version: r ? Number(r.version) : 0, updatedAt: r ? Number(r.updated_at) : null };
  });
}

/** Turns the User's own consent on or off for a provider (each change bumps its version). */
export async function setScheduledSpending(userId: number, provider: CredentialProvider, enabled: boolean): Promise<ScheduledSpendingSetting[]> {
  if (!SPENDING_PROVIDERS.includes(provider)) throw new Error("Unknown provider.");
  await db
    .prepare(
      `INSERT INTO scheduled_spending (user_id, provider, enabled, version, updated_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (user_id, provider) DO UPDATE SET enabled = EXCLUDED.enabled, version = scheduled_spending.version + 1, updated_at = EXCLUDED.updated_at`,
    )
    .run(userId, provider, enabled, Date.now());
  return scheduledSpending(userId);
}

export interface ScheduledAuthorization {
  payerUserId: number;
  credentialFingerprint: string;
  /** "<project spending_version>.<consent version>": recorded on the job, compared at execution. */
  version: string;
}

export type PayerDecision = ({ ok: true } & ScheduledAuthorization) | { ok: false; code: string; reason: string };

/** Who would pay for a scheduled paid job of this project and provider right now, or why nobody may. */
export async function scheduledPayer(projectId: number, provider: CredentialProvider): Promise<PayerDecision> {
  const p = (await db
    .prepare(
      `SELECT p.id, p.primary_manager_id, p.spending_version, p.deleted_at, u.status, u.kind, u.workspace_id,
              EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = p.primary_manager_id) AS is_member
         FROM projects p LEFT JOIN users u ON u.id = p.primary_manager_id WHERE p.id = ?`,
    )
    .get(projectId)) as Record<string, unknown> | undefined;
  if (!p || p.deleted_at != null) return { ok: false, code: "project-gone", reason: "The project was deleted." };
  if (p.primary_manager_id == null) return { ok: false, code: "no-manager", reason: "The project has no primary manager, so paid schedules are paused." };
  if (p.kind !== "person" || p.status !== "active" || p.workspace_id == null || !p.is_member) {
    return { ok: false, code: "payer-inactive", reason: "The primary manager can no longer pay for this project, so paid schedules are paused." };
  }
  const payer = Number(p.primary_manager_id);
  const consent = (await db.prepare("SELECT enabled, version FROM scheduled_spending WHERE user_id = ? AND provider = ?").get(payer, provider)) as
    | { enabled: boolean; version: number }
    | undefined;
  if (!consent?.enabled) {
    return { ok: false, code: "no-consent", reason: `Paid schedules are paused until the primary manager enables scheduled ${provider} spending in their own settings.` };
  }
  const fp = await credentialFingerprint(payer, provider);
  if (!fp) return { ok: false, code: "no-key", reason: `The primary manager has no ${provider} key of their own, so paid schedules are paused.` };
  return { ok: true, payerUserId: payer, credentialFingerprint: fp, version: `${Number(p.spending_version)}.${Number(consent.version)}` };
}

/**
 * Rechecks a scheduled job's recorded authorization right before it runs. Anything that changed since it was
 * queued (primary manager, consent, key, project version) blocks it; the caller marks the job cancelled and tells
 * the payer and the project's managers (lib/notifications/store.ts notifySpendingFailure).
 */
export async function authorizeScheduledRun(projectId: number, provider: CredentialProvider, recorded: ScheduledAuthorization): Promise<PayerDecision> {
  const now = await scheduledPayer(projectId, provider);
  if (!now.ok) return now;
  if (now.payerUserId !== recorded.payerUserId) {
    return { ok: false, code: "payer-changed", reason: "The primary manager changed after this run was scheduled; it was not charged to anyone." };
  }
  if (now.credentialFingerprint !== recorded.credentialFingerprint) {
    return { ok: false, code: "key-changed", reason: "The payer's key changed after this run was scheduled; it was not run." };
  }
  if (now.version !== recorded.version) {
    return { ok: false, code: "authorization-changed", reason: "Spending authorization changed after this run was scheduled; it was not run." };
  }
  return now;
}

/** Queues a scheduled paid run with its recorded authorization (status 'queued'); refused when nobody may pay. */
export async function queueScheduledRun(projectId: number, kind: string, provider: CredentialProvider, estimate: unknown): Promise<{ ok: true; runId: string } | { ok: false; reason: string; code: string }> {
  const payer = await scheduledPayer(projectId, provider);
  if (!payer.ok) return payer;
  const runId = `sched-${kind}-${projectId}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  await db
    .prepare(
      `INSERT INTO ai_runs (id, user_id, project_id, kind, trigger, status, estimate, started_at, payer_user_id, credential_fingerprint, authorization_version, origin_user_id)
       VALUES (?, ?, ?, ?, 'schedule', 'queued', ?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, payer.payerUserId, projectId, kind, JSON.stringify({ provider, estimate, authorization: payer.version }), Date.now(), payer.payerUserId, payer.credentialFingerprint, null, payer.payerUserId);
  return { ok: true, runId };
}

/** The recorded authorization of a queued scheduled run. */
export async function recordedAuthorization(runId: string): Promise<(ScheduledAuthorization & { projectId: number; provider: CredentialProvider; status: string }) | null> {
  const r = (await db.prepare("SELECT project_id, status, estimate, payer_user_id, credential_fingerprint FROM ai_runs WHERE id = ?").get(runId)) as Record<string, unknown> | undefined;
  if (!r) return null;
  const est = (typeof r.estimate === "string" ? JSON.parse(r.estimate) : r.estimate) as { provider?: CredentialProvider; authorization?: string } | null;
  return {
    projectId: Number(r.project_id),
    status: String(r.status),
    provider: (est?.provider ?? "serpapi") as CredentialProvider,
    payerUserId: Number(r.payer_user_id),
    credentialFingerprint: String(r.credential_fingerprint ?? ""),
    version: String(est?.authorization ?? ""),
  };
}
