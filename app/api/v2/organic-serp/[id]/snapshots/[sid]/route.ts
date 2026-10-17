import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/organicSerp/store";
import { load, type Ctx } from "../../_load";

/** One saved snapshot, from the database only: opening history never searches again. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  const sid = Number((await ctx.params).sid);
  const snapshot = Number.isSafeInteger(sid) ? await getSnapshot(r.user.id, r.project.id, sid) : null;
  if (!snapshot) return NextResponse.json({ error: "unknown snapshot" }, { status: 404 });
  return NextResponse.json({ snapshot }, { headers: { "Cache-Control": "no-store" } });
}
