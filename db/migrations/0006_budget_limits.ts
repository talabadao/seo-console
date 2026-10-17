import type { Migration } from "../../lib/migrations";

/**
 * Editable spending limits (Settings → Account → Budgets & limits, and Project settings → Budgets). One row
 * per account (project_id = 0) or project, per metric. A missing row means "use the server default", so the
 * limits that applied before this table existed stay in force until someone changes them. Usage history and
 * the running allowances (provider_allowances) are untouched: limits only set the maximum of each period's
 * allowance.
 */
export const migration: Migration = {
  id: "0006_budget_limits",
  description: "Editable account and project budget limits",
  statements: [
    `CREATE TABLE IF NOT EXISTS budget_limits (
       user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       project_id   BIGINT NOT NULL DEFAULT 0,
       metric       TEXT NOT NULL,
       limit_value  DOUBLE PRECISION NOT NULL,
       updated_at   BIGINT NOT NULL,
       PRIMARY KEY (user_id, project_id, metric)
     )`,
  ],
};
