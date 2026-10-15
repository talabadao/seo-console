import type { Migration } from "../../lib/migrations";

/**
 * AI Area and provider usage.
 * - provider_usage: one row per billable (or provider-metered) request the app makes — SerpApi searches,
 *   OpenAI / Anthropic calls — with units, tokens and an estimated cost and the pricing version used.
 *   Rows are written before the request ("reserved") and completed after it, so retries and pagination
 *   are counted and nothing is counted twice.
 * - provider_allowances: caps enforced atomically (UPDATE ... WHERE used + n <= max), e.g. the Preview
 *   SerpApi smoke-test allowance or a project's monthly SerpApi cap. Concurrent requests can't overshoot.
 * - ai_runs: one row per tracking / brand-mention run, with the estimate shown before it and what it
 *   actually used. At most one running run per project and kind (partial unique index).
 * - ai_documents: the AI Area's JSON documents (tracking config and per-keyword history, brand-mention
 *   prompts, cycles and settings), keyed by project. Replaces the donor app's Vercel Blob files.
 * The key fingerprint is a SHA-256 prefix of a provider key, used to group usage by account; keys are
 * never stored here.
 */
export const migration: Migration = {
  id: "0003_ai_area",
  description: "AI Area: provider usage ledger, allowances, runs and documents",
  statements: [
    `CREATE TABLE IF NOT EXISTS provider_usage (
       id               BIGSERIAL PRIMARY KEY,
       user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       project_id       BIGINT REFERENCES projects(id) ON DELETE SET NULL,
       provider         TEXT NOT NULL,
       operation        TEXT NOT NULL,
       run_id           TEXT,
       key_fingerprint  TEXT,
       units            DOUBLE PRECISION NOT NULL DEFAULT 0,
       unit_type        TEXT NOT NULL,
       model            TEXT,
       input_tokens     BIGINT,
       output_tokens    BIGINT,
       est_cost_usd     DOUBLE PRECISION,
       pricing_version  TEXT,
       status           TEXT NOT NULL,
       error            TEXT,
       created_at       BIGINT NOT NULL,
       completed_at     BIGINT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_provider_usage_project ON provider_usage(project_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_provider_usage_provider ON provider_usage(provider, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_provider_usage_run ON provider_usage(run_id)`,
    `CREATE TABLE IF NOT EXISTS provider_allowances (
       key         TEXT PRIMARY KEY,
       max_units   DOUBLE PRECISION NOT NULL,
       used_units  DOUBLE PRECISION NOT NULL DEFAULT 0,
       note        TEXT,
       created_at  BIGINT NOT NULL,
       updated_at  BIGINT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS ai_runs (
       id           TEXT PRIMARY KEY,
       user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       kind         TEXT NOT NULL,
       trigger      TEXT NOT NULL,
       status       TEXT NOT NULL,
       estimate     TEXT,
       actual       TEXT,
       error        TEXT,
       started_at   BIGINT NOT NULL,
       finished_at  BIGINT
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ai_runs_one_running ON ai_runs(project_id, kind) WHERE status = 'running'`,
    `CREATE INDEX IF NOT EXISTS idx_ai_runs_project ON ai_runs(project_id, kind, started_at)`,
    `CREATE TABLE IF NOT EXISTS ai_documents (
       project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       kind        TEXT NOT NULL,
       doc_key     TEXT NOT NULL,
       data        JSONB NOT NULL,
       updated_at  BIGINT NOT NULL,
       PRIMARY KEY (project_id, kind, doc_key)
     )`,
  ],
};
