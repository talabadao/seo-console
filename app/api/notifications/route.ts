import { NextRequest, NextResponse, after } from "next/server";
import { currentUser } from "@/lib/session";
import { listNotifications, notificationsReady, runRules } from "@/lib/notifications/store";

/**
 * The signed-in account's notifications: ?project=<id>|all&limit=40&unread=1. Local records only. Also runs the
 * notification rules over saved sync results after responding, at most every 10 minutes per account (new ones
 * show up on the next poll); rules never ask a provider.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await notificationsReady())) return NextResponse.json({ error: "This database hasn't run migration 0010 (notifications) yet." }, { status: 503 });
  const q = req.nextUrl.searchParams;
  const project = Number(q.get("project"));
  after(async () => {
    await runRules(user.id).catch(() => {});
  });
  const data = await listNotifications(user.id, {
    projectId: Number.isSafeInteger(project) && project > 0 ? project : null,
    limit: Number(q.get("limit")) || 40,
    unreadOnly: q.get("unread") === "1",
  });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
