import { NextResponse } from "next/server";
import { credentialGuard } from "@/lib/credentials/api";
import { storageConfigured } from "@/lib/credentials/crypto";
import { credentialStatuses } from "@/lib/credentials/store";
import { consolidateLegacySerpKeys } from "@/lib/credentials/resolve";

/**
 * The signed-in User's own API credentials: saved state, masked hint, last update and last check per provider
 * (never a secret). Paid runs use only these (never a teammate's key or a shared server key). Also moves identical
 * legacy project SerpApi keys of projects this User owned into their credential — no choice involved — and lists
 * different ones that need them to choose.
 */
export async function GET() {
  const g = await credentialGuard({ write: false });
  if ("error" in g) return g.error;
  const legacySerp = await consolidateLegacySerpKeys(g.user.id);
  const providers = await credentialStatuses(g.user.id);
  return NextResponse.json(
    { account: { email: g.user.email }, storageConfigured: storageConfigured(), providers, legacySerp },
    { headers: { "Cache-Control": "no-store" } },
  );
}
