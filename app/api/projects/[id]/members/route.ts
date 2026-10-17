import { NextRequest, NextResponse } from "next/server";
import { isDenied, manageProject, viewProject, viewer } from "@/lib/access";
import { ProjectForbiddenError, ProjectValidationError, addManagers, getProject, listManagers, removeManager, transferPrimary } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) => {
  if (e instanceof ProjectValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof ProjectForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  throw e;
};

/**
 * Who manages a project. Every team member can already VIEW every project; being a manager grants editing, running,
 * sharing, removing people (including the creator), transferring primary management and deleting.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const project = await viewProject(user, (await ctx.params).id);
  if (isDenied(project)) return project;
  return NextResponse.json({
    managers: await listManagers(project.id),
    primaryManagerId: project.primaryManagerId,
    createdBy: project.createdBy,
    createdByName: project.createdByName,
    canManage: project.canManage,
  });
}

/** Shares management with existing team members: { userIds: number[] }. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const project = await manageProject(user, (await ctx.params).id);
  if (isDenied(project)) return project;
  const body = (await req.json().catch(() => ({}))) as { userIds?: unknown };
  const ids = Array.isArray(body.userIds) ? body.userIds.map(Number) : [];
  if (!ids.length) return NextResponse.json({ error: "Choose at least one team member." }, { status: 400 });
  try {
    const r = await addManagers(user.id, project.id, ids);
    return NextResponse.json({ ok: true, added: r.added, managers: await listManagers(project.id) });
  } catch (e) {
    return fail(e);
  }
}

/** Removes a manager: { userId, newPrimaryId? } (a replacement is required when removing the primary manager). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const project = await manageProject(user, (await ctx.params).id);
  if (isDenied(project)) return project;
  const body = (await req.json().catch(() => ({}))) as { userId?: unknown; newPrimaryId?: unknown };
  try {
    await removeManager(user.id, project.id, Number(body.userId), { newPrimaryId: body.newPrimaryId == null ? null : Number(body.newPrimaryId) });
    const after = await getProject(user.id, project.id);
    return NextResponse.json({ ok: true, managers: await listManagers(project.id), canManage: Boolean(after?.canManage) });
  } catch (e) {
    return fail(e);
  }
}

/** Transfers primary management: { primaryManagerId }. Paid schedules pause until the new manager enables spending. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const project = await manageProject(user, (await ctx.params).id);
  if (isDenied(project)) return project;
  const body = (await req.json().catch(() => ({}))) as { primaryManagerId?: unknown };
  const next = Number(body.primaryManagerId);
  if (!Number.isSafeInteger(next) || next <= 0) return NextResponse.json({ error: "Choose the new primary manager." }, { status: 400 });
  try {
    await transferPrimary(user.id, project.id, next);
    return NextResponse.json({ ok: true, managers: await listManagers(project.id) });
  } catch (e) {
    return fail(e);
  }
}
