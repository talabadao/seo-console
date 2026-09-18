import { OAuth2Client, type Credentials } from "google-auth-library";
import { db } from "@/lib/db";
import type { UserRow } from "@/lib/session";

export const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
export const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  // Read-only access to Search Console properties + Search Analytics + URL Inspection
  "https://www.googleapis.com/auth/webmasters.readonly",
  // Submit URLs to the Google Indexing API (works with user creds when the signed-in
  // account is an Owner of the property — no service-account key needed).
  INDEXING_SCOPE,
  // Read GA4 properties (Admin API) + reports (Data API).
  ANALYTICS_SCOPE,
];

/** Whether a stored space-separated scope string includes a given scope. */
export function hasScope(scopes: string | null | undefined, scope: string): boolean {
  return !!scopes && scopes.split(/\s+/).includes(scope);
}

export const hasIndexingScope = (s: string | null | undefined) => hasScope(s, INDEXING_SCOPE);
export const hasAnalyticsScope = (s: string | null | undefined) => hasScope(s, ANALYTICS_SCOPE);

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

/**
 * Thrown when Google has rejected the stored refresh token outright (revoked
 * by the user, password changed, or — very likely while this OAuth client is
 * still in "Testing" publishing status in Google Cloud Console — the 7-day
 * refresh-token expiry Google enforces for unverified apps). Every route that
 * calls accessTokenFor() should catch this and return `{needsReconnect: true}`
 * the same way a missing scope already does, instead of leaking Google's raw
 * "invalid_grant" error text to the UI.
 */
export class GoogleReauthRequiredError extends Error {
  constructor() {
    super("Google sign-in expired or was revoked — reconnect your account.");
    this.name = "GoogleReauthRequiredError";
  }
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
    throw new GoogleReauthRequiredError();
  }
  const client = oauthClient();
  client.setCredentials({ refresh_token: user.google_refresh_token });
  let credentials: Credentials;
  try {
    ({ credentials } = await client.refreshAccessToken());
  } catch (e) {
    const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
    const msg = e instanceof Error ? e.message : String(e);
    if (code === "invalid_grant" || /invalid_grant/i.test(msg)) {
      // Dead token — clear it so the app stops pretending this account is
      // still connected (every subsequent load would otherwise fail the
      // same way until the user happens to hit "reconnect" themselves).
      await db
        .prepare(
          "UPDATE users SET google_access_token = NULL, google_refresh_token = NULL, google_token_expiry = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, user.id);
      throw new GoogleReauthRequiredError();
    }
    throw e;
  }
  const accessToken = credentials.access_token!;
  const expiry = credentials.expiry_date ?? now + 3500_000;
  // Google echoes the granted scopes on refresh — keep our record current so the
  // UI knows whether the Indexing API is usable.
  if (credentials.scope) {
    await db
      .prepare(
        "UPDATE users SET google_access_token = ?, google_token_expiry = ?, google_scopes = ?, updated_at = ? WHERE id = ?",
      )
      .run(accessToken, expiry, credentials.scope, now, user.id);
    user.google_scopes = credentials.scope;
  } else {
    await db
      .prepare(
        "UPDATE users SET google_access_token = ?, google_token_expiry = ?, updated_at = ? WHERE id = ?",
      )
      .run(accessToken, expiry, now, user.id);
  }
  return accessToken;
}
