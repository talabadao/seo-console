import { NextRequest, NextResponse } from "next/server";
import { guard, type Ctx } from "@/lib/ai-area/api";
import { serpReadiness } from "@/lib/providers/serpReadiness";

/** SerpApi readiness for this project (credential, verification, execution permission, limits, last attempt). Local records only. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  return NextResponse.json(await serpReadiness(g.user.id, g.project.id), { headers: { "Cache-Control": "no-store" } });
}
