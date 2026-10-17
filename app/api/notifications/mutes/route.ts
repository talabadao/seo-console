import { NextRequest, NextResponse } from "next/server";
import { isDenied, viewProject, viewer } from "@/lib/access";
import { MUTE_CATEGORIES, listMutes, setMute } from "@/lib/notifications/store";

/** The signed-in User's own notification mutes (project 0 = every project). Nobody else can read or change them. */
export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  return NextResponse.json({ mutes: await listMutes(user.id), categories: MUTE_CATEGORIES });
}

/** Mutes or unmutes: { projectId (0 = all projects), category ("all" or one category), muted }. */
export async function PUT(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; category?: unknown; muted?: unknown };
  const projectId = Number(body.projectId ?? 0);
  if (projectId !== 0) {
    const p = await viewProject(user, projectId);
    if (isDenied(p)) return p;
  }
  try {
    await setMute(user.id, projectId, String(body.category ?? "all"), body.muted !== false);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  return NextResponse.json({ mutes: await listMutes(user.id) });
}
