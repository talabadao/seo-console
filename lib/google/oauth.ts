import { OAuth2Client } from "google-auth-library";
import { db } from "@/lib/db";
import type { UserRow } from "@/lib/session";

export const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";

export const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  // Read-only access to Search Console properties + Search Analytics + URL Inspection
  "https://www.googleapis.com/auth/webmasters.readonly",
  // Submit URLs to the Google Indexing API (works with user creds when the signed-in
  // account is an Owner of the property — no service-account key needed).
  INDEXING_SCOPE,
];

/** Whether a stored space-separated scope string includes the Indexing API scope. */
export function hasIndexingScope(scopes: string | null | undefined): boolean {
  return !!scopes && scopes.split(/\s+/).includes(INDEXING_SCOPE);
}

export function oauthClient() {
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });
}

export function authUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force refresh_token on every connect
    scope: SCOPES,
    include_granted_scopes: true,
    state,
  });
}

/** Returns a valid access token for the user, refreshing + persisting if needed. */
export async function accessTokenFor(user: UserRow): Promise<string> {
  const now = Date.now();
  if (
    user.google_access_token &&
    user.google_token_expiry &&
    user.google_token_expiry - 60_000 > now
  ) {
    return user.google_access_token;
  }
  if (!user.google_refresh_token) {
    throw new Error("No Google refresh token on file — reconnect the account.");
  }
  const client = oauthClient();
  client.setCredentials({ refresh_token: user.google_refresh_token });
  const { credentials } = await client.refreshAccessToken();
  const accessToken = credentials.access_token!;
  const expiry = credentials.expiry_date ?? now + 3500_000;
  // Google echoes the granted scopes on refresh — keep our record current so the
  // UI knows whether the Indexing API is usable.
  if (credentials.scope) {
    db.prepare(
      "UPDATE users SET google_access_token = ?, google_token_expiry = ?, google_scopes = ?, updated_at = ? WHERE id = ?",
    ).run(accessToken, expiry, credentials.scope, now, user.id);
    user.google_scopes = credentials.scope;
  } else {
    db.prepare(
      "UPDATE users SET google_access_token = ?, google_token_expiry = ?, updated_at = ? WHERE id = ?",
    ).run(accessToken, expiry, now, user.id);
  }
  return accessToken;
}
