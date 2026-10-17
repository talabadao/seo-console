import { NextRequest, NextResponse } from "next/server";
import { isDenied, managementRequired, viewer } from "@/lib/access";
import { STRATEGIES, pageFor, psiTokenFor, runAndStore } from "@/lib/pagespeed";

export const maxDuration = 300;

/** Runs PageSpeed Insights for one page now, mobile and desktop together (takes up to a minute). Managers only. */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { pageId?: number };
  const page = await pageFor(user.id, Number(body.pageId));
  if (!page) return NextResponse.json({ error: "unknown page" }, { status: 404 });
  if (!page.project.canManage) return managementRequired(page.project);
  const token = await psiTokenFor(page.project);
  const results = await Promise.all(STRATEGIES.map((s) => runAndStore(page, s, token)));
  const error = results.find((r) => !r.ok)?.error;
  return NextResponse.json({ ok: results.every((r) => r.ok), error });
}
