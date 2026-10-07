import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import {
  ProjectValidationError,
  createProject,
  listProjects,
  seedProjectsOnce,
  type ProjectInput,
} from "@/lib/projects";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await seedProjectsOnce(user.id);
  return NextResponse.json({ projects: await listProjects(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as ProjectInput;
  try {
    return NextResponse.json({ project: await createProject(user.id, body) });
  } catch (e) {
    if (e instanceof ProjectValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
