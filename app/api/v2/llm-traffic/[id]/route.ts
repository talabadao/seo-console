import { NextRequest, NextResponse, after } from "next/server";
import { connectionState, isDenied, viewProject, viewer } from "@/lib/access";
import { DEFAULT_COMPARE, DEFAULT_PRESET, isCompare, isPreset, resolvePeriod } from "@/lib/v2/summary/period";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { readThrough, setBackgroundRunner } from "@/lib/sync/cache";
import { projectConfigVersion, type LlmQuery } from "@/lib/sync/kinds";
import { gaPreconditions } from "@/lib/v2/summary/live";
import type { Granularity, LlmMetric, LlmReport } from "@/lib/v2/llm/report";
import { demoLlmReport } from "@/lib/v2/llm/demo";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * LLMs Traffic for one project's GA4 property, for any team member. Read-only GA4 queries through the project's
 * shared connection and the workspace cache: saved results are served with their timestamp; a first load answers
 * "pending" until its one job finishes. refresh=1 applies for project managers only.
 *   ?preset=last28&compare=previous&metric=sessions|users&granularity=day|week|month&platform=all|<id>
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const project = await viewProject(user, (await ctx.params).id);
  if (isDenied(project)) return project;
  const id = project.id;

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

  const blocked = await gaPreconditions(project, "Google Analytics 4");
  if (blocked) return NextResponse.json(blocked);
  const conn = await connectionState(project.gaConnectionId);
  if (conn && conn.status !== "ok") return NextResponse.json({ state: "unavailable", source: "Google Analytics 4", message: conn.message });

  setBackgroundRunner((fn) => after(fn));
  const query: LlmQuery = { projectId: id, period, metric, granularity, platform, config: await projectConfigVersion(project) };
  const force = q.get("refresh") === "1" && project.canManage;
  const r = await readThrough<LlmQuery, LlmReport>({ kind: "llm-traffic", workspaceId: project.workspaceId, actorUserId: user.id, projectId: id, query, waitMs: 15_000, force });
  if (r.payload) {
    return NextResponse.json({
      state: "live",
      report: r.payload,
      canManage: project.canManage,
      cache: { state: r.state === "stale" ? "stale" : "fresh", fetchedAt: r.fetchedAt ?? null, refreshing: Boolean(r.refreshing), lastError: r.error ?? null, cooldown: r.cooldown },
    });
  }
  if (r.state === "pending") return NextResponse.json({ state: "pending", message: "Fetching from GA4 for the first time…" });
  return NextResponse.json({ state: "error", source: "Google Analytics 4", message: r.error ?? "The refresh failed." });
}
