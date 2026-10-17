import { NextRequest, NextResponse } from "next/server";
import { isDenied, viewer } from "@/lib/access";
import { ProjectForbiddenError, ProjectValidationError, createProject, listProjects, type ProjectInput } from "@/lib/projects";

/** Every live project of the team workspace (both brands); canManage marks the ones the viewer manages. */
export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  return NextResponse.json({ projects: await listProjects(user.id) });
}

/** Any team member can create a project; they become its first manager and primary manager. */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as ProjectInput;
  try {
    return NextResponse.json({ project: await createProject(user.id, body) });
  } catch (e) {
    if (e instanceof ProjectValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof ProjectForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
