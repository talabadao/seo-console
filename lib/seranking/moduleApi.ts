// Shared request handling for the SE Ranking module routes (overview, competition, audit, backlinks): the signed-in
// owner's project, the explicit site mapping, the shared cache and one set of availability states:
//   demo · unconfigured · not-mapped · unauthorized · pending · error · live (fresh or stale, with cache info)
// Never generated data in live mode: a demo project (.example website) says "demo" and the page shows its labelled
// demo screen.

import { NextResponse, after } from "next/server";
import { currentUser, type UserRow } from "@/lib/session";
import { getProject, type Project } from "@/lib/projects";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { seRankingConfigured } from "./rankings";
import { peek, readThrough, setBackgroundRunner, syncReady } from "@/lib/sync/cache";
import { projectConfigVersion, type SeModuleQuery } from "@/lib/sync/kinds";

export type Ctx = { params: Promise<{ id: string }> };

export async function loadProject(ctx: Ctx): Promise<{ user: UserRow; project: Project } | { error: NextResponse }> {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return { error: NextResponse.json({ error: "unknown project" }, { status: 404 }) };
  return { user, project };
}

/** A state that isn't data: demo, unconfigured or migration missing. Null when the module can be read. */
export async function preconditions(project: Project): Promise<NextResponse | null> {
  if (isDemoWebsite(project.websiteUrl)) return NextResponse.json({ state: "demo", message: "Demo project: SE Ranking isn't queried for .example websites." });
  if (!seRankingConfigured()) return NextResponse.json({ state: "unconfigured", message: "SE Ranking isn't connected to SEO Console (no SE Ranking API key on the server)." });
  if (!(await syncReady())) return NextResponse.json({ state: "error", message: "This database hasn't run migration 0008 (shared cache) yet." }, { status: 503 });
  return null;
}

export async function moduleQuery(user: UserRow, project: Project): Promise<SeModuleQuery> {
  return { projectId: project.id, config: await projectConfigVersion(user, project) };
}

type Payload = { status: "ok" | "not-mapped"; chosenMissing?: boolean } & Record<string, unknown>;

/** Turns a cached module payload (or its absence) into the page's JSON. */
export function respond(r: { state: string; payload?: unknown; fetchedAt?: number | null; dataThrough?: string | null; refreshing?: boolean; error?: string | null; cooldown?: boolean }, extra: Record<string, unknown> = {}) {
  const cache = { state: r.state === "stale" ? "stale" : "fresh", fetchedAt: r.fetchedAt ?? null, dataThrough: r.dataThrough ?? null, refreshing: Boolean(r.refreshing), lastError: r.error ?? null, cooldown: r.cooldown };
  const p = r.payload as Payload | undefined;
  if (p?.status === "not-mapped") {
    return NextResponse.json({
      state: "not-mapped",
      chosenMissing: Boolean(p.chosenMissing),
      message: p.chosenMissing ? "The SE Ranking project chosen for this project is no longer in the SE Ranking account." : "No SE Ranking project tracks this website. Choose one in Project settings → Integrations.",
      ...extra,
    });
  }
  if (p) return NextResponse.json({ state: "live", data: p, cache, ...extra });
  if (r.state === "pending") return NextResponse.json({ state: "pending", message: "Fetching from SE Ranking for the first time…", ...extra });
  if (r.error && /\b(401|403)\b|forbidden|unauthori[sz]ed/i.test(r.error)) return NextResponse.json({ state: "unauthorized", message: `SE Ranking refused the server's key: ${r.error}`, ...extra });
  return NextResponse.json({ state: "error", message: r.error ?? "The refresh failed.", ...extra });
}

/** Reads a module through the shared cache (refresh=1 is a manual refresh: joins any open job, 5-minute cooldown). */
export async function readModule(kind: string, user: UserRow, project: Project, opts: { refresh?: boolean; waitMs?: number } = {}) {
  setBackgroundRunner((fn) => after(fn));
  return readThrough({ kind, userId: user.id, projectId: project.id, query: await moduleQuery(user, project), waitMs: opts.waitMs ?? 20_000, force: opts.refresh });
}

/** A module's saved data without fetching anything (for summary panels and manual-only datasets). */
export async function peekModule(kind: string, user: UserRow, project: Project) {
  return peek<Payload>({ kind, userId: user.id, query: await moduleQuery(user, project) });
}
