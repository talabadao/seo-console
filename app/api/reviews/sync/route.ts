import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { GoogleReauthRequiredError, accessTokenFor, hasBusinessScope } from "@/lib/google/oauth";
import { BusinessProfileError } from "@/lib/google/businessProfile";
import { getProject } from "@/lib/projects";
import { syncReviews, type ReviewProject } from "@/lib/reviews";

export const maxDuration = 300;

/** Pulls the latest reviews for the project's Business Profile location from Google. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: number };
  const project = await getProject(user.id, Number(body.projectId));
  if (!project?.gbpLocation) return NextResponse.json({ error: "no location linked" }, { status: 400 });
  if (!hasBusinessScope(user.google_scopes)) return NextResponse.json({ needsReconnect: true });

  try {
    const token = await accessTokenFor(user);
    return NextResponse.json(await syncReviews(token, project as ReviewProject));
  } catch (e) {
    if (e instanceof GoogleReauthRequiredError) return NextResponse.json({ needsReconnect: true });
    if (e instanceof BusinessProfileError) {
      return NextResponse.json({ error: e.message, enableUrl: e.enableUrl }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
