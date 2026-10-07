import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import {
  MAX_PAGES_PER_PROJECT,
  addPage,
  countPages,
  pageFor,
  projectPages,
  removePage,
} from "@/lib/pagespeed";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = Number(req.nextUrl.searchParams.get("projectId"));
  if (!(await getProject(user.id, projectId))) {
    return NextResponse.json({ error: "unknown project" }, { status: 404 });
  }
  return NextResponse.json({ pages: await projectPages(projectId), maxPages: MAX_PAGES_PER_PROJECT });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: number; url?: string };
  const projectId = Number(body.projectId);
  if (!(await getProject(user.id, projectId))) {
    return NextResponse.json({ error: "unknown project" }, { status: 404 });
  }

  const raw = (body.url ?? "").trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return NextResponse.json({ error: "That isn't a valid page address." }, { status: 400 });
  }
  if (!raw || !url.hostname.includes(".")) {
    return NextResponse.json({ error: "That isn't a valid page address." }, { status: 400 });
  }
  url.hash = "";

  if ((await countPages(projectId)) >= MAX_PAGES_PER_PROJECT) {
    return NextResponse.json(
      { error: `A project can track up to ${MAX_PAGES_PER_PROJECT} pages.` },
      { status: 400 },
    );
  }
  return NextResponse.json({ page: await addPage(projectId, url.toString()) });
}

export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const page = await pageFor(user.id, Number(req.nextUrl.searchParams.get("pageId")));
  if (!page) return NextResponse.json({ error: "unknown page" }, { status: 404 });
  await removePage(page.id);
  return NextResponse.json({ ok: true });
}
