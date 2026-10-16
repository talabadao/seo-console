import { NextRequest, NextResponse, after } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { aiDomainsFor } from "@/lib/gaConfig";
import { cleanGaError } from "@/lib/ga4";
import { DEFAULT_COMPARE, DEFAULT_PRESET, isCompare, isPreset, resolvePeriod } from "@/lib/v2/summary/period";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { readThrough, setBackgroundRunner, syncReady } from "@/lib/sync/cache";
import { projectConfigVersion, type LlmQuery } from "@/lib/sync/kinds";
import { gaContext, gaPreconditions, googleToken } from "@/lib/v2/summary/live";
import { llmReport, type Granularity, type LlmMetric, type LlmReport } from "@/lib/v2/llm/report";
import { demoLlmReport } from "@/lib/v2/llm/demo";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * LLMs Traffic for one project's GA4 property. Read-only GA4 queries through the shared cache (lib/sync/cache.ts):
 * saved results are served with their timestamp; a first load answers "pending" until its one job finishes.
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

  if (await syncReady()) {
    setBackgroundRunner((fn) => after(fn));
    const query: LlmQuery = { projectId: id, period, metric, granularity, platform, config: await projectConfigVersion(user, project) };
    const r = await readThrough<LlmQuery, LlmReport>({ kind: "llm-traffic", userId: user.id, projectId: id, query, waitMs: 15_000, force: q.get("refresh") === "1" });
    if (r.payload) {
      return NextResponse.json({
        state: "live",
        report: r.payload,
        cache: { state: r.state === "stale" ? "stale" : "fresh", fetchedAt: r.fetchedAt ?? null, refreshing: Boolean(r.refreshing), lastError: r.error ?? null, cooldown: r.cooldown },
      });
    }
    if (r.state === "pending") return NextResponse.json({ state: "pending", message: "Fetching from GA4 for the first time…" });
    return NextResponse.json({ state: "error", source: "Google Analytics 4", message: r.error ?? "The refresh failed." });
  }
  // Before migration 0008: read GA4 directly, as before.
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
    return NextResponse.json({ state: "live", report });
  } catch (e) {
    return NextResponse.json({ state: "error", source: "Google Analytics 4", message: cleanGaError(e instanceof Error ? e.message : String(e)).message });
  }
}
