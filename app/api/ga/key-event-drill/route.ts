import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { ownsGaProperty } from "@/lib/gaConfig";
import { eqFilter, trendBreakdown, type DateRange } from "@/lib/ga4";
import {
  resolveComparison,
  resolveRange,
  type CompareMode,
  type PresetId,
} from "@/lib/dateRanges";

export const maxDuration = 120;

const DIM: Record<string, string> = {
  referrer: "pageReferrer",
  landing: "landingPagePlusQueryString",
  pagePath: "pagePathPlusQueryString",
};

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasAnalyticsScope(user.google_scopes)) {
    return NextResponse.json({ needsReconnect: true }, { status: 200 });
  }

  const p = req.nextUrl.searchParams;
  const propertyId = p.get("propertyId");
  const eventName = p.get("eventName");
  const by = DIM[p.get("by") || ""] ? (p.get("by") as string) : "pagePath";
  if (!propertyId || !ownsGaProperty(user.id, propertyId) || !eventName) {
    return NextResponse.json({ error: "propertyId, eventName required" }, { status: 400 });
  }

  const preset = (p.get("preset") || "28d") as PresetId;
  const r = resolveRange(preset, {
    customStart: p.get("start") || undefined,
    customEnd: p.get("end") || undefined,
  });
  const current: DateRange = { startDate: r.start, endDate: r.end };
  const prevR = resolveComparison(r, (p.get("compare") || "none") as CompareMode, {
    matchWeekdays: p.get("matchWeekdays") === "1",
  });
  const previous: DateRange | null = prevR
    ? { startDate: prevR.start, endDate: prevR.end }
    : null;

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  try {
    const res = await trendBreakdown(token, propertyId, {
      dimensions: [DIM[by]],
      metrics: ["keyEvents", "totalRevenue"],
      current,
      previous,
      dimensionFilter: eqFilter("eventName", eventName),
      limit: 2000,
    });
    return NextResponse.json({ by, eventName, rows: res.rows, sampled: res.sampled });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
