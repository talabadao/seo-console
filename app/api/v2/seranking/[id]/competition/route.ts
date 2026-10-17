import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadProject, peekModule, preconditions, readModule, respond, type Ctx } from "@/lib/seranking/moduleApi";

export const maxDuration = 60;

/** SE Ranking competition for one project, from the shared cache (?refresh=1 = explicit refresh, ?peek=1 = saved data only). Project API reads only. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const l = await loadProject(ctx);
  if ("error" in l) return l.error;
  const blocked = await preconditions(l.project);
  if (blocked) return blocked;
  // ?peek=1: only what's already saved (summary panels elsewhere must not trigger this module's requests).
  if (req.nextUrl.searchParams.get("peek") === "1") {
    const p = await peekModule("seranking:competition", l.user, l.project);
    if (!p.payload) return NextResponse.json({ state: "not-fetched", message: "Not fetched yet; open the page to load it." });
    return respond({ state: "fresh", payload: p.payload, fetchedAt: p.fetchedAt, error: p.lastError, refreshing: p.refreshing });
  }
  return respond(await readModule("seranking:competition", l.user, l.project, { refresh: req.nextUrl.searchParams.get("refresh") === "1", waitMs: 45_000 }));
}
