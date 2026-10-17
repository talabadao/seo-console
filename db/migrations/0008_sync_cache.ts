import type { Migration } from "../../lib/migrations";

/**
 * Shared, persistent report cache and durable synchronization jobs (lib/sync). Replaces the per-instance
 * in-memory cache as the correctness boundary: every server instance reads and writes the same rows.
 *
 * - report_cache: the last successful result per (authorization scope, canonical query). `scope` is the account
 *   ("user:<id>") whose credentials and project ownership produced it — data is never shared across accounts.
 *   `generation` is the id of the job that wrote it; a result from an older job never replaces a newer one.
 *   `access_error` hides the payload when the provider said the account lost access (401/403).
 * - sync_jobs: one open job (queued or running) per (scope, canonical query) — the partial unique index makes
 *   thirty identical cold reads on any number of instances join one job. Leases (lease_until/lease_token)
 *   let a crashed worker's job be picked up again; only the lease holder can complete it.
 * - provider_rate / provider_cooldown: request windows and Retry-After cool-downs per provider quota scope
 *   (an SE Ranking key, a GA4 property, a Search Console site, an Asana token), shared by all instances.
 * No credentials are stored here: queries hold ids, dates and filters only.
 */
export const migration: Migration = {
  id: "0008_sync_cache",
  description: "Shared report cache, durable sync jobs, provider rate windows and cool-downs",
  statements: [
    `CREATE TABLE IF NOT EXISTS report_cache (
       scope          TEXT NOT NULL,
       cache_key      TEXT NOT NULL,
       kind           TEXT NOT NULL,
       provider       TEXT NOT NULL,
       user_id        BIGINT REFERENCES users(id) ON DELETE CASCADE,
       project_id     BIGINT REFERENCES projects(id) ON DELETE CASCADE,
       query          JSONB NOT NULL,
       payload        JSONB,
       generation     BIGINT NOT NULL DEFAULT 0,
       fetched_at     BIGINT,
       fresh_until    BIGINT,
       data_through   TEXT,
       access_error   TEXT,
       last_error     TEXT,
       last_error_at  BIGINT,
       hits           BIGINT NOT NULL DEFAULT 0,
       misses         BIGINT NOT NULL DEFAULT 0,
       last_read_at   BIGINT,
       PRIMARY KEY (scope, cache_key)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_report_cache_project ON report_cache(project_id, kind)`,
    `CREATE INDEX IF NOT EXISTS idx_report_cache_due ON report_cache(fresh_until)`,
    `CREATE TABLE IF NOT EXISTS sync_jobs (
       id                 BIGSERIAL PRIMARY KEY,
       scope              TEXT NOT NULL,
       cache_key          TEXT NOT NULL,
       kind               TEXT NOT NULL,
       provider           TEXT NOT NULL,
       user_id            BIGINT REFERENCES users(id) ON DELETE CASCADE,
       project_id         BIGINT REFERENCES projects(id) ON DELETE CASCADE,
       query              JSONB NOT NULL,
       reason             TEXT NOT NULL,
       status             TEXT NOT NULL,
       attempts           INT NOT NULL DEFAULT 0,
       max_attempts       INT NOT NULL DEFAULT 3,
       run_after          BIGINT NOT NULL,
       lease_until        BIGINT,
       lease_token        TEXT,
       created_at         BIGINT NOT NULL,
       started_at         BIGINT,
       finished_at        BIGINT,
       error              TEXT,
       provider_requests  INT NOT NULL DEFAULT 0,
       retries            INT NOT NULL DEFAULT 0
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_one_open ON sync_jobs(scope, cache_key) WHERE status IN ('queued', 'running')`,
    `CREATE INDEX IF NOT EXISTS idx_sync_jobs_due ON sync_jobs(status, run_after)`,
    `CREATE INDEX IF NOT EXISTS idx_sync_jobs_scope ON sync_jobs(scope, created_at)`,
    `CREATE TABLE IF NOT EXISTS provider_rate (
       bucket        TEXT PRIMARY KEY,
       window_start  BIGINT NOT NULL,
       used          INT NOT NULL,
       updated_at    BIGINT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS provider_cooldown (
       bucket      TEXT PRIMARY KEY,
       until       BIGINT NOT NULL,
       reason      TEXT,
       updated_at  BIGINT NOT NULL
     )`,
  ],
};
