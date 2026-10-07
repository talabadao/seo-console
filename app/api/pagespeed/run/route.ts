import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { accessTokenFor } from "@/lib/google/oauth";
import { STRATEGIES, pageFor, runAndStore } from "@/lib/pagespeed";

export const maxDuration = 300;

/** Runs PageSpeed Insights for one page now, mobile and desktop together (takes up to a minute). */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { pageId?: number };
  const page = await pageFor(user.id, Number(body.pageId));
  if (!page) return NextResponse.json({ error: "unknown page" }, { status: 404 });

  let token: string | null = null;
  if (!process.env.PAGESPEED_API_KEY) {
    try {
      token = await accessTokenFor(user);
    } catch {
      /* fall back to an unauthenticated run */
    }
  }
  const results = await Promise.all(STRATEGIES.map((s) => runAndStore(page, s, token)));
  const error = results.find((r) => !r.ok)?.error;
  return NextResponse.json({ ok: results.every((r) => r.ok), error });
}
