import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { ProjectValidationError, getProject, isCredentialPlaceholder, removeSerpKey, setSerpKey } from "@/lib/projects";
import { serpKey, serpAccount } from "@/lib/providers/serpapi";

// The project's SerpApi key, saved on its own so an unrelated project field can never block it:
// - PUT    { key }   save or replace the key (storage only; never billable, never returns the key)
// - DELETE            remove the key (explicit)
// - POST             non-billable check: calls SerpApi's free account endpoint and reports the balance,
//                     so "saved" (storage) stays separate from "verified" (the key actually works)

type Ctx = { params: Promise<{ id: string }> };

async function projectIdFor(ctx: Ctx): Promise<number | null> {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) ? id : null;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = await projectIdFor(ctx);
  if (id === null) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key : "";
  // A masked placeholder (what the field shows for an already-saved key) must never overwrite the real one.
  if (isCredentialPlaceholder(key)) {
    return NextResponse.json({ error: "Enter a SerpApi key to save. Leaving the field empty keeps the saved key." }, { status: 400 });
  }
  try {
    const project = await setSerpKey(user.id, id, key);
    if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
    return NextResponse.json({ project });
  } catch (e) {
    if (e instanceof ProjectValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = await projectIdFor(ctx);
  if (id === null) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const project = await removeSerpKey(user.id, id);
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  return NextResponse.json({ project });
}

/** Verifies the saved key against SerpApi's free account endpoint (no search spent, not metered). */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = await projectIdFor(ctx);
  if (id === null) return NextResponse.json({ error: "bad id" }, { status: 400 });
  // Ownership first: only a project this user owns, and only one that has a key saved.
  const project = await getProject(user.id, id);
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  if (!project.hasSerpKey) return NextResponse.json({ error: "No SerpApi key saved for this project." }, { status: 404 });
  const key = await serpKey(id);
  if (!key) return NextResponse.json({ error: "No SerpApi key saved for this project." }, { status: 404 });
  try {
    const account = await serpAccount(key, true);
    return NextResponse.json({ ok: true, account });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
