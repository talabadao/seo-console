import { NextRequest, NextResponse } from "next/server";
import { isDenied, viewer } from "@/lib/access";
import { cancelMerge, mergePreview, performMerge, type MergeChoices } from "@/lib/auth/merge";

type Ctx = { params: Promise<{ requestId: string }> };

/**
 * A pending link that would consolidate two existing profiles of the same person: the preview (what moves, and
 * every difference that needs a choice). Only the signed-in person who started the link can see or act on it.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const preview = await mergePreview(Number((await ctx.params).requestId), user.id);
  return preview ? NextResponse.json(preview) : NextResponse.json({ error: "This merge request expired or was already handled." }, { status: 404 });
}

/** Performs it: { choices: { "<area>:<key>": "target" | "source" } } — one for every listed difference. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { choices?: MergeChoices };
  const r = await performMerge(Number((await ctx.params).requestId), user.id, body.choices ?? {});
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message, missing: r.missing }, { status: 400 });
}

/** Declines it: nothing changes. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  return NextResponse.json({ ok: await cancelMerge(Number((await ctx.params).requestId), user.id) });
}
