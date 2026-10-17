// Shared Google data connections (migration 0014): the workspace's authorized Google accounts (the two shared
// analytics accounts, or a person's own eligible account) that read Search Console and GA4 for mapped projects.
// Viewers never sign into analytics themselves: reports read through the project's mapped connection.
//
// - Identified by Google's verified identity (issuer, subject). Reconnecting the same account updates its tokens and
//   keeps every mapping; a different account is a different connection — never a silent substitute. Connections
//   created by the migration have no subject yet: the first reconnect binds the subject only if Google's verified
//   address equals the connection's address.
// - Refresh and access tokens are encrypted (AES-256-GCM, bound to "google-connection:<id>:…"). A connection created
//   by the migration reads its legacy plaintext token once and stores it encrypted; the legacy column is left as is
//   so the previous release keeps working after a rollback.
// - A revoked or expired grant marks the connection "needs-reconnect"; nothing pretends it still works.

import { db, withTransaction } from "@/lib/db";
import { decryptWithContext, encryptWithContext, packSecret, unpackSecret } from "@/lib/credentials/crypto";
import { oauthClient } from "./oauth";
import type { VerifiedIdentity } from "@/lib/auth/eligibility";
import { SHARED_CONNECTION_ACCOUNTS } from "@/lib/auth/eligibility";
import type { Credentials } from "google-auth-library";

export interface GoogleConnection {
  id: number;
  workspaceId: number;
  email: string;
  status: "ok" | "needs-reconnect" | "disconnected";
  scopes: string | null;
  shared: boolean;
  grantedByUserId: number | null;
  grantedByName: string | null;
  lastError: string | null;
  updatedAt: number;
  /** Bound to a verified Google identity (false until a migrated connection is reconnected once). */
  identityBound: boolean;
  projects: number;
}

export class ConnectionUnavailableError extends Error {
  constructor(
    readonly connectionId: number | null,
    readonly reason: "not-mapped" | "needs-reconnect" | "disconnected" | "missing",
    readonly email: string | null = null,
  ) {
    super(
      reason === "not-mapped"
        ? "No Google connection is mapped for this data."
        : reason === "missing"
          ? "The mapped Google connection no longer exists."
          : `The Google connection ${email ?? ""} ${reason === "disconnected" ? "was disconnected" : "needs to be reconnected"}. Reconnect it in Account → Data connections.`.replace("  ", " "),
    );
    this.name = "ConnectionUnavailableError";
  }
}

const refreshContext = (id: number) => `google-connection:${id}:refresh`;
const accessContext = (id: number) => `google-connection:${id}:access`;

function toConnection(r: Record<string, unknown>): GoogleConnection {
  return {
    id: Number(r.id),
    workspaceId: Number(r.workspace_id),
    email: String(r.email),
    status: (["ok", "needs-reconnect", "disconnected"].includes(String(r.status)) ? r.status : "needs-reconnect") as GoogleConnection["status"],
    scopes: (r.scopes as string | null) ?? null,
    shared: SHARED_CONNECTION_ACCOUNTS.includes(String(r.email).toLowerCase()),
    grantedByUserId: r.granted_by_user_id == null ? null : Number(r.granted_by_user_id),
    grantedByName: (r.granted_by_name as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    updatedAt: Number(r.updated_at),
    identityBound: r.subject != null,
    projects: Number(r.projects ?? 0),
  };
}

const SELECT = `SELECT c.*, COALESCE(g.name, g.email) AS granted_by_name,
       (SELECT COUNT(*)::int FROM projects p WHERE p.deleted_at IS NULL AND (p.gsc_connection_id = c.id OR p.ga_connection_id = c.id)) AS projects
  FROM google_connections c LEFT JOIN users g ON g.id = c.granted_by_user_id`;

export async function listConnections(workspaceId: number): Promise<GoogleConnection[]> {
  const rows = (await db.prepare(`${SELECT} WHERE c.workspace_id = ? ORDER BY lower(c.email), c.id`).all(workspaceId)) as Record<string, unknown>[];
  return rows.map(toConnection);
}

export async function getConnection(id: number, workspaceId: number): Promise<GoogleConnection | null> {
  const r = (await db.prepare(`${SELECT} WHERE c.id = ? AND c.workspace_id = ?`).get(id, workspaceId)) as Record<string, unknown> | undefined;
  return r ? toConnection(r) : null;
}

/** Projects that read through a connection (shown before a deliberate disconnection). */
export async function projectsUsingConnection(id: number): Promise<Array<{ id: number; name: string; uses: string[] }>> {
  const rows = (await db
    .prepare(
      `SELECT id, name, gsc_connection_id = ? AS gsc, ga_connection_id = ? AS ga FROM projects
        WHERE deleted_at IS NULL AND (gsc_connection_id = ? OR ga_connection_id = ?) ORDER BY lower(name)`,
    )
    .all(id, id, id, id)) as Array<{ id: number; name: string; gsc: boolean; ga: boolean }>;
  return rows.map((r) => ({ id: Number(r.id), name: r.name, uses: [r.gsc ? "Search Console" : null, r.ga ? "GA4" : null].filter(Boolean) as string[] }));
}

/**
 * Stores a fresh grant from the data-connection OAuth flow. Matched by verified identity; a migrated connection is
 * bound on its first reconnect when Google's verified address equals its address. Returns the connection id.
 */
export async function saveGrant(opts: {
  workspaceId: number;
  identity: VerifiedIdentity;
  tokens: Credentials;
  grantedBy: number;
}): Promise<{ id: number; created: boolean }> {
  const { identity, tokens } = opts;
  if (!tokens.refresh_token) throw new Error("Google didn't return a refresh token. Try connecting again (consent is required).");
  const now = Date.now();
  return withTransaction(async (q) => {
    let [row] = await q("SELECT id FROM google_connections WHERE issuer = ? AND subject = ? FOR UPDATE", identity.issuer, identity.subject);
    let created = false;
    if (!row) {
      [row] = await q(
        "SELECT id FROM google_connections WHERE workspace_id = ? AND subject IS NULL AND lower(email) = ? ORDER BY id LIMIT 1 FOR UPDATE",
        opts.workspaceId,
        identity.email,
      );
    }
    if (!row) {
      [row] = await q(
        `INSERT INTO google_connections (workspace_id, issuer, subject, email, status, granted_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ok', ?, ?, ?) RETURNING id`,
        opts.workspaceId,
        identity.issuer,
        identity.subject,
        identity.email,
        opts.grantedBy,
        now,
        now,
      );
      created = true;
    }
    const id = Number(row.id);
    const refresh = encryptWithContext(refreshContext(id), tokens.refresh_token!);
    const access = tokens.access_token ? packSecret(encryptWithContext(accessContext(id), tokens.access_token)) : null;
    await q(
      `UPDATE google_connections SET issuer = ?, subject = ?, email = ?, ciphertext = ?, key_id = ?, access_token = ?, access_expiry = ?, scopes = ?,
              status = 'ok', last_error = NULL, granted_by_user_id = ?, updated_at = ? WHERE id = ?`,
      identity.issuer,
      identity.subject,
      identity.email,
      refresh.ciphertext,
      refresh.keyId,
      access,
      tokens.expiry_date ?? now + 3500_000,
      tokens.scope ?? null,
      opts.grantedBy,
      now,
      id,
    );
    return { id, created };
  });
}

interface TokenRow {
  id: number;
  email: string;
  status: string;
  ciphertext: string | null;
  key_id: string | null;
  access_token: string | null;
  access_expiry: number | null;
  legacy_user_id: number | null;
}

/** Moves a migrated connection's legacy plaintext refresh token into encrypted storage (once; legacy column untouched). */
async function adoptLegacy(row: TokenRow): Promise<TokenRow> {
  if (row.ciphertext || row.legacy_user_id == null) return row;
  const u = (await db.prepare("SELECT google_refresh_token, google_scopes FROM users WHERE id = ?").get(row.legacy_user_id)) as
    | { google_refresh_token: string | null; google_scopes: string | null }
    | undefined;
  if (!u?.google_refresh_token) return row;
  const enc = encryptWithContext(refreshContext(row.id), u.google_refresh_token);
  await db
    .prepare("UPDATE google_connections SET ciphertext = ?, key_id = ?, scopes = COALESCE(scopes, ?), status = 'ok', updated_at = ? WHERE id = ? AND ciphertext IS NULL")
    .run(enc.ciphertext, enc.keyId, u.google_scopes, Date.now(), row.id);
  return { ...row, ciphertext: enc.ciphertext, key_id: enc.keyId, status: row.status === "needs-reconnect" ? "ok" : row.status };
}

/** A valid access token for a connection (refreshed and stored encrypted when needed). */
export async function connectionAccessToken(connectionId: number): Promise<string> {
  let row = (await db
    .prepare("SELECT id, email, status, ciphertext, key_id, access_token, access_expiry, legacy_user_id FROM google_connections WHERE id = ?")
    .get(connectionId)) as TokenRow | undefined;
  if (!row) throw new ConnectionUnavailableError(connectionId, "missing");
  // A deliberate disconnection is final until a reconnect: never revived from the legacy column.
  if (row.status === "disconnected") throw new ConnectionUnavailableError(connectionId, "disconnected", row.email);
  row = await adoptLegacy(row);
  const now = Date.now();
  if (row.access_token && row.access_expiry && Number(row.access_expiry) - 60_000 > now) {
    const packed = unpackSecret(row.access_token);
    if (packed) return decryptWithContext(accessContext(row.id), packed.ciphertext, packed.keyId);
  }
  if (!row.ciphertext || !row.key_id) throw new ConnectionUnavailableError(connectionId, "needs-reconnect", row.email);
  const client = oauthClient();
  client.setCredentials({ refresh_token: decryptWithContext(refreshContext(row.id), row.ciphertext, row.key_id) });
  let credentials: Credentials;
  try {
    ({ credentials } = await client.refreshAccessToken());
  } catch (e) {
    const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
    const msg = e instanceof Error ? e.message : String(e);
    if (code === "invalid_grant" || /invalid_grant/i.test(msg)) {
      await db
        .prepare("UPDATE google_connections SET status = 'needs-reconnect', access_token = NULL, access_expiry = NULL, last_error = ?, updated_at = ? WHERE id = ?")
        .run("Google rejected the saved grant (revoked or expired).", now, row.id);
      throw new ConnectionUnavailableError(connectionId, "needs-reconnect", row.email);
    }
    if (code === "invalid_client" || /invalid_client/i.test(msg)) {
      throw new Error("Google rejected this app's OAuth credentials (invalid_client). GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must come from the same, still-existing OAuth client.");
    }
    throw e;
  }
  const token = credentials.access_token!;
  await db
    .prepare("UPDATE google_connections SET access_token = ?, access_expiry = ?, scopes = COALESCE(?, scopes), status = 'ok', last_error = NULL, updated_at = ? WHERE id = ?")
    .run(packSecret(encryptWithContext(accessContext(row.id), token)), credentials.expiry_date ?? now + 3500_000, credentials.scope ?? null, now, row.id);
  return token;
}

/**
 * Disconnects a connection deliberately: its tokens are removed and it stops serving data; mappings stay so a
 * reconnect of the same Google account restores every project. Only the person who granted it may do this (anyone
 * else can take it over by reconnecting the same Google account, which proves control of it).
 */
export async function disconnectConnection(id: number, workspaceId: number, actorUserId: number): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = await getConnection(id, workspaceId);
  if (!c) return { ok: false, message: "Unknown connection." };
  if (c.grantedByUserId !== actorUserId) {
    return { ok: false, message: `Only ${c.grantedByName ?? "the person who connected it"} can disconnect this connection. Anyone who can sign in to ${c.email} can reconnect it and then manage it.` };
  }
  await db
    .prepare("UPDATE google_connections SET status = 'disconnected', ciphertext = NULL, key_id = NULL, access_token = NULL, access_expiry = NULL, updated_at = ? WHERE id = ?")
    .run(Date.now(), id);
  return { ok: true };
}

/** A Google token source: a project's shared connection. */
export interface GoogleTokenSource {
  token: () => Promise<string>;
}

/** Whether an error means the Google grant must be reconnected (shown as a reconnect state, not a failure). */
export function isReconnectError(e: unknown): boolean {
  return e instanceof ConnectionUnavailableError || (e instanceof Error && e.name === "GoogleReauthRequiredError");
}
