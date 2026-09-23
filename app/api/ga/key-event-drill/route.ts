import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { GoogleReauthRequiredError, accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { ownsGaProperty, aiDomainsFor } from "@/lib/gaConfig";
import { cleanGaError, type DateRange } from "@/lib/ga4";
import { keyEventDrill } from "@/lib/gaChannels";
import {
  resolveComparison,
  resolveRange,
  type CompareMode,
  type PresetId,
} from "@/lib/dateRanges";

export const maxDuration = 120;

const DIM: Record<string, string> = {
  sourceMedium: "sessionSourceMedium",
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
  if (!propertyId || !(await ownsGaProperty(user.id, propertyId)) || !eventName) {
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
  const channel = p.get("channel") || "";
  const aiDomains = aiDomainsFor(user);

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    if (e instanceof GoogleReauthRequiredError) return NextResponse.json({ needsReconnect: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  try {
    const res = await keyEventDrill(token, propertyId, current, previous, eventName, DIM[by], channel, aiDomains);
    return NextResponse.json({ by, eventName, channel, rows: res.rows, sampled: res.sampled });
  } catch (e) {
    const cleaned = cleanGaError(e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: cleaned.message, enableUrl: cleaned.enableUrl },
      { status: 502 },
    );
  }
}
