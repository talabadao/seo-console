import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

/**
 * Google Indexing API — https://developers.google.com/search/apis/indexing-api
 *
 * Officially supported only for pages with JobPosting / BroadcastEvent structured
 * data; for other pages it's a best-effort nudge (the GSC "Request indexing"
 * button has no public API).
 *
 * Two auth modes, tried in this order:
 *   1. **User OAuth** (default) — the signed-in Google account's token, with the
 *      `.../auth/indexing` scope. Works when that account is an *Owner* of the
 *      Search Console property. No key file, so it's unaffected by the
 *      `iam.disableServiceAccountKeyCreation` org policy.
 *   2. **Service account** (optional) — set GOOGLE_SA_KEY_FILE / GOOGLE_SA_KEY_JSON.
 *      The service account email must be added as an Owner in Search Console.
 */

const ENDPOINT = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const SCOPE = "https://www.googleapis.com/auth/indexing";

export type NotifyType = "URL_UPDATED" | "URL_DELETED";

interface PublishResult {
  urlNotificationMetadata?: {
    url?: string;
    latestUpdate?: { type?: string; notifyTime?: string };
  };
}

async function publishWithToken(
  token: string,
  url: string,
  type: NotifyType,
): Promise<PublishResult> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, type }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Indexing API ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

// ---- optional service-account path ----

interface ServiceAccount {
  client_email: string;
  private_key: string;
}
let cachedSa: ServiceAccount | null | undefined;

function serviceAccount(): ServiceAccount | null {
  if (cachedSa !== undefined) return cachedSa;
  const raw =
    process.env.GOOGLE_SA_KEY_JSON ||
    (process.env.GOOGLE_SA_KEY_FILE ? safeRead(process.env.GOOGLE_SA_KEY_FILE) : "");
  if (!raw) return (cachedSa = null);
  try {
    const j = JSON.parse(raw);
    cachedSa = j.client_email && j.private_key
      ? { client_email: j.client_email, private_key: j.private_key }
      : null;
  } catch {
    cachedSa = null;
  }
  return cachedSa;
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function serviceAccountConfigured(): boolean {
  return serviceAccount() !== null;
}

export function serviceAccountEmail(): string | null {
  return serviceAccount()?.client_email ?? null;
}

let jwt: JWT | null = null;

/**
 * Publish one URL. Pass the signed-in user's access token; falls back to a
 * configured service account if `userToken` is omitted.
 */
export async function publishUrl(
  url: string,
  opts: { userToken?: string; type?: NotifyType } = {},
): Promise<PublishResult> {
  const type = opts.type ?? "URL_UPDATED";
  if (opts.userToken) return publishWithToken(opts.userToken, url, type);

  const sa = serviceAccount();
  if (!sa) throw new Error("No Indexing API credentials (no user token, no service account).");
  if (!jwt) jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [SCOPE] });
  const res = await jwt.request<PublishResult>({
    url: ENDPOINT,
    method: "POST",
    data: { url, type },
  });
  return res.data;
}
