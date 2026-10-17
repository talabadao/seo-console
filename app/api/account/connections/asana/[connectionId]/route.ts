import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDenied, viewer } from "@/lib/access";

type Ctx = { params: Promise<{ connectionId: string }> };

/** Disconnects an Asana reporting connection (the person who saved it only); project mappings keep pointing at it. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const id = Number((await ctx.params).connectionId);
  const r = await db
    .prepare("UPDATE asana_connections SET status = 'disconnected', ciphertext = NULL, key_id = NULL, updated_at = ? WHERE id = ? AND workspace_id = ? AND granted_by_user_id = ?")
    .run(Date.now(), id, user.workspace_id, user.id);
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Only the person who saved this Asana connection can disconnect it." }, { status: 403 });
}
