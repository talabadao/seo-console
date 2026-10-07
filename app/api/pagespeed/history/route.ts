import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { pageFor, pageHistory } from "@/lib/pagespeed";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const page = await pageFor(user.id, Number(p.get("pageId")));
  if (!page) return NextResponse.json({ error: "unknown page" }, { status: 404 });
  const days = Math.min(365, Math.max(7, Number(p.get("days")) || 90));
  return NextResponse.json({ page, ...(await pageHistory(page.id, days)) });
}
