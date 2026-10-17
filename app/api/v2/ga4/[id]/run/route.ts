import { NextResponse } from "next/server";
import { readThrough } from "@/lib/sync/cache";
import { projectConfigVersion, type Ga4CustomQuery } from "@/lib/sync/kinds";
import { normalizeSpec, unknownFields } from "@/lib/v2/ga4reports/spec";
import { getSaved, savedReportsAvailable } from "@/lib/v2/ga4reports/saved";
import type { CustomResult } from "@/lib/v2/ga4reports/run";
import { GA4_SOURCE, cacheInfo, cachedMetadata, gaRouteContext, periodFor, type RouteCtx } from "@/lib/v2/ga4reports/routeContext";

export const maxDuration = 60;

/**
 * Runs a custom report definition: an explicit action (Run, or opening a saved report), never on each edit.
 * Body: { spec, reportId?, refresh? }. Results go through the shared cache, so an identical run from another tab
 * or a reopened saved report reuses the stored result. A saved report made for a different GA4 property than
 * the project's current one isn't run until it is re-checked for the current property (409).
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const c = await gaRouteContext(ctx);
  if (c instanceof NextResponse) return c;
  const body = (await req.json().catch(() => ({}))) as { spec?: unknown; reportId?: unknown; refresh?: unknown };
  if (body.reportId != null && (await savedReportsAvailable())) {
    const saved = await getSaved(c.user.id, c.project.id, Number(body.reportId));
    if (!saved) return NextResponse.json({ error: "unknown report" }, { status: 404 });
    if (saved.propertyId !== c.propertyId) {
      return NextResponse.json({ state: "property-changed", savedPropertyId: saved.propertyId, currentPropertyId: c.propertyId }, { status: 409 });
    }
  }
  const n = normalizeSpec(body.spec);
  if ("errors" in n) return NextResponse.json({ state: "invalid", errors: n.errors }, { status: 400 });
  const meta = await cachedMetadata(c);
  if ("error" in meta) return NextResponse.json({ state: "error", source: GA4_SOURCE, message: meta.error });
  const unknown = unknownFields(n.spec, meta);
  if (unknown.length) return NextResponse.json({ state: "invalid", errors: [`Not available in this GA4 property: ${unknown.join(", ")}.`] }, { status: 400 });

  const query: Ga4CustomQuery = {
    projectId: c.project.id,
    propertyId: c.propertyId,
    spec: n.spec,
    period: periodFor(n.spec.preset, n.spec.compare, c.timeZone),
    config: await projectConfigVersion(c.project),
  };
  const force = body.refresh === true && c.project.canManage;
  const r = await readThrough<Ga4CustomQuery, CustomResult>({ kind: "ga4:custom", workspaceId: c.project.workspaceId, actorUserId: c.user.id, projectId: c.project.id, query, waitMs: 20_000, force });
  if (r.payload) return NextResponse.json({ state: "live", result: r.payload, cache: cacheInfo(r) });
  if (r.state === "pending") return NextResponse.json({ state: "pending", message: "Fetching from GA4…" });
  return NextResponse.json({ state: "error", source: GA4_SOURCE, message: r.error ?? "The GA4 request failed." });
}
