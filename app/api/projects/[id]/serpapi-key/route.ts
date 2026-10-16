import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject, removeSerpKey } from "@/lib/projects";
import { serpKey, serpAccount } from "@/lib/providers/serpapi";

// The SerpApi key as it applies to one project. Keys are now saved only as encrypted account credentials
// (Settings → Account → API credentials, /api/account/credentials/serpapi):
// - PUT     retired: new keys can't be stored in plain text on a project any more (410 with directions).
// - DELETE  removes a legacy key still stored on the project (explicit), so it uses the account credential.
// - POST    non-billable check of the key that applies to this project (SerpApi's free account endpoint).

type Ctx = { params: Promise<{ id: string }> };

async function projectIdFor(ctx: Ctx): Promise<number | null> {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) ? id : null;
}

export async function PUT() {
  return NextResponse.json(
    { error: "SerpApi keys are saved once for your account now: Settings → Account → API credentials. Nothing was saved." },
    { status: 410 },
  );
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = await projectIdFor(ctx);
  if (id === null) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const project = await removeSerpKey(user.id, id);
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  return NextResponse.json({ project });
}

/** Verifies the key that applies to this project against SerpApi's free account endpoint (no search spent). */
export async function POST(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = await projectIdFor(ctx);
  if (id === null) return NextResponse.json({ error: "bad id" }, { status: 400 });
  // Ownership first: only a project this user owns.
  const project = await getProject(user.id, id);
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  const key = await serpKey(user.id, id);
  if (!key) return NextResponse.json({ error: "No SerpApi key applies to this project." }, { status: 404 });
  try {
    const account = await serpAccount(key, true);
    return NextResponse.json({ ok: true, source: key.source, account });
  } catch (e) {
    return NextResponse.json({ ok: false, source: key.source, error: e instanceof Error ? e.message : String(e) });
  }
}
