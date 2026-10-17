import type { Migration } from "../../lib/migrations";

/**
 * Operations and incremental sync:
 * - cron_runs: one row per authenticated scheduled run (job, start/end, status, work processed/queued/skipped,
 *   duration, a sanitized error summary). Unauthenticated requests are refused before a row is written, so "the
 *   cron ran, nothing was due" is distinguishable from "the cron never ran". Bounded retention (lib/cronRuns.ts).
 *   No secrets, no request data.
 * - gsc_daily_coverage: for each Search Console site (per account: sites.id), the contiguous date range whose daily
 *   totals are stored in perf_rows (dimension 'total'). Lets dashboards fetch only missing days plus a short overlap
 *   that Google may still revise, instead of whole periods on every refresh.
 */
export const migration: Migration = {
  id: "0012_ops_incremental",
  description: "Scheduled-run history and Search Console daily-coverage tracking",
  statements: [
    `CREATE TABLE IF NOT EXISTS cron_runs (
       id           BIGSERIAL PRIMARY KEY,
       job          TEXT NOT NULL,
       started_at   BIGINT NOT NULL,
       finished_at  BIGINT,
       status       TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
       processed    INT NOT NULL DEFAULT 0,
       queued       INT NOT NULL DEFAULT 0,
       skipped      INT NOT NULL DEFAULT 0,
       details      JSONB,
       error        TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job, started_at DESC)`,
    `CREATE TABLE IF NOT EXISTS gsc_daily_coverage (
       site_id       BIGINT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
       covered_from  TEXT NOT NULL,
       covered_to    TEXT NOT NULL,
       refreshed_at  BIGINT NOT NULL
     )`,
  ],
};
