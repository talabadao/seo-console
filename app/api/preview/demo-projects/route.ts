import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { createDemoProjects, demoProjectsAllowed } from "@/lib/previewDemo";

/**
 * Preview and local development only: adds synthetic demo projects to the
 * signed-in user's own account. Writes only to this deployment's database
 * (the isolated Preview database on Preview); no external service is called.
 */
export async function POST() {
  if (!demoProjectsAllowed()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const created = await createDemoProjects(user.id);
  return NextResponse.json({ created });
}
