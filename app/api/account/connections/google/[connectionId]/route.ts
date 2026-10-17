import { NextRequest, NextResponse } from "next/server";
import { isDenied, viewer } from "@/lib/access";
import { disconnectConnection, getConnection, projectsUsingConnection } from "@/lib/google/connections";
import { refreshConnection } from "@/lib/google/discovery";
import { audit } from "@/lib/auth/identities";

type Ctx = { params: Promise<{ connectionId: string }> };

/** One connection and the projects that read through it (shown before a deliberate disconnection). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const id = Number((await ctx.params).connectionId);
  const c = await getConnection(id, user.workspace_id!);
  if (!c) return NextResponse.json({ error: "unknown connection" }, { status: 404 });
  return NextResponse.json({ connection: c, projects: await projectsUsingConnection(id) });
}

/** Refreshes what the connection can read (Search Console sites, GA4 properties) from Google. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const id = Number((await ctx.params).connectionId);
  if (!(await getConnection(id, user.workspace_id!))) return NextResponse.json({ error: "unknown connection" }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await refreshConnection(id)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** Disconnects it deliberately (the granting person only); mappings stay for a reconnect of the same account. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const id = Number((await ctx.params).connectionId);
  const r = await disconnectConnection(id, user.workspace_id!, user.id);
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: 403 });
  await audit("disconnect-google", { userId: user.id, detail: { connectionId: id } });
  return NextResponse.json({ ok: true });
}
