import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { markRead, notificationsReady } from "@/lib/notifications/store";

/** Marks notifications read or unread: { ids?: number[], all?: boolean, project?: number|null, unread?: boolean }. Own rows only. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await notificationsReady())) return NextResponse.json({ error: "notifications unavailable" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: unknown; project?: unknown; unread?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0) : [];
  const project = Number(body.project);
  const changed = await markRead(user.id, {
    ids,
    all: body.all === true,
    projectId: Number.isSafeInteger(project) && project > 0 ? project : null,
    unread: body.unread === true,
  });
  return NextResponse.json({ changed });
}
