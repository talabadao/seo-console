// The database schema as it exists today, kept in one place so the app's
// startup check (lib/db.ts) and the versioned migration runner
// (db/migrations/0001_baseline.ts, scripts/migrate.mts) apply exactly the same
// statements. Everything here is idempotent: CREATE ... IF NOT EXISTS and
// ADD COLUMN IF NOT EXISTS, so running it against an existing database is a no-op.
// New schema changes go into new numbered migrations, not into this file.

export const BASELINE_DDL = `
    CREATE TABLE IF NOT EXISTS users (
      id                    BIGSERIAL PRIMARY KEY,
      email                 TEXT UNIQUE NOT NULL,
      name                  TEXT,
      picture               TEXT,
      google_access_token   TEXT,
      google_refresh_token  TEXT,
      google_token_expiry   BIGINT,
      bing_api_key          TEXT,
      asana_api_token       TEXT,
      google_scopes         TEXT,
      ga_ai_domains         TEXT,
      created_at            BIGINT NOT NULL,
      updated_at            BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
      id                  BIGSERIAL PRIMARY KEY,
      user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source              TEXT NOT NULL,
      property            TEXT NOT NULL,
      permission_level    TEXT,
      created_at          BIGINT NOT NULL,
      brand_terms         TEXT,
      longtail_min_words  INTEGER DEFAULT 7,
      ai_pos_op           TEXT DEFAULT '=',
      ai_pos_value        DOUBLE PRECISION DEFAULT 1.0,
      ai_impr_max         INTEGER DEFAULT 10,
      auto_index_enabled  BOOLEAN NOT NULL DEFAULT false,
      auto_index_cap      INTEGER NOT NULL DEFAULT 100,
      auto_index_hour     INTEGER NOT NULL DEFAULT 3,
      UNIQUE(user_id, source, property)
    );

    CREATE TABLE IF NOT EXISTS perf_rows (
      id          BIGSERIAL PRIMARY KEY,
      site_id     BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      data_date   TEXT NOT NULL,
      dimension   TEXT NOT NULL,
      key         TEXT NOT NULL DEFAULT '',
      clicks      DOUBLE PRECISION NOT NULL DEFAULT 0,
      impressions DOUBLE PRECISION NOT NULL DEFAULT 0,
      ctr         DOUBLE PRECISION NOT NULL DEFAULT 0,
      position    DOUBLE PRECISION NOT NULL DEFAULT 0,
      UNIQUE(site_id, data_date, dimension, key)
    );
    CREATE INDEX IF NOT EXISTS idx_perf_lookup ON perf_rows(site_id, dimension, data_date);
    CREATE INDEX IF NOT EXISTS idx_perf_key ON perf_rows(site_id, dimension, key);

    CREATE TABLE IF NOT EXISTS sync_log (
      id           BIGSERIAL PRIMARY KEY,
      site_id      BIGINT NOT NULL,
      source       TEXT NOT NULL,
      started_at   BIGINT NOT NULL,
      finished_at  BIGINT,
      status       TEXT NOT NULL,
      message      TEXT,
      rows_written INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS url_inspections (
      id                BIGSERIAL PRIMARY KEY,
      site_id           BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      url               TEXT NOT NULL,
      inspected_at      BIGINT NOT NULL,
      verdict           TEXT,
      coverage_state    TEXT,
      robots_txt_state  TEXT,
      indexing_state    TEXT,
      page_fetch_state  TEXT,
      last_crawl_time   TEXT,
      google_canonical  TEXT,
      user_canonical    TEXT,
      crawled_as        TEXT,
      raw_json          TEXT,
      rich_results      TEXT,
      in_sitemap        INTEGER DEFAULT 0,
      submitted_at      BIGINT,
      submit_result     TEXT,
      rich_verdict      TEXT,
      inspect_link      TEXT,
      UNIQUE(site_id, url)
    );

    CREATE TABLE IF NOT EXISTS sitemap_urls (
      id         BIGSERIAL PRIMARY KEY,
      site_id    BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      url        TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'sitemap',
      first_seen BIGINT NOT NULL,
      last_seen  BIGINT NOT NULL,
      UNIQUE(site_id, url)
    );
    CREATE INDEX IF NOT EXISTS idx_sitemap_site ON sitemap_urls(site_id);

    CREATE TABLE IF NOT EXISTS index_snapshots (
      site_id      BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      snap_date    TEXT NOT NULL,
      indexed      INTEGER NOT NULL DEFAULT 0,
      not_indexed  INTEGER NOT NULL DEFAULT 0,
      total_known  INTEGER NOT NULL DEFAULT 0,
      states_json  TEXT,
      PRIMARY KEY (site_id, snap_date)
    );

    CREATE TABLE IF NOT EXISTS quota_usage (
      site_id     BIGINT NOT NULL,
      usage_date  TEXT NOT NULL,
      inspections INTEGER NOT NULL DEFAULT 0,
      submissions INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, usage_date)
    );

    CREATE TABLE IF NOT EXISTS index_jobs (
      site_id     BIGINT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      started_at  BIGINT,
      finished_at BIGINT,
      status      TEXT,
      message     TEXT,
      checked     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ga_properties (
      id            BIGSERIAL PRIMARY KEY,
      user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id   TEXT NOT NULL,
      display_name  TEXT,
      account_name  TEXT,
      currency_code TEXT,
      time_zone     TEXT,
      created_at    BIGINT NOT NULL,
      UNIQUE(user_id, property_id)
    );

    CREATE TABLE IF NOT EXISTS url_status_history (
      id              BIGSERIAL PRIMARY KEY,
      site_id         BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      url             TEXT NOT NULL,
      changed_at      BIGINT NOT NULL,
      before_state    TEXT,
      after_state     TEXT,
      indexing_change INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_status_hist ON url_status_history(site_id, changed_at DESC);

    -- One row per URL per calendar day it was inspected — a daily indexing
    -- history per URL, distinct from url_status_history (which only logs
    -- on a state change) and index_snapshots (site-level daily aggregate).
    CREATE TABLE IF NOT EXISTS url_daily_index_log (
      site_id        BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      url            TEXT NOT NULL,
      log_date       TEXT NOT NULL,
      coverage_state TEXT,
      verdict        TEXT,
      indexed        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, url, log_date)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_log_site_date ON url_daily_index_log(site_id, log_date);

    -- Manually-set monthly KPI targets + which GA4 events count as "leads",
    -- for the Weekly Report dashboard. Scoped to a GA4 property (not a GSC
    -- sites row) since every Weekly Report metric comes from GA4.
    CREATE TABLE IF NOT EXISTS weekly_kpi_config (
      id                      BIGSERIAL PRIMARY KEY,
      user_id                 BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id             TEXT NOT NULL,
      year_month              TEXT NOT NULL,
      traffic_organic_target  DOUBLE PRECISION NOT NULL DEFAULT 0,
      traffic_ai_target       DOUBLE PRECISION NOT NULL DEFAULT 0,
      lead_organic_target     DOUBLE PRECISION NOT NULL DEFAULT 0,
      lead_ai_target          DOUBLE PRECISION NOT NULL DEFAULT 0,
      lead_events             TEXT NOT NULL DEFAULT '[]',
      updated_at              BIGINT NOT NULL,
      UNIQUE(user_id, property_id, year_month)
    );

    -- A project groups the assets that belong to one brand/website: a Search
    -- Console property, a GA4 property and a Business Profile location, plus
    -- its display details and Asana target. Everything in the console is
    -- viewed through the selected project.
    CREATE TABLE IF NOT EXISTS projects (
      id                  BIGSERIAL PRIMARY KEY,
      user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                TEXT NOT NULL,
      website_url         TEXT NOT NULL DEFAULT '',
      favicon_url         TEXT NOT NULL DEFAULT '',
      gsc_property        TEXT,
      ga_property_id      TEXT,
      gbp_location        TEXT,
      gbp_location_title  TEXT,
      asana_project_gid   TEXT NOT NULL DEFAULT '',
      asana_project_name  TEXT NOT NULL DEFAULT '',
      created_at          BIGINT NOT NULL,
      updated_at          BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

    -- Pages a project tracks in PageSpeed Insights, and one stored result per
    -- page, strategy (mobile/desktop) and day.
    CREATE TABLE IF NOT EXISTS psi_pages (
      id         BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      url        TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE(project_id, url)
    );

    CREATE TABLE IF NOT EXISTS psi_runs (
      id             BIGSERIAL PRIMARY KEY,
      page_id        BIGINT NOT NULL REFERENCES psi_pages(id) ON DELETE CASCADE,
      strategy       TEXT NOT NULL,
      run_date       TEXT NOT NULL,
      fetched_at     BIGINT NOT NULL,
      score          INTEGER,
      fcp            DOUBLE PRECISION,
      lcp            DOUBLE PRECISION,
      tbt            DOUBLE PRECISION,
      cls            DOUBLE PRECISION,
      si             DOUBLE PRECISION,
      field_lcp      DOUBLE PRECISION,
      field_inp      DOUBLE PRECISION,
      field_cls      DOUBLE PRECISION,
      field_fcp      DOUBLE PRECISION,
      field_ttfb     DOUBLE PRECISION,
      field_category TEXT,
      field_origin   BOOLEAN NOT NULL DEFAULT false,
      recs_json      TEXT,
      error          TEXT,
      UNIQUE(page_id, strategy, run_date)
    );

    -- Google Maps reviews for a project's business (fetched through SerpApi), with
    -- the classifier's output (sentiment, English text, praise/criticism
    -- points). classified_at is NULL until a review has been analysed.
    CREATE TABLE IF NOT EXISTS gbp_reviews (
      id            BIGSERIAL PRIMARY KEY,
      project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      location      TEXT NOT NULL,
      review_id     TEXT NOT NULL,
      reviewer_name TEXT,
      star          INTEGER NOT NULL DEFAULT 0,
      comment       TEXT NOT NULL DEFAULT '',
      create_time   BIGINT NOT NULL DEFAULT 0,
      update_time   BIGINT NOT NULL DEFAULT 0,
      reply_comment TEXT,
      reply_time    BIGINT,
      sentiment     TEXT,
      comment_en    TEXT,
      points_json   TEXT,
      classified_at BIGINT,
      UNIQUE(project_id, location, review_id)
    );
    CREATE INDEX IF NOT EXISTS idx_gbp_reviews_time ON gbp_reviews(project_id, location, create_time DESC);

    -- Per-location sync status and the fixed aspect list reviews are tagged with.
    CREATE TABLE IF NOT EXISTS gbp_state (
      project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      location       TEXT NOT NULL,
      average_rating DOUBLE PRECISION,
      total_reviews  INTEGER,
      synced_at      BIGINT,
      sync_error     TEXT,
      aspects_json   TEXT,
      PRIMARY KEY (project_id, location)
    );
  `;

/** Columns added after their table's first release: [table, column, type and default]. */
export const BASELINE_COLUMNS: readonly [table: string, column: string, ddl: string][] = [
  ["url_inspections", "in_sitemap", "INTEGER DEFAULT 0"],
  ["sites", "auto_index_enabled", "BOOLEAN NOT NULL DEFAULT false"],
  ["sites", "auto_index_cap", "INTEGER NOT NULL DEFAULT 100"],
  ["sites", "auto_index_hour", "INTEGER NOT NULL DEFAULT 3"],
  ["users", "asana_api_token", "TEXT"],
  ["weekly_kpi_config", "asana_project_gid", "TEXT NOT NULL DEFAULT ''"],
  ["weekly_kpi_config", "asana_status_title", "TEXT NOT NULL DEFAULT ''"],
  ["ga_properties", "time_zone", "TEXT"],
  ["users", "projects_seeded", "BOOLEAN NOT NULL DEFAULT false"],
  ["projects", "maps_url", "TEXT NOT NULL DEFAULT ''"],
  ["projects", "serpapi_key", "TEXT"],
  ["gbp_reviews", "source_en", "TEXT"],
  ["gbp_reviews", "link", "TEXT"],
  ["gbp_state", "topics_json", "TEXT"],
  ["gbp_state", "address", "TEXT"],
  ["gbp_state", "place_type", "TEXT"],
  ["gbp_state", "credits_spent", "INTEGER NOT NULL DEFAULT 0"],
  ["gbp_state", "next_token", "TEXT"],
];

/**
 * One-off data correction kept from before versioned migrations: the
 * longtailMinWords setting's UI was removed in favour of a fixed default, so
 * any site still at the old default of 4 moves to 7.
 */
export const BASELINE_DATA_FIXES: readonly string[] = [
  "UPDATE sites SET longtail_min_words = 7 WHERE longtail_min_words = 4",
];

export const addColumnSql = (table: string, column: string, ddl: string) =>
  `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`;

/** Every baseline statement, in the order lib/db.ts has always run them. */
export const BASELINE_STATEMENTS: readonly string[] = [
  BASELINE_DDL,
  ...BASELINE_COLUMNS.map(([t, c, d]) => addColumnSql(t, c, d)),
  ...BASELINE_DATA_FIXES,
];
