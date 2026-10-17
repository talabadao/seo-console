import { NextRequest, NextResponse } from "next/server";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { ENGINES, SerpInputError, hostOf, normalizeInput } from "@/lib/organicSerp/engines";
import { RunRefused, listConfigs, listSnapshots, runSearch } from "@/lib/organicSerp/store";
import { load, type Ctx } from "./_load";

export const maxDuration = 60;

/** Organic SERP for one project: engines, tracked domain, saved searches and snapshot history. Database only. */
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
 * Runs one search explicitly: { engine, params, depth, stopOnFound, configId?, force? }. Shows an identical
 * search from the last hour instead unless force; joins an identical run in flight. Each page is one metered
 * SerpApi search (limits and the Preview allowance apply).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const input = normalizeInput(body);
    const configId = Number(body.configId) || null;
    const out = await runSearch({ userId: r.user.id, project: r.project, input, configId, force: body.force === true });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof SerpInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof RunRefused) return NextResponse.json({ error: e.message, refused: true }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
