import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { leadEventsFor, saveLeadEvents } from "@/lib/projectSettings";
import { GoogleReauthRequiredError, accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { ownsGaProperty } from "@/lib/gaConfig";
import { availableEvents, reportWindows } from "@/lib/weeklyReport";
import { cleanGaError } from "@/lib/ga4";

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Ctx) {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return { error: NextResponse.json({ error: "unknown project" }, { status: 404 }) };
  return { user, project };
}

/**
 * The project's lead events (one list shared by the dashboard, GA4 reports and
 * the Weekly Report) plus the GA4 events seen in the last 30 days to choose
 * from. Reading events is a GA4 read; nothing is written to Google.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  const { user, project } = r;
  const setting = await leadEventsFor(user.id, project);
  let events: { name: string; count: number; isKeyEvent: boolean }[] | null = null;
  let eventsError: string | null = null;
  if (!project.gaPropertyId) eventsError = "No GA4 property linked to this project.";
  else if (!hasAnalyticsScope(user.google_scopes)) eventsError = "Google Analytics access hasn't been granted. Sign out and sign in again.";
  else if (!(await ownsGaProperty(user.id, project.gaPropertyId))) eventsError = "This account no longer lists the linked GA4 property.";
  else {
    try {
      const token = await accessTokenFor(user);
      events = await availableEvents(token, project.gaPropertyId, reportWindows().last30);
    } catch (e) {
      eventsError = e instanceof GoogleReauthRequiredError ? e.message : cleanGaError(e instanceof Error ? e.message : String(e)).message;
    }
  }
  return NextResponse.json({ ...setting, availableEvents: events, eventsError });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  const body = (await req.json().catch(() => ({}))) as { events?: unknown };
  if (!Array.isArray(body.events)) return NextResponse.json({ error: "events must be a list" }, { status: 400 });
  try {
    const source = await saveLeadEvents(r.user.id, r.project, body.events.map(String).slice(0, 100));
    return NextResponse.json({ ok: true, source });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
