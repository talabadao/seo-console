import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { onSite, pageMetaReady, thumbnails } from "@/lib/pageMeta";

export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Thumbnails for pages of this project's site (?url=<page>&url=<page>…, at most 25; &refresh=1 refetches).
 * Pages off the project's site are refused without a request. Saved for 7 days (see lib/pageMeta.ts).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  const urls = req.nextUrl.searchParams.getAll("url").filter((u) => u.length <= 2000);
  if (!project.websiteUrl || isDemoWebsite(project.websiteUrl) || !(await pageMetaReady())) {
    // Demo projects and projects without a website: neutral placeholders, nothing fetched.
    return NextResponse.json({ items: urls.map((url) => ({ url, image: null, source: "none", fetchedAt: Date.now() })) });
  }
  const allowed = urls.filter((u) => onSite(u, project.websiteUrl));
  const items = await thumbnails(allowed, project.websiteUrl, { refresh: req.nextUrl.searchParams.get("refresh") === "1" });
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=300" } });
}
