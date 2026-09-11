import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { accessTokenFor, hasIndexingScope } from "@/lib/google/oauth";
import { submitUrls, submitQuotaLeft, type SiteRow } from "@/lib/indexer";

export const maxDuration = 120;

const RECONNECT_MSG =
  "Your Google sign-in doesn't include the Indexing API permission yet. " +
  "Sign out and sign back in (approve the new permission), then retry.";

const OWNER_MSG =
  "The Indexing API only accepts a verified Owner of the property. Your role in " +
  "Search Console → Settings → Users and permissions is not \"Owner\" — ask an owner " +
  "to promote you, or add & verify the site yourself.";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    property?: string;
    urls?: string[];
    url?: string;
  };
  const urls = [...new Set((body.urls ?? (body.url ? [body.url] : [])).filter(Boolean))];
  if (!body.property || !urls.length) {
    return NextResponse.json({ error: "property and url(s) required" }, { status: 400 });
  }
  if (urls.length > 100) {
    return NextResponse.json({ error: "max 100 URLs per request" }, { status: 400 });
  }

  const site = (await db
    .prepare(
      "SELECT id, user_id, source, property, permission_level FROM sites WHERE user_id = ? AND property = ? AND source = 'google'",
    )
    .get(user.id, body.property)) as (SiteRow & { permission_level: string | null }) | undefined;
  if (!site) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  const fail = async (message: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({
      submitted: 0,
      failed: urls.length,
      skipped: 0,
      quotaLeft: await submitQuotaLeft(site.id),
      message,
      results: urls.map((url) => ({ url, ok: false, message })),
      ...extra,
    });

  if (site.permission_level && site.permission_level !== "siteOwner") {
    return fail(OWNER_MSG, { notOwner: true });
  }

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  const scopes =
    ((await db.prepare("SELECT google_scopes FROM users WHERE id = ?").get(user.id)) as
      | { google_scopes: string | null }
      | undefined)?.google_scopes ?? user.google_scopes;
  if (!hasIndexingScope(scopes)) return fail(RECONNECT_MSG, { needsReconnect: true });

  const { results, skipped, quotaLeft } = await submitUrls(site, urls, token);
  const failed = results.filter((r) => !r.ok);
  const needsReconnect = failed.some((r) =>
    /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(r.message),
  );
  const notOwner = failed.some((r) => /isn't an owner|verify.*ownership/i.test(r.message));

  return NextResponse.json({
    submitted: results.filter((r) => r.ok).length,
    failed: failed.length,
    skipped,
    quotaLeft,
    needsReconnect,
    notOwner,
    message: needsReconnect ? RECONNECT_MSG : notOwner ? OWNER_MSG : undefined,
    results,
  });
}
