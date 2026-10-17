import { NextResponse } from "next/server";
import { isDenied, viewer } from "@/lib/access";
import { unlinkIdentity } from "@/lib/auth/identities";

type Ctx = { params: Promise<{ identityId: string }> };

/** Unlinks one of the person's own logins. The last one can't be removed. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const r = await unlinkIdentity(user.id, Number((await ctx.params).identityId));
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: 400 });
}
