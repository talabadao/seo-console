// The one server-side place that decides which provider credential a request uses. Every consumer — Google
// Search Tracking, Brand Mentions, Maps reviews, review classification, usage reporting — goes through here.
//
// Order (owner decision, 2026-10-17):
// 1. The signed-in account's own encrypted credential (Account → API credentials).
// 2. SerpApi only: a legacy key still stored on the project (from before account credentials), until the owner
//    consolidates or resolves it. The project must belong to the user. It no longer overrides a newer account key:
//    an old, exhausted or invalid project key used to win silently over the key the owner had just saved.
// 3. A server environment key (SERPAPI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, DATAFORSEO_LOGIN/PASSWORD)
//    only for accounts listed in LEGACY_SERVER_CREDENTIAL_ACCOUNTS — an explicit, auditable scope. Empty by
//    default: there is no silent global fallback for every account.

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

async function emailOf(userId: number): Promise<string | null> {
  const r = (await db.prepare("SELECT email FROM users WHERE id = ?").get(userId)) as { email: string } | undefined;
  return r?.email?.trim().toLowerCase() ?? null;
}

/** Whether this account may use the server's own provider keys (explicit list; empty by default). */
export async function serverKeysAllowed(userId: number, env: Env = process.env): Promise<boolean> {
  const list = (env.LEGACY_SERVER_CREDENTIAL_ACCOUNTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return false;
  const email = await emailOf(userId);
  return Boolean(email && list.includes(email));
}

function serverValues(provider: CredentialProvider, env: Env): Record<string, string> | null {
  const v = (name: string) => env[name]?.trim() || "";
  if (provider === "serpapi") return v("SERPAPI_API_KEY") ? { apiKey: v("SERPAPI_API_KEY") } : null;
  if (provider === "openai") return v("OPENAI_API_KEY") ? { apiKey: v("OPENAI_API_KEY") } : null;
  if (provider === "anthropic") return v("ANTHROPIC_API_KEY") ? { apiKey: v("ANTHROPIC_API_KEY") } : null;
  return v("DATAFORSEO_LOGIN") && v("DATAFORSEO_PASSWORD") ? { login: v("DATAFORSEO_LOGIN"), password: v("DATAFORSEO_PASSWORD") } : null;
}

async function projectLegacyKey(userId: number, projectId: number): Promise<string | null> {
  const r = (await db.prepare("SELECT serpapi_key FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId)) as
    | { serpapi_key: string | null }
    | undefined;
  return r?.serpapi_key?.trim() || null;
}

/** Resolves a provider credential for the signed-in account (and project, for SerpApi). Null when none applies. */
export async function resolveCredential(
  userId: number,
  provider: CredentialProvider,
  projectId: number | null = null,
  env: Env = process.env,
): Promise<ResolvedSecret | null> {
  if (storageConfigured(env)) {
    const own = await readCredential(userId, provider);
    if (own) return { values: own.values, source: "account", fingerprint: own.fingerprint };
  }
  if (provider === "serpapi" && projectId != null) {
    const legacy = await projectLegacyKey(userId, projectId);
    if (legacy) return { values: { apiKey: legacy }, source: "project-legacy", fingerprint: fingerprintOf(legacy) };
  }
  if (await serverKeysAllowed(userId, env)) {
    const server = serverValues(provider, env);
    if (server) {
      const main = provider === "dataforseo" ? `${server.login}:${server.password}` : server.apiKey;
      return { values: server, source: "server-legacy", fingerprint: fingerprintOf(main) };
    }
  }
  return null;
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
