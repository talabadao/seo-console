import { NextRequest, NextResponse } from "next/server";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { ENGINES, hostOf } from "@/lib/organicSerp/engines";
import { listConfigs, listSnapshots } from "@/lib/organicSerp/store";
import { load, type Ctx } from "./_load";

export const maxDuration = 60;

/** Archive of the retired multi-engine Organic SERP: engines, tracked domain, saved searches and snapshots. Database only. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  const { user, project } = r;
  return NextResponse.json(
    {
      engines: ENGINES,
      trackedDomain: hostOf(project.websiteUrl) || null,
      demo: isDemoWebsite(project.websiteUrl),
      configs: await listConfigs(user.id, project.id),
      snapshots: await listSnapshots(user.id, project.id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * The multi-engine runner was superseded on 17 Oct 2026 by Organic SERP = Google Search Tracking
 * (/api/ai-area/<id>/tracking/run). New multi-engine searches are refused so nothing can be charged here twice;
 * saved snapshots stay readable (GET above, and /snapshots/<sid>).
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  return NextResponse.json({ error: "Multi-engine searches were retired. Run searches in Organic SERP (Google Search Tracking); saved snapshots stay in the archive.", retired: true }, { status: 410 });
}
