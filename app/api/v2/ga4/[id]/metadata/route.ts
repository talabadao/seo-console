import { NextResponse } from "next/server";
import { GA4_SOURCE, cachedMetadata, gaRouteContext, type RouteCtx } from "@/lib/v2/ga4reports/routeContext";

export const maxDuration = 60;

/** The project's GA4 property dimensions and metrics (standard and custom), for the report builder. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const c = await gaRouteContext(ctx);
  if (c instanceof NextResponse) return c;
  const meta = await cachedMetadata(c);
  if ("error" in meta) return NextResponse.json({ state: "error", source: GA4_SOURCE, message: meta.error });
  return NextResponse.json({ state: "live", propertyId: c.propertyId, timeZone: c.timeZone, currency: c.currency, ...meta });
}
