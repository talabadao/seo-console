import type { Migration } from "../../lib/migrations";

/**
 * Per-project settings that used to live elsewhere or didn't exist:
 * - lead_events: which GA4 events count as leads, one list per project
 *   (previously chosen per GA4 property and month in the Weekly Report).
 *   NULL means "not set yet": readers fall back to the latest Weekly Report
 *   selection, so existing choices keep working.
 * - seranking_site_id: the SE Ranking project ("site") whose tracked
 *   keywords belong to this project. NULL means "match by website".
 */
export const migration: Migration = {
  id: "0002_project_settings",
  description: "project_settings: project-level lead events and SE Ranking site",
  statements: [
    `CREATE TABLE IF NOT EXISTS project_settings (
       project_id         BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
       lead_events        TEXT,
       seranking_site_id  BIGINT,
       updated_at         BIGINT NOT NULL
     )`,
  ],
};
