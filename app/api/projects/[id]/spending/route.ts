import { NextResponse } from "next/server";
import { isDenied, viewProject, viewer } from "@/lib/access";
import { SPENDING_PROVIDERS, scheduledPayer } from "@/lib/spending";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Spending status of a project, for anyone who can view it: who pays for scheduled paid work (the primary manager)
 * and, per provider, whether such work could run now or why it is paused. Never a key, fingerprint, budget or usage
 * figure. Manual runs are always billed to the person who starts them.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const project = await viewProject(user, (await ctx.params).id);
  if (isDenied(project)) return project;
  const providers = await Promise.all(
    SPENDING_PROVIDERS.map(async (provider) => {
      const d = await scheduledPayer(project.id, provider);
      return d.ok ? { provider, active: true, reason: null } : { provider, active: false, code: d.code, reason: d.reason };
    }),
  );
  return NextResponse.json({
    primaryManager: project.primaryManagerId ? { id: project.primaryManagerId, name: project.primaryManagerName } : null,
    isPrimaryManager: project.isPrimaryManager,
    providers,
  });
}
