import type { Migration } from "../../lib/migrations";

/**
 * Canonical monthly KPI targets, per project, metric and period (YYYY-MM): what KPI Planning edits and what the
 * dashboard, All projects and the Weekly report read. One row per (project, metric, period) — the primary key
 * prevents duplicate month/metric records. A missing row is a blank target ("no target"); a stored 0 is an
 * explicit target of zero.
 *
 * Backfill: targets used to live in weekly_kpi_config, keyed by account + GA4 property + month, where 0 meant
 * "no target" (the old form saved an empty field as 0). Every value above 0 is copied to each of the account's
 * projects linked to that GA4 property; zeros stay blank. weekly_kpi_config is left as it is (it still holds the
 * older lead-event and Asana fallbacks), so nothing is lost and the backfill can be re-run safely (ON CONFLICT
 * DO NOTHING never overwrites a target already set in KPI Planning).
 */
export const migration: Migration = {
  id: "0007_kpi_targets",
  description: "Canonical monthly KPI targets per project, backfilled from weekly_kpi_config",
  statements: [
    `CREATE TABLE IF NOT EXISTS kpi_targets (
       project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       metric      TEXT NOT NULL,
       period      TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
       target      DOUBLE PRECISION NOT NULL CHECK (target >= 0),
       updated_at  BIGINT NOT NULL,
       updated_by  BIGINT,
       PRIMARY KEY (project_id, metric, period)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_kpi_targets_period ON kpi_targets(project_id, period)`,
    `INSERT INTO kpi_targets (project_id, metric, period, target, updated_at, updated_by)
     SELECT p.id, m.metric, w.year_month, m.value, w.updated_at, w.user_id
       FROM weekly_kpi_config w
       JOIN projects p ON p.user_id = w.user_id AND p.ga_property_id = w.property_id
       CROSS JOIN LATERAL (VALUES
         ('traffic_organic', w.traffic_organic_target),
         ('traffic_ai', w.traffic_ai_target),
         ('lead_organic', w.lead_organic_target),
         ('lead_ai', w.lead_ai_target)
       ) AS m(metric, value)
      WHERE m.value > 0 AND w.year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     ON CONFLICT (project_id, metric, period) DO NOTHING`,
  ],
};
