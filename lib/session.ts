import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { db, tableExists } from "./db";
import { storedIdentityEligible } from "./auth/eligibility";
import { sessionSecretFor } from "./environment";

/** A Google OAuth round trip in progress, bound to this session and to one purpose. */
export interface PendingOAuth {
  state: string;
  nonce: string;
  purpose: "login" | "link" | "connect-google";
  /** The signed-in User who started a link or connect flow (must still be signed in at the callback). */
  userId?: number;
  createdAt: number;
  returnTo?: string;
}

export interface SessionData {
  userId?: number;
  /** The verified login identity used for this session (user_identities.id). */
  identityId?: number;
  oauth?: PendingOAuth;
  /** Legacy fields from sessions created before the workspace model; ignored. */
  email?: string;
  oauthState?: string;
}

// Built on each use so a missing SESSION_SECRET fails the request (never the
// build) and is never replaced by a known key outside local development.
const sessionOptions = (): SessionOptions => ({
  password: sessionSecretFor(),
  cookieName: "seo_dash_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  },
});

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

/** A canonical User (one person). Google data access no longer comes from these columns (see lib/google/connections). */
export interface UserRow {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  google_access_token: string | null;
  google_refresh_token: string | null;
  google_token_expiry: number | null;
  google_scopes: string | null;
  ga_ai_domains: string | null;
  bing_api_key: string | null;
  asana_api_token: string | null;
  workspace_id: number | null;
  kind: string;
  status: string;
  job_title: string | null;
  asana_user_gid: string | null;
  asana_user_name: string | null;
  /** The login identity of this session (null for background jobs). */
  identity_id?: number | null;
  identity_email?: string | null;
}

/** Whether a stored User may act: an active person in a workspace. */
export const isActivePerson = (row: Pick<UserRow, "kind" | "status" | "workspace_id"> | null | undefined): boolean =>
  Boolean(row && row.kind === "person" && row.status === "active" && row.workspace_id != null);

/**
 * The signed-in User, rechecked on every request: the User must be an active person in a workspace, and the
 * session's login identity must still belong to them and still qualify (exact domain / exception rules). Sessions
 * from before the workspace model carry no identity and count as signed out.
 */
export async function currentUser(): Promise<UserRow | null> {
  const session = await getSession();
  if (!session.userId || !session.identityId) return null;
  if (!(await tableExists("user_identities"))) return null;
  const row = (await db
    .prepare(
      `SELECT u.*, i.id AS identity_id, i.email AS identity_email, i.hosted_domain AS identity_hd
         FROM users u JOIN user_identities i ON i.user_id = u.id AND i.id = ?
        WHERE u.id = ?`,
    )
    .get(session.identityId, session.userId)) as (UserRow & { identity_hd: string | null }) | undefined;
  if (!row || !isActivePerson(row)) return null;
  if (!storedIdentityEligible({ email: String(row.identity_email), hosted_domain: row.identity_hd })) return null;
  return row;
}

/**
 * A User for background work attributed to them (no request, no cookie): an active person in a workspace, the
 * same rule as currentUser. Jobs that act for a project use the project's connections, not a person's login.
 */
export async function userById(id: number): Promise<UserRow | null> {
  const row = (await db.prepare("SELECT * FROM users WHERE id = ?").get(id)) as UserRow | undefined;
  return row && isActivePerson(row) ? row : null;
}
