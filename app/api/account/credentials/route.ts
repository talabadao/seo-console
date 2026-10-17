import { NextResponse } from "next/server";
import { credentialGuard } from "@/lib/credentials/api";
import { storageConfigured } from "@/lib/credentials/crypto";
import { credentialStatuses } from "@/lib/credentials/store";
import { consolidateLegacySerpKeys, serverKeysAllowed } from "@/lib/credentials/resolve";
import type { CredentialStatus } from "@/lib/credentials/providers";

/**
 * The signed-in account's API credentials: saved state, masked hint, last update and last check per provider
 * (never a secret). Also moves identical legacy project SerpApi keys into the account credential — no choice
 * involved — and lists different ones that need the owner to choose.
 */
export async function GET() {
  const g = await credentialGuard({ write: false });
  if ("error" in g) return g.error;
  const legacySerp = await consolidateLegacySerpKeys(g.user.id);
  const statuses = await credentialStatuses(g.user.id);
  const serverAllowed = await serverKeysAllowed(g.user.id);
  const env = (n: string) => Boolean(process.env[n]?.trim());
  const serverHas: Record<CredentialStatus["provider"], boolean> = {
    serpapi: env("SERPAPI_API_KEY"),
    openai: env("OPENAI_API_KEY"),
    anthropic: env("ANTHROPIC_API_KEY"),
    dataforseo: env("DATAFORSEO_LOGIN") && env("DATAFORSEO_PASSWORD"),
  };
  const providers = statuses.map((s) => (!s.saved && serverAllowed && serverHas[s.provider] ? { ...s, source: "server-legacy" as const } : s));
  return NextResponse.json(
    { account: { email: g.user.email }, storageConfigured: storageConfigured(), providers, legacySerp },
    { headers: { "Cache-Control": "no-store" } },
  );
}
