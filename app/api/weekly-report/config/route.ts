import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { ownsGaProperty } from "@/lib/gaConfig";
import { configFor, reportWindows, saveConfig, type KpiConfig } from "@/lib/weeklyReport";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const propertyId = p.get("propertyId");
  if (!propertyId || !(await ownsGaProperty(user.id, propertyId))) {
    return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  }
  const yearMonth = p.get("yearMonth") || reportWindows().yearMonth;
  return NextResponse.json(await configFor(user.id, propertyId, yearMonth));
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const propertyId = String(body.propertyId ?? "");
  if (!propertyId || !(await ownsGaProperty(user.id, propertyId))) {
    return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  }
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
  await saveConfig(user.id, propertyId, cfg);
  return NextResponse.json({ ok: true, config: cfg });
}
