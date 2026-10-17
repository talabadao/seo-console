import { NextRequest, NextResponse } from "next/server";
import { gaForProperty, isDenied, managementRequired, viewer } from "@/lib/access";
import { configFor, reportWindows, saveConfig, type KpiConfig } from "@/lib/weeklyReport";

/** The Weekly report settings of a GA4 property mapped by a project the team member can see. */
export async function GET(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const p = req.nextUrl.searchParams;
  const propertyId = p.get("propertyId");
  if (!propertyId || !(await gaForProperty(user, propertyId))) {
    return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  }
  const yearMonth = p.get("yearMonth") || reportWindows().yearMonth;
  return NextResponse.json(await configFor(user.id, propertyId, yearMonth));
}

/** Saves Weekly report settings: a management action on the property's project. */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = await req.json().catch(() => ({}));
  const propertyId = String(body.propertyId ?? "");
  const ga = propertyId ? await gaForProperty(user, propertyId) : null;
  if (!ga) return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  if (!ga.project.canManage) return managementRequired(ga.project);
  const yearMonth = String(body.yearMonth ?? reportWindows().yearMonth);
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: "invalid yearMonth" }, { status: 400 });
  }

  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const cfg: KpiConfig = {
    yearMonth,
    trafficOrganicTarget: num(body.trafficOrganicTarget),
    trafficAiTarget: num(body.trafficAiTarget),
    leadOrganicTarget: num(body.leadOrganicTarget),
    leadAiTarget: num(body.leadAiTarget),
    leadEvents: Array.isArray(body.leadEvents) ? body.leadEvents.map(String).filter(Boolean) : [],
    asanaProjectGid: String(body.asanaProjectGid ?? ""),
    asanaStatusTitle: String(body.asanaStatusTitle ?? ""),
  };
  // A property that belongs to a project has its targets in KPI Planning (kpi_targets); this route leaves targets
  // alone and saves only the other report settings, so there's one target editor.
  await saveConfig(user.id, propertyId, cfg, { keepTargets: true });
  return NextResponse.json({ ok: true, config: await configFor(user.id, propertyId, yearMonth), targetsIgnored: true });
}
