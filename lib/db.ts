import postgres from "postgres";

/**
 * Postgres-backed replacement for the old node:sqlite connection. Kept the same
 * db.prepare(sql).get/.all/.run(...args) shape as before so every call site in
 * the app is unchanged — only `?` placeholders (SQLite style) are used, and are
 * translated to Postgres's `$1, $2, ...` here. Every method is now async, so
 * call sites use `await db.prepare(...).get(...)` etc.
 */

function connectionString(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a Postgres connection string (e.g. from Neon/Supabase) " +
        "to .env.local for local dev, and as a Vercel project environment variable for deploys.",
    );
  }
  return url;
}

const globalForDb = globalThis as unknown as { __seoSql?: postgres.Sql };

function open(): postgres.Sql {
  const url = connectionString();
  const options: postgres.Options<Record<string, postgres.PostgresType>> = {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // postgres.js returns BIGINT (our ids + epoch-ms timestamps) as strings by
    // default to avoid precision loss. Every value we store in a bigint column
    // is well under Number.MAX_SAFE_INTEGER, and the whole app types ids and
    // timestamps as `number` — parse bigint as a JS number instead.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
    },
  };
  // postgres.js only reads `sslmode` out of the connection string itself when
  // the `ssl` key is absent from this options object entirely — passing
  // `ssl: undefined` still counts as present and silently disables SSL. So
  // only set it here for providers whose URL doesn't already carry sslmode.
  if (!/sslmode=/.test(url)) options.ssl = "require";
  return postgres(url, options);
}

function getSql(): postgres.Sql {
  if (!globalForDb.__seoSql) globalForDb.__seoSql = open();
  return globalForDb.__seoSql;
}

// Migrations run once per process (module-level promise; awaited by every
// query so nothing can run before the schema is ready, without every call
// site needing to know about it).
let migrated: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!migrated) migrated = migrate();
  return migrated;
}

function toPositional(sqlText: string): string {
  let i = 0;
  return sqlText.replace(/\?/g, () => `$${++i}`);
}

export interface DbRunResult {
  count: number;
  rows: Record<string, unknown>[];
}

export interface DbStatement {
  get(...args: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(...args: unknown[]): Promise<Record<string, unknown>[]>;
  run(...args: unknown[]): Promise<DbRunResult>;
}

export const db = {
  prepare(sqlText: string): DbStatement {
    const text = toPositional(sqlText);
    return {
      async all(...args: unknown[]) {
        await ready();
        const rows = await getSql().unsafe(text, args as postgres.ParameterOrJSON<never>[]);
        return rows as unknown as Record<string, unknown>[];
      },
      async get(...args: unknown[]) {
        await ready();
        const rows = await getSql().unsafe(text, args as postgres.ParameterOrJSON<never>[]);
        return (rows as unknown as Record<string, unknown>[])[0];
      },
      async run(...args: unknown[]) {
        await ready();
        const rows = await getSql().unsafe(text, args as postgres.ParameterOrJSON<never>[]);
        return { count: rows.count ?? rows.length, rows: rows as unknown as Record<string, unknown>[] };
      },
    };
  },
  /** Run a batch of statements without `?` args (schema/DDL only). */
  async exec(sqlText: string) {
    await ready();
    return getSql().unsafe(sqlText);
  },
};

/**
 * The underlying postgres.js tagged-template client, for call sites that need
 * multi-row inserts (`sql(array, ...cols)`) or other features the `?`-based
 * `db.prepare()` shim doesn't cover.
 */
export async function rawSql(): Promise<postgres.Sql> {
  await ready();
  return getSql();
}

async function ensureColumn(sql: postgres.Sql, table: string, column: string, ddl: string) {
  await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`);
}

async function migrate(): Promise<void> {
  const sql = getSql();
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id                    BIGSERIAL PRIMARY KEY,
      email                 TEXT UNIQUE NOT NULL,
      name                  TEXT,
      picture               TEXT,
      google_access_token   TEXT,
      google_refresh_token  TEXT,
      google_token_expiry   BIGINT,
      bing_api_key          TEXT,
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
      longtail_min_words  INTEGER DEFAULT 4,
      ai_pos_op           TEXT DEFAULT '=',
      ai_pos_value        DOUBLE PRECISION DEFAULT 1.0,
      ai_impr_max         INTEGER DEFAULT 10,
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
  `);

  // Additive safety net for columns added after a table's first release.
  await ensureColumn(sql, "url_inspections", "in_sitemap", "INTEGER DEFAULT 0");
}
