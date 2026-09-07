import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

/**
 * Google Indexing API — https://developers.google.com/search/apis/indexing-api
 *
 * Officially this API is only supported for pages with JobPosting or
 * BroadcastEvent structured data. For other pages Google does not guarantee any
 * effect; it is still the only programmatic "nudge" available (the GSC
 * "Request indexing" button has no public API).
 *
 * Auth is a **service account** (not the signed-in user):
 *   1. Cloud Console → create a service account, download its JSON key.
 *   2. Enable the "Indexing API" in the same project.
 *   3. Search Console → Settings → Users and permissions → add the service
 *      account's email (…@….iam.gserviceaccount.com) as an **Owner**.
 *   4. Point SEO Console at the key via GOOGLE_SA_KEY_FILE or GOOGLE_SA_KEY_JSON.
 */

const ENDPOINT = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const SCOPE = "https://www.googleapis.com/auth/indexing";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cached: ServiceAccount | null | undefined;

function loadServiceAccount(): ServiceAccount | null {
  if (cached !== undefined) return cached;
  const raw =
    process.env.GOOGLE_SA_KEY_JSON ||
    (process.env.GOOGLE_SA_KEY_FILE ? safeRead(process.env.GOOGLE_SA_KEY_FILE) : "");
  if (!raw) return (cached = null);
  try {
    const j = JSON.parse(raw);
    if (j.client_email && j.private_key) {
      cached = { client_email: j.client_email, private_key: j.private_key };
    } else cached = null;
  } catch {
    cached = null;
  }
  return cached;
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function indexingConfigured(): boolean {
  return loadServiceAccount() !== null;
}

export function serviceAccountEmail(): string | null {
  return loadServiceAccount()?.client_email ?? null;
}

let jwt: JWT | null = null;
function client(): JWT {
  const sa = loadServiceAccount();
  if (!sa) throw new Error("Indexing API not configured (no service account key).");
  if (!jwt) {
    jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [SCOPE] });
  }
  return jwt;
}

export type NotifyType = "URL_UPDATED" | "URL_DELETED";

export async function publishUrl(url: string, type: NotifyType = "URL_UPDATED") {
  const res = await client().request({
    url: ENDPOINT,
    method: "POST",
    data: { url, type },
  });
  return res.data as {
    urlNotificationMetadata?: { url?: string; latestUpdate?: { type?: string; notifyTime?: string } };
  };
}
