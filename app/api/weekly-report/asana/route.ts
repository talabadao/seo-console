import { NextRequest, NextResponse } from "next/server";
import { PREVIEW_WRITES_BLOCKED, externalWritesAllowed } from "@/lib/environment";
import { gaForProperty, isDenied, managementRequired, viewer } from "@/lib/access";
import { configFor, reportWindows } from "@/lib/weeklyReport";
import { createStatusUpdate, type AsanaStatusType } from "@/lib/asana";
import { AsanaUnavailableError, asanaToken } from "@/lib/asanaConnections";
import { audit } from "@/lib/auth/identities";

const VALID_STATUS: AsanaStatusType[] = ["on_track", "at_risk", "off_track", "on_hold", "complete", "achieved"];

/**
 * Posts the Weekly report as an Asana status update (an explicit write): a management member of the property's
 * project, through the project's Asana reporting connection (whose owner's Asana access applies; it never acts as
 * a task assignee). The acting team member is recorded. Blocked on Preview.
 */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  if (!externalWritesAllowed()) return NextResponse.json({ error: PREVIEW_WRITES_BLOCKED }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const propertyId = String(body.propertyId ?? "");
  const ga = propertyId ? await gaForProperty(user, propertyId) : null;
  if (!ga) return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  if (!ga.project.canManage) return managementRequired(ga.project);
  if (ga.project.asanaConnectionId == null) {
    return NextResponse.json({ error: "No Asana connection is mapped for this project. Choose one in Project settings → Integrations." }, { status: 400 });
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
  const text = String(body.text ?? "");
  if (!title || !text) {
    return NextResponse.json({ error: "title and text are required" }, { status: 400 });
  }

  try {
    const token = await asanaToken(ga.project.asanaConnectionId);
    const result = await createStatusUpdate(token, { parent: projectGid, title, text, statusType });
    await audit("asana-status-update", { userId: user.id, detail: { projectId: ga.project.id, asanaProject: projectGid, connectionId: ga.project.asanaConnectionId } });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const status = e instanceof AsanaUnavailableError ? 400 : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
