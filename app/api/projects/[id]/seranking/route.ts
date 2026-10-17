import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { managementRequired } from "@/lib/access";
import { listSites, matchSite, seRankingConfigured } from "@/lib/seranking/rankings";
import { saveSeRankingSite, seRankingSiteFor } from "@/lib/projectSettings";

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Ctx) {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return { error: NextResponse.json({ error: "unknown project" }, { status: 404 }) };
  return { project };
}

/** The SE Ranking projects in the account, the one chosen for this project, and the website match. Read-only. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  if (!seRankingConfigured()) return NextResponse.json({ configured: false, sites: [], chosen: null, matched: null });
  try {
    const sites = await listSites();
    const chosen = await seRankingSiteFor(r.project.id);
    return NextResponse.json({ configured: true, sites, chosen, matched: matchSite(sites, r.project.websiteUrl)?.id ?? null });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** Chooses the SE Ranking project for this project; null goes back to matching by website. Managers only. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  if (!r.project.canManage) return managementRequired(r.project);
  const body = (await req.json().catch(() => ({}))) as { siteId?: unknown };
  const siteId = body.siteId == null ? null : Number(body.siteId);
  if (siteId !== null && !Number.isSafeInteger(siteId)) return NextResponse.json({ error: "bad siteId" }, { status: 400 });
  try {
    if (siteId !== null && !(await listSites()).some((s) => s.id === siteId)) {
      return NextResponse.json({ error: "That SE Ranking project isn't in the account." }, { status: 400 });
    }
    await saveSeRankingSite(r.project.id, siteId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
