import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { db } from "./db";
import { isAllowedEmail } from "./auth/allowlist";

export interface SessionData {
  userId?: number;
  email?: string;
  oauthState?: string;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me-32b",
  cookieName: "seo_dash_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

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
}

export async function currentUser(): Promise<UserRow | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const row = (await db.prepare("SELECT * FROM users WHERE id = ?").get(session.userId)) as
    | UserRow
    | undefined;
  // Sessions from before the allowlist (or for an account later removed from
  // it) stop working on the next request; the account's data is left untouched.
  if (!row || !isAllowedEmail(row.email)) return null;
  return row;
}
