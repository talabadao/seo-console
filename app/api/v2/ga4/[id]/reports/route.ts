import { NextResponse } from "next/server";
import { cleanName, createSaved, getSaved, listSaved, savedReportsAvailable } from "@/lib/v2/ga4reports/saved";
import { gaRouteContext, ownedProject, validateSpec, type RouteCtx } from "@/lib/v2/ga4reports/routeContext";

const UNAVAILABLE = { state: "unavailable", message: "Saved reports need migration 0013 on this database." };

/** This account's saved custom reports for the project. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const owned = await ownedProject(ctx);
  if (owned instanceof NextResponse) return owned;
  if (!(await savedReportsAvailable())) return NextResponse.json(UNAVAILABLE);
  return NextResponse.json({ state: "live", currentPropertyId: owned.project.gaPropertyId, reports: await listSaved(owned.user.id, owned.project.id) });
}

/**
 * Saves a new report: { name, spec }, or a copy of one of this account's reports: { duplicateOf, name? }.
 * The definition is validated for the project's current GA4 property (metadata and compatibility) first.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const c = await gaRouteContext(ctx);
  if (c instanceof NextResponse) return c;
  if (!(await savedReportsAvailable())) return NextResponse.json(UNAVAILABLE);
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; spec?: unknown; duplicateOf?: unknown };
  let name = cleanName(body.name);
  let rawSpec = body.spec;
  if (body.duplicateOf != null) {
    const source = await getSaved(c.user.id, c.project.id, Number(body.duplicateOf));
    if (!source) return NextResponse.json({ error: "unknown report" }, { status: 404 });
    name = name || cleanName(`Copy of ${source.name}`);
    rawSpec = source.spec;
  }
  if (!name) return NextResponse.json({ ok: false, errors: ["Give the report a name."] }, { status: 400 });
  const v = await validateSpec(c, rawSpec);
  if (!v.ok) return NextResponse.json(v, { status: 400 });
  const saved = await createSaved(c.user.id, c.project.id, c.propertyId, name, v.spec);
  if (saved === "limit") return NextResponse.json({ ok: false, errors: ["This project already has 100 saved reports. Delete one first."] }, { status: 400 });
  return NextResponse.json({ ok: true, report: saved });
}
