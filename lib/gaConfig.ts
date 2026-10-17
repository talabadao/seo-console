import { db } from "@/lib/db";
import { DEFAULT_AI_DOMAINS } from "@/lib/ga4";

/** Parses a stored AI-domain list (JSON array, or a legacy comma/space/newline separated string). */
export function parseAiDomains(raw: string | null | undefined): string[] {
  if (!raw) return DEFAULT_AI_DOMAINS;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? arr.map(String) : DEFAULT_AI_DOMAINS;
  } catch {
    const list = raw
      .split(/[\s,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length ? list : DEFAULT_AI_DOMAINS;
  }
}

/**
 * The AI source domains a project's reports classify as AI traffic. A project setting (management members edit
 * it), so every viewer sees the same numbers; migrated from the legacy owner's personal setting.
 */
export async function aiDomainsForProject(projectId: number): Promise<string[]> {
  const r = (await db.prepare("SELECT ai_domains FROM project_settings WHERE project_id = ?").get(projectId)) as { ai_domains: string | null } | undefined;
  return parseAiDomains(r?.ai_domains);
}

export async function saveProjectAiDomains(projectId: number, domains: string[]): Promise<string[]> {
  const list = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))].slice(0, 100);
  await db
    .prepare(
      `INSERT INTO project_settings (project_id, ai_domains, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET ai_domains = EXCLUDED.ai_domains, updated_at = EXCLUDED.updated_at`,
    )
    .run(projectId, list.length ? JSON.stringify(list) : null, Date.now());
  return list.length ? list : DEFAULT_AI_DOMAINS;
}
