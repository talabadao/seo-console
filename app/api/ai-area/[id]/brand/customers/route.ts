import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guard, type Ctx } from "@/lib/ai-area/api";
import { customerVoice } from "@/lib/ai-area/brand/customers";
import { updateCustomerGap } from "@/lib/ai-area/brand/gap";
import { readCustomerGap } from "@/lib/ai-area/brand/store";
import { readConfig } from "@/lib/ai-area/tracking/store";
import { LlmRefused } from "@/lib/providers/llm";

const RANGES: Record<string, number | null> = { "30": 30, "90": 90, "180": 180, "365": 365, all: null };

/** What customers say in the project's stored Google Maps reviews, and the saved comparison with AI answers. Storage only. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  try {
    const range = req.nextUrl.searchParams.get("range") ?? "365";
    const days = range in RANGES ? RANGES[range] : 365;
    const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
    const [voice, gap] = await Promise.all([customerVoice(g.project, since), readCustomerGap(g.project.id)]);
    return NextResponse.json({ voice, gap }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Compares the latest run's AI answers with the reviews again (one metered OpenAI call). */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  try {
    const config = await readConfig(g.project);
    const { gap, reason } = await updateCustomerGap({ userId: g.user.id, projectId: g.project.id }, g.project, config);
    if (!gap) return NextResponse.json({ error: reason ?? "Nothing to compare yet" }, { status: 400 });
    return NextResponse.json({ gap });
  } catch (e) {
    if (e instanceof LlmRefused) return NextResponse.json({ error: e.message, state: e.reason }, { status: e.reason === "cap" ? 429 : 403 });
    return errorResponse(e, 502);
  }
}
