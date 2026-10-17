import { NextResponse } from "next/server";
import { currentUser, type UserRow } from "@/lib/session";
import { getProject, type Project } from "@/lib/projects";
import { tableExists } from "@/lib/db";

export type Ctx = { params: Promise<{ id: string; sid?: string }> };

/** The signed-in account and its project, or the error response to send. */
export async function load(ctx: Ctx): Promise<{ user: UserRow; project: Project } | { error: NextResponse }> {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return { error: NextResponse.json({ error: "unknown project" }, { status: 404 }) };
  if (!(await tableExists("serp_snapshots"))) {
    return { error: NextResponse.json({ error: "This database hasn't run migration 0009 (Organic SERP) yet.", state: "unavailable" }, { status: 503 }) };
  }
  return { user, project };
}
