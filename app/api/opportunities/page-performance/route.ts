import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { GoogleReauthRequiredError, accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { ownsGaProperty, aiDomainsFor } from "@/lib/gaConfig";
import { cleanGaError, getPropertyMeta, propertyNow, type DateRange } from "@/lib/ga4";
import { availableChannels, pagePerformanceMatrix } from "@/lib/gaChannels";
import { enumerateBuckets, resolveRange, type PresetId } from "@/lib/dateRanges";

export const maxDuration = 60;

const TIMEFRAME_PRESET: Record<string, PresetId> = {
  "1d": "yesterday",
  "7d": "7d",
  "14d": "14d",
  "28d": "28d",
};

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasAnalyticsScope(user.google_scopes)) {
    return NextResponse.json({ needsReconnect: true }, { status: 200 });
  }

  const p = req.nextUrl.searchParams;
  const propertyId = p.get("propertyId");
  if (!propertyId || !(await ownsGaProperty(user.id, propertyId))) {
    return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  }

  const preset = TIMEFRAME_PRESET[p.get("timeframe") || "7d"] ?? "7d";
  const channel = p.get("channel") || "";
  const aiDomains = aiDomainsFor(user);

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    if (e instanceof GoogleReauthRequiredError) return NextResponse.json({ needsReconnect: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  // Same property-timezone anchoring as the rest of Analytics/Weekly Report —
  // GA4 interprets date ranges in the property's own timezone, not the
  // server's (UTC on Vercel).
  const cached = (await db
    .prepare("SELECT time_zone FROM ga_properties WHERE user_id = ? AND property_id = ?")
    .get(user.id, propertyId)) as { time_zone: string | null } | undefined;
  let timeZone = cached?.time_zone ?? null;
  if (!timeZone) {
    const meta = await getPropertyMeta(token, propertyId);
    timeZone = meta.timeZone;
    if (timeZone) {
      await db
        .prepare(
          "UPDATE ga_properties SET time_zone = COALESCE(time_zone, ?) WHERE user_id = ? AND property_id = ?",
        )
        .run(timeZone, user.id, propertyId);
    }
  }

  const range = resolveRange(preset, { anchor: propertyNow(timeZone) });
  const dateRange: DateRange = { startDate: range.start, endDate: range.end };

  try {
    const [pp, channels] = await Promise.all([
      pagePerformanceMatrix(token, propertyId, dateRange, channel, aiDomains, 50),
      availableChannels(token, propertyId, dateRange),
    ]);
    return NextResponse.json({
      range,
      days: enumerateBuckets(range, "day"),
      rows: pp.rows,
      total: pp.total,
      channels,
      sampled: pp.sampled,
    });
  } catch (e) {
    const cleaned = cleanGaError(e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: cleaned.message, enableUrl: cleaned.enableUrl }, { status: 502 });
  }
}
