import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import {
  KPI_METRICS,
  KpiConflictError,
  KpiInputError,
  MAX_PERIODS,
  addMonths,
  currentPeriod,
  isPeriod,
  kpiTargetsReady,
  projectTimeZone,
  readTargets,
  saveTargets,
  validateChanges,
} from "@/lib/kpiTargets";

type Ctx = { params: Promise<{ id: string }> };

async function context(ctx: Ctx) {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return { error: NextResponse.json({ error: "unknown project" }, { status: 404 }) } as const;
  if (!(await kpiTargetsReady())) {
    return { error: NextResponse.json({ error: "This database hasn't run migration 0007 (KPI planning) yet.", state: "unavailable" }, { status: 503 }) } as const;
  }
  return { user, project } as const;
}

/**
 * Saved KPI targets for a range of months (?from=YYYY-MM&to=YYYY-MM; default the current month and the 11 after
 * it, in the project's GA4 time zone). Read-only.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const timeZone = await projectTimeZone(c.user.id, c.project.gaPropertyId);
  const now = currentPeriod(timeZone);
  const p = req.nextUrl.searchParams;
  const from = isPeriod(p.get("from")) ? p.get("from")! : now;
  const toRaw = isPeriod(p.get("to")) ? p.get("to")! : addMonths(from, 11);
  const to = toRaw < from ? from : toRaw > addMonths(from, MAX_PERIODS - 1) ? addMonths(from, MAX_PERIODS - 1) : toRaw;
  return NextResponse.json(
    { timeZone: timeZone ?? "UTC", currentPeriod: now, from, to, metrics: KPI_METRICS, grid: await readTargets(c.project.id, from, to) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Saves changed targets: { changes: [{ period, metric, value (number | null to clear), expectedUpdatedAt }] }.
 * All or nothing: invalid cells → 400 listing them; cells changed elsewhere since loading → 409 listing them.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const body = (await req.json().catch(() => ({}))) as { changes?: unknown };
  try {
    const changes = validateChanges(body.changes);
    const { saved } = await saveTargets(c.user.id, c.project.id, changes);
    return NextResponse.json({ saved });
  } catch (e) {
    if (e instanceof KpiInputError) return NextResponse.json({ error: e.message, cells: e.cells }, { status: 400 });
    if (e instanceof KpiConflictError) return NextResponse.json({ error: e.message, conflicts: e.conflicts }, { status: 409 });
    throw e;
  }
}
