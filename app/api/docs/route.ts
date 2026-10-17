import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { DocsForbidden, DocsInputError, docsReady, ensureDemoDocs, isDocsAdmin, listArticles, saveArticle } from "@/lib/docs/store";

/** Docs list: published articles for everyone signed in; drafts too for Docs admins. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await docsReady())) return NextResponse.json({ error: "This database hasn't run migration 0010 (Docs) yet." }, { status: 503 });
  await ensureDemoDocs();
  const admin = isDocsAdmin(user.email);
  return NextResponse.json({ admin, articles: await listArticles({ admin }) }, { headers: { "Cache-Control": "no-store" } });
}

/** Creates or updates an article (Docs admins only): { id?, slug?, kind, title, summary, body }. Saved as a draft. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isDocsAdmin(user.email)) return NextResponse.json({ error: "Only Docs admins can edit articles." }, { status: 403 });
  if (!(await docsReady())) return NextResponse.json({ error: "Docs unavailable" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const article = await saveArticle({ id: user.id, email: user.email }, { ...body, id: Number(body.id) || null });
    return NextResponse.json({ article });
  } catch (e) {
    if (e instanceof DocsForbidden) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof DocsInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
