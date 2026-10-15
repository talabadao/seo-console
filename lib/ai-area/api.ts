// Shared guards for AI Area API routes: a signed-in, allowlisted user and a project that user owns. Unlike the
// donor app (which relied on the whole deployment being behind Vercel login), every route checks both.

import { NextResponse } from "next/server";
import { currentUser, type UserRow } from "@/lib/session";
import { getProject, type Project } from "@/lib/projects";
import { AiAreaUnavailable, aiAreaReady } from "./store";

export type Ctx = { params: Promise<{ id: string }> };

export async function guard(ctx: Ctx): Promise<{ user: UserRow; project: Project } | { error: NextResponse }> {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return { error: NextResponse.json({ error: "unknown project" }, { status: 404 }) };
  if (!(await aiAreaReady())) return { error: NextResponse.json({ error: new AiAreaUnavailable().message, state: "unavailable" }, { status: 503 }) };
  return { user, project };
}

export function errorResponse(e: unknown, status = 500): NextResponse {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
}
