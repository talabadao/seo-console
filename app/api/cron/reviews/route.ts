import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accessTokenFor, hasBusinessScope } from "@/lib/google/oauth";
import { classifyPending, syncReviews, type ReviewProject } from "@/lib/reviews";
import type { UserRow } from "@/lib/session";

export const maxDuration = 300;

/**
 * Vercel Cron target (see vercel.json): once a day, refreshes reviews for
 * every project with a Business Profile location and analyses the new ones.
 * Requires `Authorization: Bearer $CRON_SECRET`, which Vercel sends itself.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const projects = (await db
    .prepare(
      `SELECT id, user_id AS "userId", name, gbp_location AS "gbpLocation",
              gbp_location_title AS "gbpLocationTitle"
         FROM projects WHERE gbp_location IS NOT NULL ORDER BY id`,
    )
    .all()) as unknown as (ReviewProject & { userId: number })[];

  const results: { project: string; fetched?: number; classified?: number; error?: string }[] = [];
  for (const p of projects) {
    const left = 240_000 - (Date.now() - started);
    if (left < 20_000) break;
    try {
      const user = (await db.prepare("SELECT * FROM users WHERE id = ?").get(p.userId)) as UserRow | undefined;
      if (!user || !hasBusinessScope(user.google_scopes)) continue;
      const s = await syncReviews(await accessTokenFor(user), p);
      const c = await classifyPending(p, Math.min(60_000, left - 15_000));
      results.push({ project: p.name, fetched: s.fetched, classified: c.classified, error: c.error });
    } catch (e) {
      results.push({ project: p.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
