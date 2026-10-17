import { NextRequest, NextResponse, after } from "next/server";
import { isDenied, viewProject, viewer, connectionState } from "@/lib/access";
import { DEFAULT_COMPARE, DEFAULT_PRESET, isCompare, isPreset, resolvePeriod } from "@/lib/v2/summary/period";
import { ALL_PARTS, type ProjectSummary, type Section, type SummaryPart } from "@/lib/v2/summary/types";
import { demoContent, demoSummary, isDemoWebsite } from "@/lib/v2/summary/demo";
import { readThrough, setBackgroundRunner } from "@/lib/sync/cache";
import { projectConfigVersion, type SummaryQuery } from "@/lib/sync/kinds";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const SOURCE: Record<Exclude<SummaryPart, "content">, string> = {
  gsc: "Google Search Console",
  ga4: "Google Analytics 4",
  kpi: "Monthly targets (KPI settings) and GA4",
  tasks: "Asana",
  health: "Index coverage",
  rankings: "SE Ranking",
};

/**
 * One project's dashboard summary, read through the shared workspace cache (lib/sync/cache.ts):
 *   ?preset=last28&compare=previous   performance period
 *   ?parts=gsc,ga4,kpi,tasks,content,health,rankings
 *   ?detail=1                         include daily series and task lists
 *   ?refresh=1                        manual refresh (project managers only; otherwise read as normal)
 * Every team member may view any project; results are produced once through the project's shared connections and
 * served to all viewers. A cached part is served from the saved result; a stale one is served with its timestamp
 * while one refresh job runs; a part loading for the first time comes back "pending" if it isn't ready within a
 * few seconds — the page polls. A mapping whose connection must be reconnected shows that, never old data.
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
  const requested = (q.get("parts") ?? "").split(",").filter((p): p is SummaryPart => (ALL_PARTS as string[]).includes(p));
  const parts = requested.length ? requested : ALL_PARTS;
  const detail = q.get("detail") === "1";
  // Explicit refreshes are a management action; a viewer's request reads through the normal refresh policy.
  const force = q.get("refresh") === "1" && project.canManage;
  const period = resolvePeriod(preset, compare);

  if (isDemoWebsite(project.websiteUrl)) {
    return NextResponse.json(demoSummary(project, period, parts));
  }

  const out: ProjectSummary = { projectId: id, demo: false, period, generatedAt: Date.now() };
  // Refreshes started for stale parts run after the response, within this function's time limit; the job rows
  // stay queued for the next reader or scheduled tick if this instance stops first.
  setBackgroundRunner((fn) => after(fn));
  const config = await projectConfigVersion(project);
  const gscState = await connectionState(project.gscConnectionId);
  const gaState = await connectionState(project.gaConnectionId);
  await Promise.all(
    parts.map(async (p) => {
      if (p === "content") {
        out.content = demoContent(id); // no content workflow yet: always labelled demo
        return;
      }
      // A connection that was revoked or disconnected: show that instead of serving its cached data.
      const state = p === "gsc" || p === "health" ? gscState : p === "ga4" || p === "kpi" ? gaState : null;
      if (state && state.status !== "ok" && p !== "health") {
        (out as unknown as Record<string, Section<unknown>>)[p] = { state: "unavailable", source: SOURCE[p], message: state.message };
        return;
      }
      const query: SummaryQuery = { projectId: id, part: p, period, detail, config };
      const r = await readThrough<SummaryQuery, Section<unknown>>({ kind: `summary:${p}`, workspaceId: project.workspaceId, actorUserId: user.id, projectId: id, query, waitMs: 15_000, force });
      const section: Section<unknown> = r.payload
        ? { ...r.payload, cache: { state: r.state === "stale" ? "stale" : "fresh", fetchedAt: r.fetchedAt ?? null, refreshing: Boolean(r.refreshing), lastError: r.error ?? null, cooldown: r.cooldown } }
        : r.state === "pending"
          ? { state: "pending", source: SOURCE[p], message: "Fetching for the first time…", cache: { state: "pending", fetchedAt: null, refreshing: true } }
          : { state: "error", source: SOURCE[p], message: r.error ?? "The refresh failed." };
      (out as unknown as Record<string, Section<unknown>>)[p] = section;
    }),
  );
  return NextResponse.json({ ...out, canManage: project.canManage });
}
