import { NextRequest, NextResponse } from "next/server";
import { credentialGuard } from "@/lib/credentials/api";
import { CredentialInputError, cleanValues, credentialStatuses, removeCredential, saveCredential } from "@/lib/credentials/store";
import { providerSpec } from "@/lib/credentials/providers";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * Saves or replaces the account's credential for one provider: { values: { apiKey } } or, for DataForSEO,
 * { values: { login, password } }. Storage only: nothing is called at the provider and nothing billable runs.
 * Success is reported only after the encrypted row is written; on any error the saved credential is unchanged.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await credentialGuard({ write: true });
  if ("error" in g) return g.error;
  const { provider } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { values?: unknown };
  try {
    const clean = cleanValues(provider, body.values);
    const status = await saveCredential(g.user.id, clean.provider, clean.values);
    return NextResponse.json({ status });
  } catch (e) {
    if (e instanceof CredentialInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

/** Removes the account's credential for one provider (explicit action). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const g = await credentialGuard({ write: false });
  if ("error" in g) return g.error;
  const { provider } = await ctx.params;
  const spec = providerSpec(provider);
  if (!spec) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  const removed = await removeCredential(g.user.id, spec.id);
  const status = (await credentialStatuses(g.user.id)).find((s) => s.provider === spec.id);
  return NextResponse.json({ removed, status });
}
