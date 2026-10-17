// The one server-side place that decides which provider credential a request uses. Every consumer — Google
// Search Tracking, Brand Mentions, Maps reviews, review classification, usage reporting — goes through here.
//
// Team workspace rule (docs/seo-console-v2/WORKSPACE-MEMBERS.md, section 5): a paid request uses the acting User's
// OWN encrypted credential (Account → API credentials) and nothing else — never the project manager's, an analytics
// account's, another User's, a legacy key left on a project, or a shared server key. With no key of their own the
// person gets a setup message. Legacy per-project keys are only reachable through the protected consolidation
// path below (their legacy owner) or the operator script (scripts/workspace/claimLegacyKey.mts).

import { db } from "@/lib/db";
import { fingerprintOf, credentialFingerprint, readCredential, saveCredential } from "./store";
import { storageConfigured } from "./crypto";
import type { CredentialProvider } from "./providers";

export type CredentialSource = "project-legacy" | "account" | "server-legacy";

export interface ResolvedSecret {
  values: Record<string, string>;
  source: CredentialSource;
  fingerprint: string;
}

type Env = Record<string, string | undefined>;

async function projectLegacyKey(userId: number, projectId: number): Promise<string | null> {
  const r = (await db.prepare("SELECT serpapi_key FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId)) as
    | { serpapi_key: string | null }
    | undefined;
  return r?.serpapi_key?.trim() || null;
}

/** The acting User's own credential for a provider (the project id is accepted for callers' symmetry, unused). Null when they have none. */
export async function resolveCredential(
  userId: number,
  provider: CredentialProvider,
  _projectId: number | null = null,
  env: Env = process.env,
): Promise<ResolvedSecret | null> {
  if (!storageConfigured(env)) return null;
  const own = await readCredential(userId, provider);
  return own ? { values: own.values, source: "account", fingerprint: own.fingerprint } : null;
}

// --- Legacy project SerpApi keys -----------------------------------------------------------------------------

export interface LegacySerpKey {
  fingerprint: string;
  last4: string;
  projects: Array<{ id: number; name: string }>;
}

export interface LegacySerpState {
  /** none: no project keys left; consolidated: identical keys moved to the account; conflict: choices needed. */
  status: "none" | "consolidated" | "conflict" | "storage-unavailable";
  /** Project keys still waiting for a decision (each distinct key once, with the projects that use it). */
  pending: LegacySerpKey[];
  /** Projects whose identical key was just moved into the account credential. */
  consolidated: number;
}

async function legacyRows(userId: number): Promise<Array<{ id: number; name: string; key: string }>> {
  const rows = (await db
    .prepare("SELECT id, name, serpapi_key FROM projects WHERE user_id = ? AND serpapi_key IS NOT NULL AND serpapi_key <> '' ORDER BY id")
    .all(userId)) as unknown as Array<{ id: number; name: string; serpapi_key: string }>;
  return rows.map((r) => ({ id: Number(r.id), name: r.name, key: r.serpapi_key.trim() }));
}

async function clearProjectKeys(userId: number, ids: number[]): Promise<void> {
  for (const id of ids) {
    await db.prepare("UPDATE projects SET serpapi_key = NULL, serpapi_key_updated_at = NULL WHERE id = ? AND user_id = ?").run(id, userId);
  }
}

function group(rows: Array<{ id: number; name: string; key: string }>): Map<string, { key: string; projects: Array<{ id: number; name: string }> }> {
  const out = new Map<string, { key: string; projects: Array<{ id: number; name: string }> }>();
  for (const r of rows) {
    const fp = fingerprintOf(r.key);
    const g = out.get(fp) ?? { key: r.key, projects: [] };
    g.projects.push({ id: r.id, name: r.name });
    out.set(fp, g);
  }
  return out;
}

/**
 * Moves legacy project SerpApi keys into the account credential where that needs no choice:
 * - keys identical to the account's credential are removed from the projects (the account key covers them);
 * - when the account has none and every project uses the same key, that key becomes the account credential
 *   (encrypted) and the plain-text project copies are removed.
 * Different keys are never chosen between, overwritten or merged: they stay on their projects (and keep working)
 * until the owner picks one in Settings. Idempotent; scoped to this account's projects only.
 */
export async function consolidateLegacySerpKeys(userId: number): Promise<LegacySerpState> {
  const rows = await legacyRows(userId);
  if (!rows.length) return { status: "none", pending: [], consolidated: 0 };
  if (!storageConfigured()) return { status: "storage-unavailable", pending: summarize(group(rows)), consolidated: 0 };
  let groups = group(rows);
  let consolidated = 0;
  const accountFp = await credentialFingerprint(userId, "serpapi");
  if (accountFp && groups.has(accountFp)) {
    const ids = groups.get(accountFp)!.projects.map((p) => p.id);
    await clearProjectKeys(userId, ids);
    consolidated += ids.length;
    groups.delete(accountFp);
  } else if (!accountFp && groups.size === 1) {
    const [[, g]] = [...groups];
    await saveCredential(userId, "serpapi", { apiKey: g.key });
    await clearProjectKeys(userId, g.projects.map((p) => p.id));
    consolidated += g.projects.length;
    groups = new Map();
  }
  return { status: groups.size ? "conflict" : "consolidated", pending: summarize(groups), consolidated };
}

function summarize(groups: Map<string, { key: string; projects: Array<{ id: number; name: string }> }>): LegacySerpKey[] {
  return [...groups].map(([fingerprint, g]) => ({ fingerprint, last4: g.key.slice(-4), projects: g.projects }));
}

/**
 * Explicit choice: makes the key stored on one of this account's projects the account's SerpApi credential
 * (replacing any account key), then removes every project copy of that same key. Other, different project keys
 * are left alone. Returns false when the project isn't the user's or has no key.
 */
export async function adoptLegacySerpKey(userId: number, projectId: number): Promise<boolean> {
  const key = await projectLegacyKey(userId, projectId);
  if (!key) return false;
  await saveCredential(userId, "serpapi", { apiKey: key });
  const fp = fingerprintOf(key);
  const same = (await legacyRows(userId)).filter((r) => fingerprintOf(r.key) === fp).map((r) => r.id);
  await clearProjectKeys(userId, same);
  return true;
}
