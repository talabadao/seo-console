import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { GoogleReauthRequiredError, accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { ownsGaProperty } from "@/lib/gaConfig";
import {
  KEY_EVENT_FILTER,
  andFilter,
  cleanGaError,
  eqFilter,
  trendBreakdown,
  type DateRange,
} from "@/lib/ga4";
import {
  resolveComparison,
  resolveRange,
  type CompareMode,
  type PresetId,
} from "@/lib/dateRanges";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasAnalyticsScope(user.google_scopes)) {
    return NextResponse.json({ needsReconnect: true }, { status: 200 });
  }

  const p = req.nextUrl.searchParams;
  const propertyId = p.get("propertyId");
  const sourceMedium = p.get("sourceMedium");
  if (!propertyId || !(await ownsGaProperty(user.id, propertyId)) || !sourceMedium) {
    return NextResponse.json({ error: "propertyId, sourceMedium required" }, { status: 400 });
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
  const previous: DateRange | null = prevR ? { startDate: prevR.start, endDate: prevR.end } : null;

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    if (e instanceof GoogleReauthRequiredError) return NextResponse.json({ needsReconnect: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  try {
    const res = await trendBreakdown(token, propertyId, {
      dimensions: ["eventName"],
      metrics: ["keyEvents", "totalRevenue", "sessions", "totalUsers"],
      current,
      previous,
      dimensionFilter: andFilter(KEY_EVENT_FILTER, eqFilter("sessionSourceMedium", sourceMedium)),
      limit: 2000,
    });
    return NextResponse.json({ sourceMedium, rows: res.rows, sampled: res.sampled });
  } catch (e) {
    const cleaned = cleanGaError(e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: cleaned.message, enableUrl: cleaned.enableUrl },
      { status: 502 },
    );
  }
}
