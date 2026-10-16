import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject, listProjects } from "@/lib/projects";
import { BudgetInputError, LIMITS, budgetsReady, effectiveLimits, setLimit, type LimitScope } from "@/lib/budgets";

/**
 * The account's budget limits: account-wide limits, and each project's (?project=<id> for just one). Every
 * value says whether it was set in Settings or is the server default.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await budgetsReady())) return NextResponse.json({ error: "This database hasn't run migration 0006 (budget limits) yet.", state: "unavailable" }, { status: 503 });
  const raw = req.nextUrl.searchParams.get("project");
  const projects = raw ? [await getProject(user.id, Number(raw))].filter((x) => x !== null) : await listProjects(user.id);
  if (raw && !projects.length) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  const account = await effectiveLimits(user.id, null);
  const perProject = await Promise.all(
    projects.map(async (p) => ({ id: p!.id, name: p!.name, limits: (await effectiveLimits(user.id, p!.id)).filter((l) => l.scope === "project") })),
  );
  return NextResponse.json({ specs: LIMITS.map(({ default: _d, ...rest }) => (void _d, rest)), account, projects: perProject }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Sets one limit: { scope: "account" | "project", projectId?, metric, value } — value null returns it to the
 * server default. The project must be one of the account's own.
 */
export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await budgetsReady())) return NextResponse.json({ error: "This database hasn't run migration 0006 (budget limits) yet." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { scope?: unknown; projectId?: unknown; metric?: unknown; value?: unknown };
  const scope: LimitScope | null = body.scope === "account" || body.scope === "project" ? body.scope : null;
  if (!scope) return NextResponse.json({ error: "Unknown scope." }, { status: 400 });
  let projectId: number | null = null;
  if (scope === "project") {
    const project = await getProject(user.id, Number(body.projectId));
    if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
    projectId = project.id;
  }
  const value = body.value === null || body.value === "" ? null : Number(body.value);
  try {
    const limit = await setLimit(user.id, scope, projectId, String(body.metric ?? ""), value);
    return NextResponse.json({ limit });
  } catch (e) {
    if (e instanceof BudgetInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
