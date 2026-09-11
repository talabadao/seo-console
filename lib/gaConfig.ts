import { db } from "@/lib/db";
import { DEFAULT_AI_DOMAINS } from "@/lib/ga4";
import type { UserRow } from "@/lib/session";

export function aiDomainsFor(user: Pick<UserRow, "ga_ai_domains">): string[] {
  if (!user.ga_ai_domains) return DEFAULT_AI_DOMAINS;
  try {
    const arr = JSON.parse(user.ga_ai_domains);
    return Array.isArray(arr) && arr.length ? arr.map(String) : DEFAULT_AI_DOMAINS;
  } catch {
    return user.ga_ai_domains
      .split(/[\s,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export async function saveAiDomains(userId: number, domains: string[]) {
  await db
    .prepare("UPDATE users SET ga_ai_domains = ?, updated_at = ? WHERE id = ?")
    .run(
      JSON.stringify(domains.map((d) => d.trim().toLowerCase()).filter(Boolean)),
      Date.now(),
      userId,
    );
}

/** Verify the user has this GA property linked (they picked it), returns its id. */
export async function ownsGaProperty(userId: number, propertyId: string): Promise<boolean> {
  return Boolean(
    await db
      .prepare("SELECT 1 FROM ga_properties WHERE user_id = ? AND property_id = ?")
      .get(userId, propertyId),
  );
}
