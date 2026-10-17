import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guard, type Ctx } from "@/lib/ai-area/api";
import { setFact } from "@/lib/ai-area/brand/store";
import type { FactVerdict } from "@/lib/ai-area/brand/types";

/** Marks an AI-stated fact about the brand as correct or incorrect (null clears it). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx, { manage: true });
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as { key?: unknown; verdict?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.slice(0, 200) : "";
  if (!key) return NextResponse.json({ error: "Missing fact" }, { status: 400 });
  const verdict = body?.verdict === "correct" || body?.verdict === "incorrect" ? (body.verdict as FactVerdict) : null;
  try {
    return NextResponse.json({ verdicts: await setFact(g.project.id, key, verdict) });
  } catch (e) {
    return errorResponse(e);
  }
}
