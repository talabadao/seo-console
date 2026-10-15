import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { DEFAULT_COMPARE, DEFAULT_PRESET, isCompare, isPreset, resolvePeriod } from "@/lib/v2/summary/period";
import { ALL_PARTS, type ProjectSummary, type SummaryPart } from "@/lib/v2/summary/types";
import { demoContent, demoSummary, isDemoWebsite } from "@/lib/v2/summary/demo";
import { cacheGet, cacheSet } from "@/lib/v2/summary/cache";
import { ga4Section, googleToken, gscSection, healthSection, kpiSection, rankingsSection, tasksSection } from "@/lib/v2/summary/live";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * One project's dashboard summary. Read-only: provider calls only read data.
 *   ?preset=last28&compare=previous   performance period
 *   ?parts=gsc,ga4,kpi,tasks,content,health,rankings
 *   ?detail=1                         include daily series and task lists
 *   ?refresh=1                        skip the 15-minute cache
 * The project must belong to the signed-in account.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const project = await getProject(user.id, id);
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });

  const q = req.nextUrl.searchParams;
  const preset = isPreset(q.get("preset")) ? (q.get("preset") as never) : DEFAULT_PRESET;
  const compare = isCompare(q.get("compare")) ? (q.get("compare") as never) : DEFAULT_COMPARE;
  const requested = (q.get("parts") ?? "").split(",").filter((p): p is SummaryPart => (ALL_PARTS as string[]).includes(p));
  const parts = requested.length ? requested : ALL_PARTS;
  const detail = q.get("detail") === "1";
  const period = resolvePeriod(preset, compare);

  if (isDemoWebsite(project.websiteUrl)) {
    return NextResponse.json(demoSummary(project, period, parts));
  }

  const key = [user.id, id, preset, compare, period.current.end, parts.join(","), detail ? 1 : 0].join("|");
  if (q.get("refresh") !== "1") {
    const hit = cacheGet<ProjectSummary>(key);
    if (hit) return NextResponse.json({ ...hit, cached: true });
  }

  const out: ProjectSummary = { projectId: id, demo: false, period, generatedAt: Date.now() };
  const needsGoogle = parts.some((p) => p === "gsc" || p === "ga4" || p === "kpi");
  const token = needsGoogle ? await googleToken(user, "Google") : null;
  const withToken = async <T,>(source: string, run: (t: string) => Promise<T>) =>
    token && "token" in token ? run(token.token) : ({ ...(token as { error: object }).error, source } as T);

  await Promise.all(
    parts.map(async (p) => {
      if (p === "gsc") out.gsc = await withToken("Google Search Console", (t) => gscSection(t, project, period, detail));
      if (p === "ga4") out.ga4 = await withToken("Google Analytics 4", (t) => ga4Section(user, t, project, period, detail));
      if (p === "kpi") out.kpi = await withToken("Monthly targets (KPI settings) and GA4", (t) => kpiSection(user, t, project));
      if (p === "tasks") out.tasks = await tasksSection(user, project);
      // No content workflow exists yet: always labelled demo data.
      if (p === "content") out.content = demoContent(id);
      if (p === "health") out.health = await healthSection(user, project);
      if (p === "rankings") out.rankings = await rankingsSection(project, period);
    }),
  );

  cacheSet(key, out);
  return NextResponse.json(out);
}
