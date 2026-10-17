import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guard, type Ctx } from "@/lib/ai-area/api";
import { deleteCycle, listCycles, readCycle } from "@/lib/ai-area/brand/store";

/** One cycle's full answers (AI answers explorer), latest when no id is given. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  try {
    const id = req.nextUrl.searchParams.get("id") ?? (await listCycles(g.project.id)).at(-1)?.id ?? "";
    const cycle = await readCycle(g.project.id, id);
    return cycle ? NextResponse.json({ cycle }) : NextResponse.json({ error: "No answers yet" }, { status: 404 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Removes a finished cycle (its answers). A running cycle can't be deleted. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing cycle" }, { status: 400 });
    const summary = (await listCycles(g.project.id)).find((c) => c.id === id);
    if (summary?.status === "running") return NextResponse.json({ error: "This run is still in progress." }, { status: 409 });
    await deleteCycle(g.project.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
