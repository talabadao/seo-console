import { NextRequest, NextResponse } from "next/server";
import { readThrough } from "@/lib/sync/cache";
import { projectConfigVersion, type Ga4TemplateQuery } from "@/lib/sync/kinds";
import { leadEventsFor } from "@/lib/projectSettings";
import { TEMPLATES, isTemplateId, type TemplateResult } from "@/lib/v2/ga4reports/templates";
import { GA4_SOURCE, cacheInfo, gaRouteContext, periodFor, type RouteCtx } from "@/lib/v2/ga4reports/routeContext";

export const maxDuration = 60;

/**
 * A built-in GA4 report template for one project, through the shared cache.
 *   ?template=leads|events|landing-pages|traffic-acquisition|user-acquisition&view=<id>&preset=&compare=
 *   &focus=<event or landing page>[,…]&refresh=1
 */
export async function GET(req: NextRequest, ctx: RouteCtx) {
  const c = await gaRouteContext(ctx);
  if (c instanceof NextResponse) return c;
  const q = req.nextUrl.searchParams;
  const template = q.get("template");
  if (!isTemplateId(template)) return NextResponse.json({ error: "unknown template" }, { status: 400 });
  const def = TEMPLATES[template];
  const view = def.views.find((v) => v.id === q.get("view"))?.id ?? def.views[0].id;
  const focus = (q.get("focus") ?? "")
    .split(",")
    .map((s) => s.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 5);
  const leads = def.leadColumn ? await leadEventsFor(c.user.id, c.project) : null;
  const query: Ga4TemplateQuery = {
    projectId: c.project.id,
    propertyId: c.propertyId,
    template,
    view,
    focus,
    leads: leads?.events ?? [],
    leadSource: leads?.source ?? "none",
    period: periodFor(q.get("preset"), q.get("compare"), c.timeZone),
    config: await projectConfigVersion(c.project),
  };
  // A manual refresh is a management action; a viewer's request reads through the normal refresh policy.
  const force = q.get("refresh") === "1" && c.project.canManage;
  const r = await readThrough<Ga4TemplateQuery, TemplateResult>({ kind: "ga4:template", workspaceId: c.project.workspaceId, actorUserId: c.user.id, projectId: c.project.id, query, waitMs: 20_000, force });
  if (r.payload) return NextResponse.json({ state: "live", result: r.payload, cache: cacheInfo(r) });
  if (r.state === "pending") return NextResponse.json({ state: "pending", message: "Fetching from GA4…" });
  return NextResponse.json({ state: "error", source: GA4_SOURCE, message: r.error ?? "The GA4 request failed." });
}
