import { NextRequest, NextResponse } from "next/server";
import { isDenied, manageProject, viewProject, viewer } from "@/lib/access";
import { aiDomainsForProject, saveProjectAiDomains } from "@/lib/gaConfig";

/** The AI source domains a project's reports classify as AI traffic (?projectId=). Any team member may read them. */
export async function GET(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const project = await viewProject(user, req.nextUrl.searchParams.get("projectId"));
  if (isDenied(project)) return project;
  return NextResponse.json({ aiDomains: await aiDomainsForProject(project.id), canManage: project.canManage });
}

/** Changes them for the project (every viewer then sees the same classification): managers only. */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { projectId?: number; aiDomains?: string[] };
  const project = await manageProject(user, body.projectId);
  if (isDenied(project)) return project;
  if (!Array.isArray(body.aiDomains)) return NextResponse.json({ error: "aiDomains array required" }, { status: 400 });
  return NextResponse.json({ aiDomains: await saveProjectAiDomains(project.id, body.aiDomains.map(String)) });
}
