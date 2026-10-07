import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { hasBusinessScope } from "@/lib/google/oauth";
import { getProject } from "@/lib/projects";
import { reviewsData, type ReviewProject } from "@/lib/reviews";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await getProject(user.id, Number(req.nextUrl.searchParams.get("projectId")));
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  if (!project.gbpLocation) return NextResponse.json({ error: "no location linked" }, { status: 400 });
  return NextResponse.json({
    ...(await reviewsData(project as ReviewProject)),
    needsReconnect: !hasBusinessScope(user.google_scopes),
  });
}
