import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDenied, viewer } from "@/lib/access";
import { SPENDING_PROVIDERS, scheduledSpending, setScheduledSpending } from "@/lib/spending";
import type { CredentialProvider } from "@/lib/credentials/providers";

/**
 * Your own consent for scheduled paid work on the projects where you are the primary manager (per provider), and
 * those projects. Nobody else can turn it on for you; transferring primary management pauses it for the project
 * until the new primary manager turns theirs on.
 */
export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  const primary = (await db
    .prepare("SELECT id, name FROM projects WHERE primary_manager_id = ? AND deleted_at IS NULL ORDER BY lower(name)")
    .all(user.id)) as Array<{ id: number; name: string }>;
  return NextResponse.json({ settings: await scheduledSpending(user.id), primaryProjects: primary.map((p) => ({ id: Number(p.id), name: p.name })) });
}

/** { provider, enabled } */
export async function PUT(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { provider?: string; enabled?: unknown };
  if (!SPENDING_PROVIDERS.includes(body.provider as CredentialProvider)) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  return NextResponse.json({ settings: await setScheduledSpending(user.id, body.provider as CredentialProvider, body.enabled === true) });
}
