import { NextRequest, NextResponse } from "next/server";
import { isDenied, manageProject, viewer } from "@/lib/access";
import { ProjectValidationError, deleteProject, updateProject, type ProjectInput } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string }> };

/** Edits project details and mappings: any management member (viewers get 403 with who can grant access). */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const managed = await manageProject(user, (await ctx.params).id);
  if (isDenied(managed)) return managed;
  const body = (await req.json().catch(() => ({}))) as ProjectInput;
  try {
    const project = await updateProject(user.id, managed.id, body);
    if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
    return NextResponse.json({ project });
  } catch (e) {
    if (e instanceof ProjectValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

/** Deletes the project (recoverable; queued work is cancelled, history kept): any management member. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const managed = await manageProject(user, (await ctx.params).id);
  if (isDenied(managed)) return managed;
  if (!(await deleteProject(user.id, managed.id))) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
