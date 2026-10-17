import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { DocsForbidden, DocsInputError, docsReady, getArticle, isDocsAdmin, setPublished } from "@/lib/docs/store";

type Ctx = { params: Promise<{ slug: string }> };

/** One article: published for everyone signed in; drafts for Docs admins only (others get 404). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await docsReady())) return NextResponse.json({ error: "Docs unavailable" }, { status: 503 });
  const admin = (await isDocsAdmin(user));
  const article = await getArticle((await ctx.params).slug, { admin });
  if (!article) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ admin, article }, { headers: { "Cache-Control": "no-store" } });
}

/** Publishes or unpublishes (Docs admins only): { publish: boolean }. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isDocsAdmin(user))) return NextResponse.json({ error: "Only Docs admins can publish." }, { status: 403 });
  if (!(await docsReady())) return NextResponse.json({ error: "Docs unavailable" }, { status: 503 });
  const current = await getArticle((await ctx.params).slug, { admin: true });
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { publish?: unknown };
  try {
    return NextResponse.json({ article: await setPublished({ id: user.id, email: user.email }, current.id, body.publish === true) });
  } catch (e) {
    if (e instanceof DocsForbidden) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof DocsInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
