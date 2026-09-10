import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { syncGoogleSite, syncAllForUser, type SiteRow } from "@/lib/sync";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { property?: string };

  if (!body.property) {
    const results = await syncAllForUser(user);
    return NextResponse.json({ results });
  }

  const site = db
    .prepare(
      "SELECT id, user_id, source, property FROM sites WHERE user_id = ? AND property = ? AND source = 'google'",
    )
    .get(user.id, body.property) as SiteRow | undefined;
  if (!site) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  const result = await syncGoogleSite(user, site);
  return NextResponse.json({ result });
}
