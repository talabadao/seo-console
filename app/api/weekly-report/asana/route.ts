import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { ownsGaProperty } from "@/lib/gaConfig";
import { configFor, reportWindows } from "@/lib/weeklyReport";
import { createStatusUpdate, type AsanaStatusType } from "@/lib/asana";

const VALID_STATUS: AsanaStatusType[] = ["on_track", "at_risk", "off_track", "on_hold", "complete", "achieved"];

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.asana_api_token) {
    return NextResponse.json({ error: "Asana isn't connected — add a token in Settings." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const propertyId = String(body.propertyId ?? "");
  if (!propertyId || !(await ownsGaProperty(user.id, propertyId))) {
    return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  }

  const config = await configFor(user.id, propertyId, reportWindows().yearMonth);
  const projectGid = config.asanaProjectGid.trim();
  if (!projectGid) {
    return NextResponse.json({ error: "No Asana project configured for this property." }, { status: 400 });
  }

  const statusType = String(body.statusType ?? "") as AsanaStatusType;
  if (!VALID_STATUS.includes(statusType)) {
    return NextResponse.json({ error: "invalid statusType" }, { status: 400 });
  }
  const title = String(body.title ?? "").trim();
  const htmlText = String(body.htmlText ?? "");
  if (!title || !htmlText) {
    return NextResponse.json({ error: "title and htmlText are required" }, { status: 400 });
  }

  try {
    const result = await createStatusUpdate(user.asana_api_token, {
      parent: projectGid,
      title,
      htmlText,
      statusType,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
