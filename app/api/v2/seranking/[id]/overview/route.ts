import { NextRequest } from "next/server";
import { loadProject, preconditions, readModule, respond, type Ctx } from "@/lib/seranking/moduleApi";

export const maxDuration = 60;

/** SE Ranking overview for one project, from the shared cache (?refresh=1 = explicit refresh). Project API reads only. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const l = await loadProject(ctx);
  if ("error" in l) return l.error;
  const blocked = await preconditions(l.project);
  if (blocked) return blocked;
  return respond(await readModule("seranking:overview", l.user, l.project, { refresh: req.nextUrl.searchParams.get("refresh") === "1", waitMs: 20_000 }));
}
