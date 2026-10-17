import { NextRequest, NextResponse } from "next/server";
import { isDenied, manageProject, projectGa, viewProject, viewer } from "@/lib/access";
import { leadEventsFor, saveLeadEvents } from "@/lib/projectSettings";
import { ConnectionUnavailableError } from "@/lib/google/connections";
import { availableEvents, reportWindows } from "@/lib/weeklyReport";
import { cleanGaError } from "@/lib/ga4";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The project's lead events (one list shared by the dashboard, GA4 reports and the Weekly Report) plus the GA4
 * events seen in the last 30 days to choose from, read through the project's connection. Any team member may read.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const project = await viewProject(user, (await ctx.params).id);
  if (isDenied(project)) return project;
  const setting = await leadEventsFor(user.id, project);
  let events: { name: string; count: number; isKeyEvent: boolean }[] | null = null;
  let eventsError: string | null = null;
  const ga = await projectGa(project);
  if (ga instanceof ConnectionUnavailableError) eventsError = "No GA4 property linked to this project.";
  else {
    try {
      events = await availableEvents(await ga.token(), ga.propertyId, reportWindows().last30);
    } catch (e) {
      eventsError = e instanceof ConnectionUnavailableError ? e.message : cleanGaError(e instanceof Error ? e.message : String(e)).message;
    }
  }
  return NextResponse.json({ ...setting, availableEvents: events, eventsError, canManage: project.canManage });
}

/** Changes the lead events: a management action. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const project = await manageProject(user, (await ctx.params).id);
  if (isDenied(project)) return project;
  const body = (await req.json().catch(() => ({}))) as { events?: unknown };
  if (!Array.isArray(body.events)) return NextResponse.json({ error: "events must be a list" }, { status: 400 });
  try {
    const source = await saveLeadEvents(user.id, project, body.events.map(String).slice(0, 100));
    return NextResponse.json({ ok: true, source });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
