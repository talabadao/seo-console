import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { GoogleReauthRequiredError, accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { ownsGaProperty, aiDomainsFor } from "@/lib/gaConfig";
import { cleanGaError, getPropertyMeta, propertyNow, Semaphore } from "@/lib/ga4";
import {
  availableEvents,
  buildKpiCard,
  configFor,
  leadsPair,
  reportWindows,
  topBottomUrls,
  trafficPair,
} from "@/lib/weeklyReport";

export const maxDuration = 300;

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

  const aiDomains = aiDomainsFor(user);

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    if (e instanceof GoogleReauthRequiredError) return NextResponse.json({ needsReconnect: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  // GA4 interprets date ranges in the property's own timezone, and this
  // server runs in UTC (Vercel) — anchoring "today" to the server's clock
  // instead would drift by the property's UTC offset, under/overcounting a
  // partial day at every window boundary versus a reference report.
  const cachedTz = (await db
    .prepare("SELECT time_zone FROM ga_properties WHERE user_id = ? AND property_id = ?")
    .get(user.id, propertyId)) as { time_zone: string | null } | undefined;
  let timeZone = cachedTz?.time_zone ?? null;
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

  const w = reportWindows(propertyNow(timeZone));
  const config = await configFor(user.id, propertyId, w.yearMonth);

  try {
    // Fired as up to 3 at a time rather than one big Promise.all — GA4's
    // per-property concurrent-request quota ("Exhausted concurrent requests
    // quota") is easy to trip with 10 simultaneous queries for one page load.
    const sem = new Semaphore(3);
    const [
      last7Traffic,
      last7Leads,
      mtdTraffic,
      mtdLeads,
      mtdYoyTraffic,
      mtdYoyLeads,
      last30Traffic,
      last30Leads,
      events,
      urls,
    ] = await Promise.all([
      sem.run(() => trafficPair(token, propertyId, w.last7, w.prev7, aiDomains)),
      sem.run(() => leadsPair(token, propertyId, w.last7, w.prev7, aiDomains, config.leadEvents)),
      sem.run(() => trafficPair(token, propertyId, w.mtd, w.mtdPrev, aiDomains)),
      sem.run(() => leadsPair(token, propertyId, w.mtd, w.mtdPrev, aiDomains, config.leadEvents)),
      sem.run(() => trafficPair(token, propertyId, w.mtd, w.mtdYoy, aiDomains)),
      sem.run(() => leadsPair(token, propertyId, w.mtd, w.mtdYoy, aiDomains, config.leadEvents)),
      sem.run(() => trafficPair(token, propertyId, w.last30, w.prev30, aiDomains)),
      sem.run(() => leadsPair(token, propertyId, w.last30, w.prev30, aiDomains, config.leadEvents)),
      sem.run(() => availableEvents(token, propertyId, w.last30)),
      sem.run(() => topBottomUrls(token, propertyId, w.last7, w.prev7, aiDomains)),
    ]);

    const kpis = {
      trafficOrganic: buildKpiCard(mtdTraffic.curTotals.organic, last30Traffic.curTotals.organic, config.trafficOrganicTarget, w),
      trafficAi: buildKpiCard(mtdTraffic.curTotals.ai, last30Traffic.curTotals.ai, config.trafficAiTarget, w),
      leadOrganic: buildKpiCard(mtdLeads.curTotals.organic, last30Leads.curTotals.organic, config.leadOrganicTarget, w),
      leadAi: buildKpiCard(mtdLeads.curTotals.ai, last30Leads.curTotals.ai, config.leadAiTarget, w),
    };

    return NextResponse.json({
      windows: w,
      config,
      availableEvents: events,
      kpis,
      sections: {
        last7: { traffic: last7Traffic, leads: last7Leads },
        mtdVsLastPeriod: { traffic: mtdTraffic, leads: mtdLeads },
        mtdVsLastYear: { traffic: mtdYoyTraffic, leads: mtdYoyLeads },
        last30VsLastPeriod: { traffic: last30Traffic, leads: last30Leads },
      },
      topUrls: urls.top,
      bottomUrls: urls.bottom,
    });
  } catch (e) {
    const cleaned = cleanGaError(e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: cleaned.message, enableUrl: cleaned.enableUrl },
      { status: 502 },
    );
  }
}
