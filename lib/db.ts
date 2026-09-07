import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const globalForDb = globalThis as unknown as { __seoDb_v2?: DatabaseSync };

function open(): DatabaseSync {
  const c = new DatabaseSync(join(DATA_DIR, "app.db"));
  c.exec("PRAGMA journal_mode = WAL");
  c.exec("PRAGMA busy_timeout = 8000");
  c.exec("PRAGMA foreign_keys = ON");
  return c;
}

// Migrations run once per underlying connection. Tracking it here (not in `open`)
// means a hot-reloaded module still migrates the connection it inherited from the
// previous evaluation, picking up any newly added columns.
const migrated = new WeakSet<DatabaseSync>();

let conn: DatabaseSync | null = null;
function getConn(): DatabaseSync {
  if (!conn) {
    conn = globalForDb.__seoDb_v2 ?? open();
    if (process.env.NODE_ENV !== "production") globalForDb.__seoDb_v2 = conn;
  }
  if (!migrated.has(conn)) {
    migrate(conn);
    migrated.add(conn);
  }
  return conn;
}

/**
 * Lazily opens the connection on first use. Importing this module (which happens
 * during `next build` page-data collection) must not open the file, or it fights
 * the running dev server for the write lock.
 */
export const db: DatabaseSync = new Proxy({} as DatabaseSync, {
  get(_t, prop) {
    const real = getConn() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

function ensureColumn(conn: DatabaseSync, table: string, column: string, ddl: string) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function migrate(conn: DatabaseSync) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      email               TEXT UNIQUE NOT NULL,
      name                TEXT,
      picture             TEXT,
      google_access_token TEXT,
      google_refresh_token TEXT,
      google_token_expiry INTEGER,
      bing_api_key        TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source           TEXT NOT NULL,
      property         TEXT NOT NULL,
      permission_level TEXT,
      created_at       INTEGER NOT NULL,
      UNIQUE(user_id, source, property)
    );

    CREATE TABLE IF NOT EXISTS perf_rows (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      data_date   TEXT NOT NULL,
      dimension   TEXT NOT NULL,
      key         TEXT NOT NULL DEFAULT '',
      clicks      REAL NOT NULL DEFAULT 0,
      impressions REAL NOT NULL DEFAULT 0,
      ctr         REAL NOT NULL DEFAULT 0,
      position    REAL NOT NULL DEFAULT 0,
      UNIQUE(site_id, data_date, dimension, key)
    );
    CREATE INDEX IF NOT EXISTS idx_perf_lookup ON perf_rows(site_id, dimension, data_date);
    CREATE INDEX IF NOT EXISTS idx_perf_key ON perf_rows(site_id, dimension, key);

    CREATE TABLE IF NOT EXISTS sync_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id      INTEGER NOT NULL,
      source       TEXT NOT NULL,
      started_at   INTEGER NOT NULL,
      finished_at  INTEGER,
      status       TEXT NOT NULL,
      message      TEXT,
      rows_written INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS url_inspections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      url             TEXT NOT NULL,
      inspected_at    INTEGER NOT NULL,
      verdict         TEXT,
      coverage_state  TEXT,
      robots_txt_state TEXT,
      indexing_state  TEXT,
      page_fetch_state TEXT,
      last_crawl_time TEXT,
      google_canonical TEXT,
      user_canonical  TEXT,
      crawled_as      TEXT,
      raw_json        TEXT,
      UNIQUE(site_id, url)
    );

    CREATE TABLE IF NOT EXISTS sitemap_urls (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      url        TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'sitemap',   -- 'sitemap' | 'manual' | 'robots'
      first_seen INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      UNIQUE(site_id, url)
    );
    CREATE INDEX IF NOT EXISTS idx_sitemap_site ON sitemap_urls(site_id);

    CREATE TABLE IF NOT EXISTS index_snapshots (
      site_id      INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      snap_date    TEXT NOT NULL,
      indexed      INTEGER NOT NULL DEFAULT 0,
      not_indexed  INTEGER NOT NULL DEFAULT 0,
      total_known  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, snap_date)
    );

    CREATE TABLE IF NOT EXISTS quota_usage (
      site_id     INTEGER NOT NULL,
      usage_date  TEXT NOT NULL,
      inspections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, usage_date)
    );

    CREATE TABLE IF NOT EXISTS index_jobs (
      site_id     INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      started_at  INTEGER,
      finished_at INTEGER,
      status      TEXT,
      message     TEXT,
      checked     INTEGER DEFAULT 0
    );
  `);

  // Additive migrations for databases created by an earlier version.
  ensureColumn(conn, "sites", "brand_terms", "TEXT");
  ensureColumn(conn, "sites", "longtail_min_words", "INTEGER DEFAULT 4");
  ensureColumn(conn, "sites", "ai_pos_op", "TEXT DEFAULT '='");
  ensureColumn(conn, "sites", "ai_pos_value", "REAL DEFAULT 1.0");
  ensureColumn(conn, "sites", "ai_impr_max", "INTEGER DEFAULT 10");
  ensureColumn(conn, "url_inspections", "rich_results", "TEXT");
  ensureColumn(conn, "url_inspections", "in_sitemap", "INTEGER DEFAULT 0");
  ensureColumn(conn, "url_inspections", "submitted_at", "INTEGER");
  ensureColumn(conn, "url_inspections", "submit_result", "TEXT");
}
