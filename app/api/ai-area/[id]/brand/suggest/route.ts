import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guard, type Ctx } from "@/lib/ai-area/api";
import { suggestPrompts, type BrandMode } from "@/lib/ai-area/brand/analyze";
import { suggestContext } from "@/lib/ai-area/brand/customers";
import { readPrompts } from "@/lib/ai-area/brand/store";
import { readConfig } from "@/lib/ai-area/tracking/store";
import { LlmRefused } from "@/lib/providers/llm";

export const maxDuration = 60;

/**
 * Suggested decision-making prompts from the brand, competitors, tracked keywords and what its Google Maps
 * reviews say. One metered OpenAI call; refused (with the reason) where paid model calls are off, e.g. Preview.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as { count?: unknown; brandMode?: unknown } | null;
  try {
    const [config, existing] = await Promise.all([readConfig(g.project), readPrompts(g.project.id)]);
    if (!config.brand.name) return NextResponse.json({ error: "Set the brand name in Google Search Tracking → Settings first." }, { status: 400 });
    const count = Math.max(5, Math.min(40, Math.round(Number(body?.count) || 20)));
    const brandMode: BrandMode = body?.brandMode === "branded" || body?.brandMode === "unbranded" ? body.brandMode : "mix";
    const context = await suggestContext(g.project).catch(() => undefined);
    const { prompts } = await suggestPrompts(
      { userId: g.user.id, projectId: g.project.id },
      config.brand,
      config.competitors,
      config.keywords.map((k) => k.keyword),
      existing.map((p) => p.text),
      count,
      `${config.settings.country.toUpperCase()} / ${config.settings.language}`,
      context,
      brandMode,
    );
    return NextResponse.json({ prompts });
  } catch (e) {
    if (e instanceof LlmRefused) return NextResponse.json({ error: e.message, state: e.reason }, { status: e.reason === "cap" ? 429 : 403 });
    return errorResponse(e, 502);
  }
}
