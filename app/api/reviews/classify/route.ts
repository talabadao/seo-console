import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { classifyPending, type ReviewProject } from "@/lib/reviews";

export const maxDuration = 300;

/**
 * Analyses not-yet-classified reviews for up to ~3 minutes and reports how
 * many are left; the Reviews tab calls it again until none remain.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: number };
  const project = await getProject(user.id, Number(body.projectId));
  if (!project?.gbpLocation) return NextResponse.json({ error: "no location linked" }, { status: 400 });
  return NextResponse.json(await classifyPending(project as ReviewProject, 170_000));
}
