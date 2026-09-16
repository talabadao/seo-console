import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { ownsGaProperty, aiDomainsFor } from "@/lib/gaConfig";
import { cleanGaError, Semaphore } from "@/lib/ga4";
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

  const w = reportWindows();
  const config = await configFor(user.id, propertyId, w.yearMonth);
  const aiDomains = aiDomainsFor(user);

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

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
