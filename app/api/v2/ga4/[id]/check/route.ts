import { NextResponse } from "next/server";
import { gaRouteContext, validateSpec, validationStatus, type RouteCtx } from "@/lib/v2/ga4reports/routeContext";

export const maxDuration = 30;

/**
 * Validates a report definition for the project's GA4 property: structure, field names from the property's
 * metadata, then GA4's own compatibility check. An explicit action (the builder's Check and Save buttons).
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const c = await gaRouteContext(ctx);
  if (c instanceof NextResponse) return c;
  const body = (await req.json().catch(() => ({}))) as { spec?: unknown };
  const v = await validateSpec(c, body.spec);
  return v.ok ? NextResponse.json(v) : NextResponse.json(v, { status: validationStatus(v.kind) });
}
