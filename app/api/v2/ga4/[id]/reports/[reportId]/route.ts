import { NextResponse } from "next/server";
import { cleanName, deleteSaved, getSaved, savedReportsAvailable, updateSaved } from "@/lib/v2/ga4reports/saved";
import { gaRouteContext, ownedProject, validateSpec, type RouteCtx } from "@/lib/v2/ga4reports/routeContext";

const reportIdOf = async (ctx: RouteCtx) => {
  const n = Number((await ctx.params).reportId);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** One saved report of this account and project, with whether the project's GA4 property has changed since. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const owned = await ownedProject(ctx);
  if (owned instanceof NextResponse) return owned;
  const id = await reportIdOf(ctx);
  const report = id && (await savedReportsAvailable()) ? await getSaved(owned.user.id, owned.project.id, id) : null;
  if (!report) return NextResponse.json({ error: "unknown report" }, { status: 404 });
  return NextResponse.json({ report, propertyChanged: report.propertyId !== owned.project.gaPropertyId, currentPropertyId: owned.project.gaPropertyId });
}

/**
 * Edits a saved report: { name, spec, rebind? }, validated against the project's current GA4 property. A report
 * made for another property is only updated with `rebind: true` (the owner chose to use it with the current one).
 */
export async function PUT(req: Request, ctx: RouteCtx) {
  const c = await gaRouteContext(ctx);
  if (c instanceof NextResponse) return c;
  const id = await reportIdOf(ctx);
  const existing = id && (await savedReportsAvailable()) ? await getSaved(c.user.id, c.project.id, id) : null;
  if (!existing || !id) return NextResponse.json({ error: "unknown report" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; spec?: unknown; rebind?: unknown };
  if (existing.propertyId !== c.propertyId && body.rebind !== true) {
    return NextResponse.json({ state: "property-changed", savedPropertyId: existing.propertyId, currentPropertyId: c.propertyId }, { status: 409 });
  }
  const name = cleanName(body.name ?? existing.name);
  if (!name) return NextResponse.json({ ok: false, errors: ["Give the report a name."] }, { status: 400 });
  const v = await validateSpec(c, body.spec ?? existing.spec);
  if (!v.ok) return NextResponse.json(v, { status: 400 });
  const report = await updateSaved(c.user.id, c.project.id, id, { name, spec: v.spec, propertyId: c.propertyId });
  return report ? NextResponse.json({ ok: true, report }) : NextResponse.json({ error: "unknown report" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const owned = await ownedProject(ctx);
  if (owned instanceof NextResponse) return owned;
  const id = await reportIdOf(ctx);
  const ok = id && (await savedReportsAvailable()) ? await deleteSaved(owned.user.id, owned.project.id, id) : false;
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "unknown report" }, { status: 404 });
}
