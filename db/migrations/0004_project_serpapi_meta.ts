import type { Migration } from "../../lib/migrations";

/**
 * When a project's SerpApi key was last saved, so the credential status can show "updated <date>" without
 * ever returning the key itself. Additive column; the key stays in projects.serpapi_key (set via its own
 * endpoint now, so saving it no longer rides the project-fields update).
 */
export const migration: Migration = {
  id: "0004_project_serpapi_meta",
  description: "projects.serpapi_key_updated_at for credential status",
  statements: [`ALTER TABLE projects ADD COLUMN IF NOT EXISTS serpapi_key_updated_at BIGINT`],
};
