import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import {
  ProjectValidationError,
  deleteProject,
  updateProject,
  type ProjectInput,
} from "@/lib/projects";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as ProjectInput;
  try {
    const project = await updateProject(user.id, id, body);
    if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
    return NextResponse.json({ project });
  } catch (e) {
    if (e instanceof ProjectValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!(await deleteProject(user.id, id))) {
    return NextResponse.json({ error: "unknown project" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
