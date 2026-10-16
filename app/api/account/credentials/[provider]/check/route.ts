import { NextRequest, NextResponse } from "next/server";
import { credentialGuard } from "@/lib/credentials/api";
import { checkCredential } from "@/lib/credentials/check";
import { credentialStatuses, readCredential, recordVerification } from "@/lib/credentials/store";
import { providerSpec } from "@/lib/credentials/providers";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * Verifies the account's saved credential with a non-billable provider call (see lib/credentials/check.ts) and
 * records the result separately from the saved state. Allowed on Preview: it reads an account or model list;
 * it doesn't run a search, a generation or a tracking job.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const g = await credentialGuard({ write: true });
  if ("error" in g) return g.error;
  const spec = providerSpec((await ctx.params).provider);
  if (!spec) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  const saved = await readCredential(g.user.id, spec.id);
  if (!saved) return NextResponse.json({ error: `No ${spec.label} credential is saved for this account.` }, { status: 404 });
  const outcome = await checkCredential(spec.id, saved.values);
  await recordVerification(g.user.id, spec.id, saved.fingerprint, outcome.ok, outcome.message);
  const status = (await credentialStatuses(g.user.id)).find((s) => s.provider === spec.id);
  return NextResponse.json({ outcome, status });
}
