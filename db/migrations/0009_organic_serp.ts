import type { Migration } from "../../lib/migrations";

/**
 * Rank tracking → Organic SERP (lib/organicSerp): saved search configurations and saved result snapshots.
 *
 * - serp_configs: a named search (engine, keyword, location, language, device, depth) a project reruns.
 * - serp_snapshots: one explicit run — the normalized organic results (position, title, URL, snippet), SERP
 *   features, where the tracked domain ranked within the scanned depth, and how many SerpApi searches it used.
 *   Opening a snapshot reads this table only; it never searches again. Provider HTML is never stored.
 *   `params_hash` identifies an identical search: the partial unique index lets only one identical run be in
 *   flight per project (a second click or instance joins it instead of paying twice).
 * - demo: invented results for demo projects (.example websites); no SerpApi search is made for them.
 * No credentials are stored: params hold the search settings only.
 */
export const migration: Migration = {
  id: "0009_organic_serp",
  description: "Organic SERP saved configurations and result snapshots",
  statements: [
    `CREATE TABLE IF NOT EXISTS serp_configs (
       id          BIGSERIAL PRIMARY KEY,
       user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       name        TEXT NOT NULL,
       engine      TEXT NOT NULL,
       params      JSONB NOT NULL,
       depth       INT NOT NULL,
       stop_on_found BOOLEAN NOT NULL DEFAULT TRUE,
       created_at  BIGINT NOT NULL,
       updated_at  BIGINT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_serp_configs_project ON serp_configs(project_id)`,
    `CREATE TABLE IF NOT EXISTS serp_snapshots (
       id                BIGSERIAL PRIMARY KEY,
       user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       project_id        BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       config_id         BIGINT REFERENCES serp_configs(id) ON DELETE SET NULL,
       engine            TEXT NOT NULL,
       params            JSONB NOT NULL,
       params_hash       TEXT NOT NULL,
       depth             INT NOT NULL,
       stop_on_found     BOOLEAN NOT NULL,
       status            TEXT NOT NULL,
       started_at        BIGINT NOT NULL,
       finished_at       BIGINT,
       error             TEXT,
       requests          INT NOT NULL DEFAULT 0,
       scanned           INT NOT NULL DEFAULT 0,
       tracked_domain    TEXT,
       tracked_position  INT,
       tracked_url       TEXT,
       results           JSONB,
       features          JSONB,
       demo              BOOLEAN NOT NULL DEFAULT FALSE
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS serp_snapshots_one_running ON serp_snapshots(project_id, params_hash) WHERE status = 'running'`,
    `CREATE INDEX IF NOT EXISTS idx_serp_snapshots_project ON serp_snapshots(project_id, started_at DESC)`,
  ],
};
