// Verified Google identities and the canonical User they belong to (migration 0014).
// - A User (users row, kind 'person') is one human; several verified identities can belong to it. Every identity is
//   keyed by Google's stable (issuer, subject), never by name, email prefix or domain.
// - Sign-in: a known identity signs into its User. An unknown eligible identity either claims the legacy record that
//   has exactly its verified address and no identity yet (that record was created by an earlier sign-in of the same
//   Google account), or registers a new User in the team workspace.
// - Linking: proven by an active session (the User) plus a fresh Google sign-in of the other identity. If that
//   identity (or its legacy record) already belongs to another User, nothing is merged here: a merge request is
//   created for an explicit preview and choices (lib/auth/merge.ts).
// - The last identity can't be unlinked. Every event is written to identity_audit.

import { db, withTransaction } from "@/lib/db";
import { personalEligibility, type GoogleClaims, type IneligibleReason, type VerifiedIdentity } from "./eligibility";

export const TEAM_WORKSPACE_ID = 1;
export const MERGE_REQUEST_TTL_MS = 30 * 60_000;

export interface IdentityRow {
  id: number;
  userId: number;
  issuer: string;
  subject: string;
  email: string;
  hostedDomain: string | null;
  createdAt: number;
  lastLoginAt: number | null;
}

const toIdentity = (r: Record<string, unknown>): IdentityRow => ({
  id: Number(r.id),
  userId: Number(r.user_id),
  issuer: String(r.issuer),
  subject: String(r.subject),
  email: String(r.email),
  hostedDomain: (r.hosted_domain as string | null) ?? null,
  createdAt: Number(r.created_at),
  lastLoginAt: r.last_login_at == null ? null : Number(r.last_login_at),
});

export async function audit(event: string, opts: { userId?: number | null; identityId?: number | null; email?: string | null; detail?: Record<string, unknown> } = {}): Promise<void> {
  await db
    .prepare("INSERT INTO identity_audit (user_id, identity_id, event, email, detail, created_at) VALUES (?, ?, ?, ?, ?::jsonb, ?)")
    .run(opts.userId ?? null, opts.identityId ?? null, event, opts.email ?? null, opts.detail ? JSON.stringify(opts.detail) : null, Date.now());
}

export async function findIdentity(issuer: string, subject: string): Promise<IdentityRow | null> {
  const r = (await db.prepare("SELECT * FROM user_identities WHERE issuer = ? AND subject = ?").get(issuer, subject)) as Record<string, unknown> | undefined;
  return r ? toIdentity(r) : null;
}

export async function identitiesOf(userId: number): Promise<IdentityRow[]> {
  const rows = (await db.prepare("SELECT * FROM user_identities WHERE user_id = ? ORDER BY created_at, id").all(userId)) as Record<string, unknown>[];
  return rows.map(toIdentity);
}

interface UserLite {
  id: number;
  email: string;
  kind: string;
  status: string;
  workspace_id: number | null;
}

async function userLite(id: number): Promise<UserLite | null> {
  const r = (await db.prepare("SELECT id, email, kind, status, workspace_id FROM users WHERE id = ?").get(id)) as Record<string, unknown> | undefined;
  return r ? { id: Number(r.id), email: String(r.email), kind: String(r.kind), status: String(r.status), workspace_id: r.workspace_id == null ? null : Number(r.workspace_id) } : null;
}

/** A legacy record that this verified address created earlier and that no identity has claimed yet. */
async function unclaimedLegacyPerson(email: string): Promise<UserLite | null> {
  const r = (await db
    .prepare(
      `SELECT id FROM users u WHERE lower(u.email) = ? AND u.kind = 'person' AND u.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id)`,
    )
    .get(email)) as { id: number } | undefined;
  return r ? userLite(Number(r.id)) : null;
}

async function insertIdentity(userId: number, id: VerifiedIdentity, now: number): Promise<number> {
  const r = (await db
    .prepare(
      `INSERT INTO user_identities (user_id, issuer, subject, email, hosted_domain, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (issuer, subject) DO NOTHING RETURNING id`,
    )
    .get(userId, id.issuer, id.subject, id.email, id.hostedDomain, now, now)) as { id: number } | undefined;
  if (r) return Number(r.id);
  // A concurrent sign-in of the same identity won the insert: use its row if it belongs to the same User.
  const existing = await findIdentity(id.issuer, id.subject);
  if (!existing || existing.userId !== userId) throw new Error("This Google account was just connected to another profile. Sign in again.");
  return existing.id;
}

export type SignInResult = { ok: true; userId: number; identityId: number; created: boolean } | { ok: false; reason: IneligibleReason | "disabled" | "conflict"; message?: string };

/** Personal sign-in with Google's verified claims. Registers eligible new identities; never merges records. */
export async function signInWithGoogle(claims: GoogleClaims): Promise<SignInResult> {
  const elig = personalEligibility(claims);
  if (!elig.ok) {
    await audit("sign-in-refused", { email: typeof claims?.email === "string" ? claims.email.toLowerCase() : null, detail: { reason: elig.reason } });
    return { ok: false, reason: elig.reason };
  }
  const id = elig.identity;
  const now = Date.now();
  const known = await findIdentity(id.issuer, id.subject);
  if (known) {
    const user = await userLite(known.userId);
    if (!user || user.kind !== "person" || user.status !== "active" || user.workspace_id == null) {
      await audit("sign-in-refused", { userId: known.userId, identityId: known.id, email: id.email, detail: { reason: "disabled" } });
      return { ok: false, reason: "disabled" };
    }
    // The address Google reports can change (renamed account); the identity stays keyed by subject.
    await db.prepare("UPDATE user_identities SET email = ?, hosted_domain = ?, last_login_at = ? WHERE id = ?").run(id.email, id.hostedDomain, now, known.id);
    await db.prepare("UPDATE users SET name = COALESCE(?, name), picture = COALESCE(?, picture), updated_at = ? WHERE id = ?").run(id.name, id.picture, now, user.id);
    await audit("sign-in", { userId: user.id, identityId: known.id, email: id.email });
    return { ok: true, userId: user.id, identityId: known.id, created: false };
  }

  const legacy = await unclaimedLegacyPerson(id.email);
  if (legacy) {
    const identityId = await insertIdentity(legacy.id, id, now);
    await db
      .prepare("UPDATE users SET workspace_id = COALESCE(workspace_id, ?), name = COALESCE(?, name), picture = COALESCE(?, picture), updated_at = ? WHERE id = ?")
      .run(TEAM_WORKSPACE_ID, id.name, id.picture, now, legacy.id);
    await audit("legacy-claim", { userId: legacy.id, identityId, email: id.email });
    return { ok: true, userId: legacy.id, identityId, created: false };
  }

  // Any other record with this address (e.g. a shared-connection account, or one already holding identities) is
  // never taken over by address alone.
  const clash = (await db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(id.email)) as { id: number } | undefined;
  if (clash) {
    await audit("sign-in-refused", { userId: Number(clash.id), email: id.email, detail: { reason: "address-already-recorded" } });
    return { ok: false, reason: "conflict", message: "This address already belongs to another SEO Console record. Ask the operator to review it." };
  }
  const created = await withTransaction(async (q) => {
    const [u] = await q(
      `INSERT INTO users (email, name, picture, workspace_id, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'person', 'active', ?, ?) RETURNING id`,
      id.email,
      id.name,
      id.picture,
      TEAM_WORKSPACE_ID,
      now,
      now,
    );
    const userId = Number(u.id);
    const [i] = await q(
      `INSERT INTO user_identities (user_id, issuer, subject, email, hosted_domain, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      userId,
      id.issuer,
      id.subject,
      id.email,
      id.hostedDomain,
      now,
      now,
    );
    return { userId, identityId: Number(i.id) };
  }).catch(async (e) => {
    // Two first sign-ins of the same account at once: the other one registered it.
    const again = await findIdentity(id.issuer, id.subject);
    if (again) return { userId: again.userId, identityId: again.id };
    throw e;
  });
  await audit("register", { userId: created.userId, identityId: created.identityId, email: id.email });
  return { ok: true, ...created, created: true };
}

export type LinkResult =
  | { ok: true; status: "linked" | "already-linked"; identityId: number }
  | { ok: true; status: "merge-required"; mergeRequestId: number }
  | { ok: false; reason: IneligibleReason | "conflict"; message?: string };

/**
 * Links another verified identity to the signed-in User. Proof of control: the active session (this User) and a
 * fresh Google sign-in of the other identity, bound to the same session by the OAuth state.
 */
export async function linkIdentity(userId: number, claims: GoogleClaims): Promise<LinkResult> {
  const elig = personalEligibility(claims);
  if (!elig.ok) {
    await audit("link-refused", { userId, email: typeof claims?.email === "string" ? claims.email.toLowerCase() : null, detail: { reason: elig.reason } });
    return { ok: false, reason: elig.reason };
  }
  const id = elig.identity;
  const now = Date.now();
  const known = await findIdentity(id.issuer, id.subject);
  if (known?.userId === userId) return { ok: true, status: "already-linked", identityId: known.id };
  let sourceUserId: number | null = known ? known.userId : null;
  if (!sourceUserId) {
    const legacy = await unclaimedLegacyPerson(id.email);
    if (legacy && legacy.id !== userId) sourceUserId = legacy.id;
  }
  if (!sourceUserId) {
    const clash = (await db.prepare("SELECT id FROM users WHERE lower(email) = ? AND id <> ?").get(id.email, userId)) as { id: number } | undefined;
    if (clash) return { ok: false, reason: "conflict", message: "This address belongs to a record that can't be linked (for example a shared analytics account)." };
    const identityId = await insertIdentity(userId, id, now);
    await audit("link", { userId, identityId, email: id.email });
    return { ok: true, status: "linked", identityId };
  }
  const source = await userLite(sourceUserId);
  if (!source || source.kind !== "person" || source.status !== "active") {
    return { ok: false, reason: "conflict", message: "That Google account belongs to a record that is disabled or not a person. Ask the operator to review it." };
  }
  const r = (await db
    .prepare(
      `INSERT INTO merge_requests (target_user_id, source_user_id, identity_issuer, identity_subject, identity_email, hosted_domain, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?) RETURNING id`,
    )
    .get(userId, sourceUserId, id.issuer, id.subject, id.email, id.hostedDomain, now, now + MERGE_REQUEST_TTL_MS)) as { id: number };
  await audit("merge-requested", { userId, email: id.email, detail: { sourceUserId, mergeRequestId: Number(r.id) } });
  return { ok: true, status: "merge-required", mergeRequestId: Number(r.id) };
}

/** Removes one of the User's identities. The last one can't be removed (the User would be locked out). */
export async function unlinkIdentity(userId: number, identityId: number): Promise<{ ok: true } | { ok: false; message: string }> {
  return withTransaction(async (q) => {
    const rows = await q("SELECT id FROM user_identities WHERE user_id = ? ORDER BY id FOR UPDATE", userId);
    if (!rows.some((r) => Number(r.id) === identityId)) return { ok: false as const, message: "That login isn't linked to your profile." };
    if (rows.length <= 1) return { ok: false as const, message: "This is your only login. Link another one before removing it." };
    const [removed] = await q("DELETE FROM user_identities WHERE id = ? AND user_id = ? RETURNING email", identityId, userId);
    await q(
      "INSERT INTO identity_audit (user_id, identity_id, event, email, created_at) VALUES (?, ?, 'unlink', ?, ?)",
      userId,
      identityId,
      removed?.email ?? null,
      Date.now(),
    );
    return { ok: true as const };
  });
}
