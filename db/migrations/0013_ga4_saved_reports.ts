import type { Migration } from "../../lib/migrations";

/**
 * Saved custom GA4 reports (Analytics (GA4) → GA4 reports → Custom reports). Each belongs to one account and one
 * of its projects, and records the GA4 property it was built for: when the project's property changes, the
 * report says so instead of silently running against the new one. `spec` is the relative report definition
 * (lib/v2/ga4reports/spec.ts); results are not stored here (they live in the shared cache).
 */
export const migration: Migration = {
  id: "0013_ga4_saved_reports",
  description: "Saved custom GA4 report definitions",
  statements: [
    `CREATE TABLE IF NOT EXISTS ga4_saved_reports (
       id           BIGSERIAL PRIMARY KEY,
       user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       property_id  TEXT NOT NULL,
       name         TEXT NOT NULL,
       spec         JSONB NOT NULL,
       created_at   BIGINT NOT NULL,
       updated_at   BIGINT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ga4_saved_reports_owner ON ga4_saved_reports(user_id, project_id, updated_at DESC)`,
  ],
};
