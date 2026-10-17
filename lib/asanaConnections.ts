// Asana in the team workspace (docs/seo-console-v2/WORKSPACE-MEMBERS.md, section 7).
// - Reporting connections: an Asana personal access token a team member saves for the workspace (the existing,
//   supported mechanism; no plan or service account needed), encrypted and bound to its connection. A project maps
//   its Asana project through one connection, which must actually have access to it.
// - Each person's verified Asana user (gid): confirmed by them, either by picking the Asana user whose email is
//   exactly one of their verified logins (Asana verifies its emails; the match is only a suggestion until
//   confirmed) or by proving it with their own token once (not stored). Task alerts follow this gid.
// Connections migrated from the legacy per-login token read it once and store it encrypted (legacy column untouched).

import { db } from "@/lib/db";
import { decryptWithContext, encryptWithContext } from "@/lib/credentials/crypto";
import { fingerprintOf } from "@/lib/credentials/store";
import { getProject as getAsanaProject, verifyAsanaToken } from "@/lib/asana";
import { providerFetch } from "@/lib/sync/providerHttp";
import { keyFingerprint } from "@/lib/providers/ledger";

export interface AsanaConnection {
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

export class AsanaUnavailableError extends Error {}

const context = (id: number) => `asana-connection:${id}:token`;

export async function listAsanaConnections(workspaceId: number): Promise<AsanaConnection[]> {
  const rows = (await db
    .prepare(
      `SELECT a.*, COALESCE(g.name, g.email) AS granted_by_name, lu.name AS legacy_name,
              (SELECT COUNT(*)::int FROM projects p WHERE p.asana_connection_id = a.id AND p.deleted_at IS NULL) AS projects
         FROM asana_connections a LEFT JOIN users g ON g.id = a.granted_by_user_id LEFT JOIN users lu ON lu.id = a.legacy_user_id
        WHERE a.workspace_id = ? ORDER BY a.id`,
    )
    .all(workspaceId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    hint: (r.hint as string | null) ?? null,
    asanaUserName: (r.asana_user_name as string | null) ?? null,
    status: String(r.status),
    lastError: (r.last_error as string | null) ?? null,
    grantedByUserId: r.granted_by_user_id == null ? null : Number(r.granted_by_user_id),
    grantedByName: (r.granted_by_name as string | null) ?? null,
    projects: Number(r.projects),
    updatedAt: Number(r.updated_at),
  }));
}

/** The decrypted token of a connection, for server-side Asana calls only. */
export async function asanaToken(connectionId: number): Promise<string> {
  const r = (await db.prepare("SELECT id, ciphertext, key_id, status, legacy_user_id FROM asana_connections WHERE id = ?").get(connectionId)) as
    | { id: number; ciphertext: string | null; key_id: string | null; status: string; legacy_user_id: number | null }
    | undefined;
  if (!r) throw new AsanaUnavailableError("The mapped Asana connection no longer exists.");
  if (r.status === "disconnected") throw new AsanaUnavailableError("The Asana connection was disconnected. Reconnect it in Account → Data connections.");
  if (r.ciphertext && r.key_id) return decryptWithContext(context(Number(r.id)), r.ciphertext, r.key_id);
  if (r.legacy_user_id != null) {
    const u = (await db.prepare("SELECT asana_api_token FROM users WHERE id = ?").get(r.legacy_user_id)) as { asana_api_token: string | null } | undefined;
    const token = u?.asana_api_token?.trim();
    if (token) {
      const enc = encryptWithContext(context(Number(r.id)), token);
      await db
        .prepare("UPDATE asana_connections SET ciphertext = ?, key_id = ?, hint = ?, token_fingerprint = ?, updated_at = ? WHERE id = ? AND ciphertext IS NULL")
        .run(enc.ciphertext, enc.keyId, token.slice(-4), fingerprintOf(token), Date.now(), r.id);
      return token;
    }
  }
  throw new AsanaUnavailableError("The Asana connection has no token. Reconnect it in Account → Data connections.");
}

/** Saves a reporting token for the workspace (verified first). The same token again updates its connection. */
export async function saveAsanaConnection(workspaceId: number, grantedBy: number, token: string): Promise<{ id: number; name: string }> {
  const clean = token.trim();
  if (!clean || clean.length > 500 || /\s/.test(clean)) throw new AsanaUnavailableError("That doesn't look like an Asana personal access token.");
  const me = await asanaMe(clean);
  const fp = fingerprintOf(clean);
  const now = Date.now();
  const existing = (await db.prepare("SELECT id FROM asana_connections WHERE workspace_id = ? AND token_fingerprint = ?").get(workspaceId, fp)) as { id: number } | undefined;
  const id = existing
    ? Number(existing.id)
    : Number(
        ((await db
          .prepare("INSERT INTO asana_connections (workspace_id, status, granted_by_user_id, created_at, updated_at) VALUES (?, 'ok', ?, ?, ?) RETURNING id")
          .get(workspaceId, grantedBy, now, now)) as { id: number }).id,
      );
  const enc = encryptWithContext(context(id), clean);
  await db
    .prepare(
      `UPDATE asana_connections SET ciphertext = ?, key_id = ?, hint = ?, token_fingerprint = ?, asana_user_gid = ?, asana_user_name = ?, status = 'ok',
              last_error = NULL, granted_by_user_id = ?, updated_at = ? WHERE id = ?`,
    )
    .run(enc.ciphertext, enc.keyId, clean.slice(-4), fp, me.gid, me.name, grantedBy, now, id);
  return { id, name: me.name };
}

async function asanaGet<T>(token: string, path: string): Promise<T> {
  const res = await providerFetch({
    provider: "asana",
    bucket: `asana:token:${keyFingerprint(token)}`,
    limit: { max: 2, windowMs: 1000 },
    url: `https://app.asana.com/api/1.0${path}`,
    init: { headers: { Authorization: `Bearer ${token}` } },
  });
  const body = await res.text();
  if (!res.ok) throw new AsanaUnavailableError(`Asana API ${res.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body) as T;
}

/** The Asana user a token belongs to. */
export async function asanaMe(token: string): Promise<{ gid: string; name: string; email: string | null; workspaces: string[] }> {
  const j = await asanaGet<{ data: { gid: string; name: string; email?: string; workspaces?: Array<{ gid: string }> } }>(token, "/users/me?opt_fields=gid,name,email,workspaces.gid");
  return { gid: j.data.gid, name: j.data.name, email: j.data.email ?? null, workspaces: (j.data.workspaces ?? []).map((w) => w.gid) };
}

/** Whether a connection can read an Asana project (validation before mapping it). */
export async function connectionCanReadProject(connectionId: number, projectGid: string): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  try {
    const p = await getAsanaProject(await asanaToken(connectionId), projectGid);
    return { ok: true, name: p.name };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Asana users whose email is exactly one of this person's verified login addresses, from the workspaces the
 * reporting connections can see. Suggestions only: the person confirms one.
 */
export async function asanaIdentitySuggestions(workspaceId: number, userId: number): Promise<Array<{ gid: string; name: string; email: string }>> {
  const emails = ((await db.prepare("SELECT lower(email) AS e FROM user_identities WHERE user_id = ?").all(userId)) as Array<{ e: string }>).map((r) => r.e);
  if (!emails.length) return [];
  const out = new Map<string, { gid: string; name: string; email: string }>();
  for (const c of await listAsanaConnections(workspaceId)) {
    let token: string;
    try {
      token = await asanaToken(c.id);
    } catch {
      continue;
    }
    const me = await asanaMe(token).catch(() => null);
    for (const ws of me?.workspaces ?? []) {
      const users = await asanaGet<{ data: Array<{ gid: string; name: string; email?: string }> }>(token, `/workspaces/${encodeURIComponent(ws)}/users?opt_fields=gid,name,email&limit=100`).catch(() => null);
      for (const u of users?.data ?? []) if (u.email && emails.includes(u.email.toLowerCase())) out.set(u.gid, { gid: u.gid, name: u.name, email: u.email });
    }
  }
  return [...out.values()];
}

/** Confirms the person's Asana user: a suggested match (rechecked here) or a token they own (not stored). */
export async function confirmAsanaIdentity(workspaceId: number, userId: number, input: { gid?: string; token?: string }): Promise<{ gid: string; name: string; via: string }> {
  let chosen: { gid: string; name: string } | null = null;
  let via = "";
  if (input.token) {
    const me = await asanaMe(input.token.trim());
    chosen = { gid: me.gid, name: me.name };
    via = "own-token";
  } else if (input.gid) {
    const s = (await asanaIdentitySuggestions(workspaceId, userId)).find((x) => x.gid === input.gid);
    if (!s) throw new AsanaUnavailableError("That Asana user doesn't match one of your verified login addresses. Verify with your own Asana token instead.");
    chosen = { gid: s.gid, name: s.name };
    via = "verified-email";
  }
  if (!chosen) throw new AsanaUnavailableError("Choose your Asana user or verify with your own token.");
  const taken = (await db.prepare("SELECT id FROM users WHERE asana_user_gid = ? AND id <> ? AND status = 'active'").get(chosen.gid, userId)) as { id: number } | undefined;
  if (taken) throw new AsanaUnavailableError("That Asana user is already confirmed by another team member.");
  await db
    .prepare("UPDATE users SET asana_user_gid = ?, asana_user_name = ?, asana_verified_at = ?, asana_verified_via = ?, updated_at = ? WHERE id = ?")
    .run(chosen.gid, chosen.name, Date.now(), via, Date.now(), userId);
  return { ...chosen, via };
}

export { verifyAsanaToken };
