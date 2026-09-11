import { db } from "@/lib/db";
import { DEFAULT_FILTER_CONFIG, type SiteFilterConfig } from "@/lib/queryFilters";

interface SiteConfigRow {
  id: number;
  property: string;
  brand_terms: string | null;
  longtail_min_words: number | null;
  ai_pos_op: string | null;
  ai_pos_value: number | null;
  ai_impr_max: number | null;
}

function seedBrandTerms(property: string): string[] {
  const host = property.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").split("/")[0];
  const core = host.split(".").filter((p) => !["www", "com", "net", "org", "co", "io"].includes(p));
  const joined = core.join("");
  const spaced = joined.replace(/([a-z])([A-Z])/g, "$1 $2");
  return [...new Set([joined, spaced, ...core].filter((t) => t.length > 2))];
}

export async function siteConfigFor(
  userId: number,
  property: string,
): Promise<{ siteId: number; config: SiteFilterConfig } | null> {
  const row = (await db
    .prepare(
      `SELECT id, property, brand_terms, longtail_min_words, ai_pos_op, ai_pos_value, ai_impr_max
         FROM sites WHERE user_id = ? AND property = ? AND source = 'google'`,
    )
    .get(userId, property)) as SiteConfigRow | undefined;
  if (!row) return null;

  let brandTerms: string[];
  try {
    brandTerms = row.brand_terms ? JSON.parse(row.brand_terms) : seedBrandTerms(property);
  } catch {
    brandTerms = row.brand_terms ? row.brand_terms.split(",").map((s) => s.trim()) : [];
  }

  return {
    siteId: row.id,
    config: {
      brandTerms,
      longtailMinWords: row.longtail_min_words ?? DEFAULT_FILTER_CONFIG.longtailMinWords,
      aiPosOp: (row.ai_pos_op as SiteFilterConfig["aiPosOp"]) ?? DEFAULT_FILTER_CONFIG.aiPosOp,
      aiPosValue: row.ai_pos_value ?? DEFAULT_FILTER_CONFIG.aiPosValue,
      aiImprMax: row.ai_impr_max ?? DEFAULT_FILTER_CONFIG.aiImprMax,
    },
  };
}

export async function saveSiteConfig(
  userId: number,
  property: string,
  patch: Partial<SiteFilterConfig>,
) {
  const cur = await siteConfigFor(userId, property);
  if (!cur) return null;
  const merged = { ...cur.config, ...patch };
  await db
    .prepare(
      `UPDATE sites SET brand_terms = ?, longtail_min_words = ?, ai_pos_op = ?, ai_pos_value = ?, ai_impr_max = ?
       WHERE id = ?`,
    )
    .run(
      JSON.stringify(merged.brandTerms),
      merged.longtailMinWords,
      merged.aiPosOp,
      merged.aiPosValue,
      merged.aiImprMax,
      cur.siteId,
    );
  return merged;
}

export { seedBrandTerms };
