import { NextRequest, NextResponse } from "next/server";
import { PREVIEW_WRITES_BLOCKED, externalWritesAllowed } from "@/lib/environment";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { INDEXING_SCOPE } from "@/lib/google/oauth";
import { connectionHasScope, gscForProperty, managementRequired } from "@/lib/access";
import { isReconnectError } from "@/lib/google/connections";
import { submitUrls, submitQuotaLeft, type SiteRow } from "@/lib/indexer";

export const maxDuration = 120;

const RECONNECT_MSG =
  "The project's Google connection doesn't include the Indexing API permission yet. " +
  "Reconnect it in Account → Data connections (approve the new permission), then retry.";

const OWNER_MSG =
  "The Indexing API only accepts a verified Owner of the property. Your role in " +
  "Search Console → Settings → Users and permissions is not \"Owner\" — ask an owner " +
  "to promote you, or add & verify the site yourself.";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!externalWritesAllowed()) return NextResponse.json({ error: PREVIEW_WRITES_BLOCKED }, { status: 403 });

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

  const gsc = await gscForProperty(user, body.property, (body as { projectId?: number }).projectId);
  if (!gsc || gsc.siteId == null) return NextResponse.json({ error: "unknown property" }, { status: 404 });
  if (!gsc.project.canManage) return managementRequired(gsc.project);
  const site = (await db
    .prepare("SELECT id, user_id, source, property, permission_level FROM sites WHERE id = ?")
    .get(gsc.siteId)) as unknown as SiteRow & { permission_level: string | null };

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
    token = await gsc.token();
  } catch (e) {
    if (isReconnectError(e)) return NextResponse.json({ needsReconnect: true, message: e instanceof Error ? e.message : "" });
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  if (!(await connectionHasScope(gsc.connectionId, INDEXING_SCOPE))) return fail(RECONNECT_MSG, { needsReconnect: true });

  const { results, skipped, ineligible, quotaLeft } = await submitUrls(site, urls, token);
  const failed = results.filter((r) => !r.ok && !r.ineligible);
  const needsReconnect = failed.some((r) =>
    /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(r.message),
  );
  const notOwner = failed.some((r) => /isn't an owner|verify.*ownership/i.test(r.message));

  return NextResponse.json({
    submitted: results.filter((r) => r.ok).length,
    failed: failed.length,
    ineligible,
    skipped,
    quotaLeft,
    needsReconnect,
    notOwner,
    message: needsReconnect ? RECONNECT_MSG : notOwner ? OWNER_MSG : undefined,
    results,
  });
}
