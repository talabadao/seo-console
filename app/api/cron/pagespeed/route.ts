import { NextRequest, NextResponse } from "next/server";
import { runDuePages } from "@/lib/pagespeed";

export const maxDuration = 300;

/**
 * Vercel Cron target (see vercel.json). Scheduled a few times in the early
 * UTC morning: each PageSpeed run takes up to a minute, so one invocation may
 * not get through every tracked page, and the later ones finish the rest.
 * Requires `Authorization: Bearer $CRON_SECRET`, which Vercel sends itself.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDuePages(180_000));
}
