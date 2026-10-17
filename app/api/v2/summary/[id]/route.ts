import { NextRequest, NextResponse, after } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { DEFAULT_COMPARE, DEFAULT_PRESET, isCompare, isPreset, resolvePeriod } from "@/lib/v2/summary/period";
import { ALL_PARTS, type ProjectSummary, type Section, type SummaryPart } from "@/lib/v2/summary/types";
import { demoContent, demoSummary, isDemoWebsite } from "@/lib/v2/summary/demo";
import { ga4Section, googleToken, gscSection, healthSection, kpiSection, rankingsSection, tasksSection } from "@/lib/v2/summary/live";
import { readThrough, setBackgroundRunner, syncReady } from "@/lib/sync/cache";
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
const GOOGLE_PARTS = new Set(["gsc", "ga4", "kpi"]);

/**
 * One project's dashboard summary, read through the shared cache (lib/sync/cache.ts):
 *   ?preset=last28&compare=previous   performance period
 *   ?parts=gsc,ga4,kpi,tasks,content,health,rankings
 *   ?detail=1                         include daily series and task lists
 *   ?refresh=1                        manual refresh: joins any running refresh; a few-minutes cooldown applies
 * A cached part is served from the saved result; a stale one is served with its timestamp while one refresh job
 * runs; a part loading for the first time comes back "pending" if it isn't ready within a few seconds — the page
 * polls. The project must belong to the signed-in account; cached data is only ever this account's.
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
  const force = q.get("refresh") === "1";
  const period = resolvePeriod(preset, compare);

  if (isDemoWebsite(project.websiteUrl)) {
    return NextResponse.json(demoSummary(project, period, parts));
  }

  const out: ProjectSummary = { projectId: id, demo: false, period, generatedAt: Date.now() };

  // Before migration 0008 (e.g. Production until it's migrated): read the providers directly, as before.
  if (!(await syncReady())) {
    const needsGoogle = parts.some((p) => GOOGLE_PARTS.has(p));
    const token = needsGoogle ? await googleToken(user, "Google") : null;
    const withToken = async <T,>(source: string, run: (t: string) => Promise<T>) =>
      token && "token" in token ? run(token.token) : ({ ...(token as { error: object }).error, source } as T);
    await Promise.all(
      parts.map(async (p) => {
        if (p === "gsc") out.gsc = await withToken(SOURCE.gsc, (t) => gscSection(user.id, t, project, period, detail));
        if (p === "ga4") out.ga4 = await withToken(SOURCE.ga4, (t) => ga4Section(user, t, project, period, detail));
        if (p === "kpi") out.kpi = await withToken(SOURCE.kpi, (t) => kpiSection(user, t, project));
        if (p === "tasks") out.tasks = await tasksSection(user, project);
        if (p === "content") out.content = demoContent(id);
        if (p === "health") out.health = await healthSection(user, project);
        if (p === "rankings") out.rankings = await rankingsSection(project, period);
      }),
    );
    return NextResponse.json(out);
  }

  // Refreshes started for stale parts run after the response, within this function's time limit; the job rows
  // stay queued for the next reader or scheduled tick if this instance stops first.
  setBackgroundRunner((fn) => after(fn));
  const config = await projectConfigVersion(user, project);
  await Promise.all(
    parts.map(async (p) => {
      if (p === "content") {
        out.content = demoContent(id); // no content workflow yet: always labelled demo
        return;
      }
      // A revoked Google connection: don't serve this account's cached Google data either.
      if (GOOGLE_PARTS.has(p) && !user.google_refresh_token) {
        (out as unknown as Record<string, Section<unknown>>)[p] = { state: "unavailable", source: SOURCE[p], message: "Google access expired. Sign out and sign in again to reconnect." };
        return;
      }
      const query: SummaryQuery = { projectId: id, part: p, period, detail, config };
      const r = await readThrough<SummaryQuery, Section<unknown>>({ kind: `summary:${p}`, userId: user.id, projectId: id, query, waitMs: 15_000, force });
      const section: Section<unknown> = r.payload
        ? { ...r.payload, cache: { state: r.state === "stale" ? "stale" : "fresh", fetchedAt: r.fetchedAt ?? null, refreshing: Boolean(r.refreshing), lastError: r.error ?? null, cooldown: r.cooldown } }
        : r.state === "pending"
          ? { state: "pending", source: SOURCE[p], message: "Fetching for the first time…", cache: { state: "pending", fetchedAt: null, refreshing: true } }
          : { state: "error", source: SOURCE[p], message: r.error ?? "The refresh failed." };
      (out as unknown as Record<string, Section<unknown>>)[p] = section;
    }),
  );
  return NextResponse.json(out);
}
