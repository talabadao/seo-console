import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { aiDomainsFor } from "@/lib/gaConfig";
import { cleanGaError } from "@/lib/ga4";
import { DEFAULT_COMPARE, DEFAULT_PRESET, isCompare, isPreset, resolvePeriod } from "@/lib/v2/summary/period";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { cacheGet, cacheSet } from "@/lib/v2/summary/cache";
import { gaContext, gaPreconditions, googleToken } from "@/lib/v2/summary/live";
import { llmReport, type Granularity, type LlmMetric, type LlmReport } from "@/lib/v2/llm/report";
import { demoLlmReport } from "@/lib/v2/llm/demo";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * LLMs Traffic for one project's GA4 property. Read-only GA4 queries, cached for 15 minutes per user.
 *   ?preset=last28&compare=previous&metric=sessions|users&granularity=day|week|month&platform=all|<id>
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });

  const q = req.nextUrl.searchParams;
  const preset = isPreset(q.get("preset")) ? (q.get("preset") as never) : DEFAULT_PRESET;
  const compare = isCompare(q.get("compare")) ? (q.get("compare") as never) : DEFAULT_COMPARE;
  const metric: LlmMetric = q.get("metric") === "users" ? "users" : "sessions";
  const granularity: Granularity = q.get("granularity") === "week" ? "week" : q.get("granularity") === "month" ? "month" : "day";
  const platform = (q.get("platform") ?? "all").slice(0, 100);
  const period = resolvePeriod(preset, compare);

  if (isDemoWebsite(project.websiteUrl)) {
    return NextResponse.json({ state: "demo", report: demoLlmReport(id, period, metric, granularity, platform) });
  }

  const blocked = await gaPreconditions(user, project, "Google Analytics 4");
  if (blocked) return NextResponse.json(blocked);
  const token = await googleToken(user, "Google Analytics 4");
  if ("error" in token) return NextResponse.json(token.error);

  const key = ["llm", user.id, id, preset, compare, period.current.end, metric, granularity, platform].join("|");
  if (q.get("refresh") !== "1") {
    const hit = cacheGet<LlmReport>(key);
    if (hit) return NextResponse.json({ state: "live", report: hit, cached: true });
  }
  try {
    const { timeZone } = await gaContext(user, token.token, project.gaPropertyId!);
    const report = await llmReport({
      token: token.token,
      propertyId: project.gaPropertyId!,
      timeZone,
      aiDomains: aiDomainsFor(user),
      period,
      metric,
      granularity,
      platformFilter: platform,
    });
    cacheSet(key, report);
    return NextResponse.json({ state: "live", report });
  } catch (e) {
    return NextResponse.json({ state: "error", source: "Google Analytics 4", message: cleanGaError(e instanceof Error ? e.message : String(e)).message });
  }
}
