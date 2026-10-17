import { NextRequest, NextResponse } from "next/server";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { ENGINES, isEngine, maxRequests } from "@/lib/organicSerp/engines";
import { serpDecision } from "@/lib/providers/policy";
import { allowanceStatuses, tightest } from "@/lib/providers/ledger";
import { NO_SERP_KEY, serpKey } from "@/lib/providers/serpapi";
import { load, type Ctx } from "../_load";

/**
 * Expected usage before a run (?engine=&depth=): at most one SerpApi search per results page, whether this
 * project may search at all (Preview, limits, key) and the tightest limit's room. Reads only; sends nothing.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  const q = req.nextUrl.searchParams;
  const engine = q.get("engine");
  if (!isEngine(engine)) return NextResponse.json({ error: "unknown engine" }, { status: 400 });
  const depth = ENGINES[engine].depths.includes(Number(q.get("depth"))) ? Number(q.get("depth")) : ENGINES[engine].depths[0];
  const requests = maxRequests(engine, depth);
  if (isDemoWebsite(r.project.websiteUrl)) return NextResponse.json({ requests: 0, maxRequests: requests, demo: true, allowed: true });
  const decision = await serpDecision(r.user.id, r.project.id);
  if (!decision.allowed) return NextResponse.json({ requests, maxRequests: requests, allowed: false, reason: decision.reason });
  if (!(await serpKey(r.user.id, r.project.id))) return NextResponse.json({ requests, maxRequests: requests, allowed: false, reason: NO_SERP_KEY });
  const limits = await allowanceStatuses(decision.allowances);
  const tight = tightest(limits);
  return NextResponse.json({
    requests,
    maxRequests: requests,
    allowed: !tight || tight.left > 0,
    reason: tight && tight.left <= 0 ? `Limit reached: ${tight.label}.` : null,
    limits,
    tightest: tight,
  });
}
