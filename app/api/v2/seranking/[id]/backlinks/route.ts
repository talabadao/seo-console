import { NextRequest, NextResponse } from "next/server";
import { loadProject, peekModule, preconditions, readModule, respond, type Ctx } from "@/lib/seranking/moduleApi";
import { dataApiEntitlement, linkProfileDecision } from "@/lib/seranking/dataApi";
import { LINK_PROFILE_CREDITS } from "@/lib/seranking/donor/types";

export const maxDuration = 60;

/**
 * Link Building → Backlinks: Backlink Monitor stats (Project API, from the overview dataset) and the saved Data API
 * backlink profile. Reading never spends credits: the profile is only peeked at, and the entitlement check
 * (account/subscription) is free.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const l = await loadProject(ctx);
  if ("error" in l) return l.error;
  const blocked = await preconditions(l.project);
  if (blocked) return blocked;
  const [monitor, profile, entitlement] = await Promise.all([readModule("seranking:overview", l.user, l.project), peekModule("seranking:linkprofile", l.user, l.project), dataApiEntitlement()]);
  const decision = linkProfileDecision(l.user.id);
  return respond(monitor, {
    profile: { data: profile.payload, fetchedAt: profile.fetchedAt, lastError: profile.lastError ?? profile.accessError, refreshing: profile.refreshing },
    entitlement,
    refresh: decision.allowed ? { allowed: true, credits: LINK_PROFILE_CREDITS } : { allowed: false, credits: LINK_PROFILE_CREDITS, reason: decision.reason, remedy: decision.remedy },
  });
}

/** Explicit, budgeted refresh of the backlink profile (Data API credits). Joins a refresh already running. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const l = await loadProject(ctx);
  if ("error" in l) return l.error;
  const blocked = await preconditions(l.project);
  if (blocked) return blocked;
  const decision = linkProfileDecision(l.user.id);
  if (!decision.allowed) return NextResponse.json({ error: decision.reason, remedy: decision.remedy, code: decision.code }, { status: 409 });
  const entitlement = await dataApiEntitlement(true);
  if (entitlement.state !== "available") return NextResponse.json({ error: entitlement.message, code: entitlement.state }, { status: 409 });
  const r = await readModule("seranking:linkprofile", l.user, l.project, { refresh: true, waitMs: 50_000 });
  return respond(r);
}
