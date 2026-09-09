import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { accessTokenFor, hasIndexingScope } from "@/lib/google/oauth";
import { submitUrls, type SiteRow } from "@/lib/indexer";

export const maxDuration = 120;

const RECONNECT_MSG =
  "Your Google sign-in doesn't include the Indexing API permission yet. " +
  "Sign out and sign back in (approve the new permission), then retry.";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    property?: string;
    urls?: string[];
    url?: string;
  };
  const urls = (body.urls ?? (body.url ? [body.url] : [])).filter(Boolean);
  if (!body.property || !urls.length) {
    return NextResponse.json({ error: "property and url(s) required" }, { status: 400 });
  }
  if (urls.length > 100) {
    return NextResponse.json({ error: "max 100 URLs per request" }, { status: 400 });
  }

  const site = db
    .prepare("SELECT id, user_id, source, property FROM sites WHERE user_id = ? AND property = ?")
    .get(user.id, body.property) as SiteRow | undefined;
  if (!site) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  let token: string;
  try {
    token = await accessTokenFor(user); // refreshes google_scopes on `user`
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  // Don't even attempt if the grant is missing the scope — the API would just 403.
  const scopes =
    (db.prepare("SELECT google_scopes FROM users WHERE id = ?").get(user.id) as
      | { google_scopes: string | null }
      | undefined)?.google_scopes ?? user.google_scopes;
  if (!hasIndexingScope(scopes)) {
    return NextResponse.json({
      submitted: 0,
      failed: urls.length,
      needsReconnect: true,
      message: RECONNECT_MSG,
      results: urls.map((url) => ({ url, ok: false, message: RECONNECT_MSG })),
    });
  }

  const results = await submitUrls(site, urls, token);
  const failed = results.filter((r) => !r.ok);
  const needsReconnect = failed.some((r) =>
    /insufficient.*scope|PERMISSION_DENIED|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(r.message),
  );

  return NextResponse.json({
    submitted: results.filter((r) => r.ok).length,
    failed: failed.length,
    needsReconnect,
    message: needsReconnect ? RECONNECT_MSG : undefined,
    results,
  });
}
