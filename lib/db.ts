import postgres from "postgres";
import { BASELINE_STATEMENTS } from "./schema";
import { databaseUrlFor, deploymentOf } from "./environment";
import { MIGRATIONS } from "@/db/migrations";
import { MIGRATIONS_TABLE, checksumOf, planMigrations } from "./migrations";

/**
 * Postgres-backed replacement for the old node:sqlite connection. Kept the same
 * db.prepare(sql).get/.all/.run(...args) shape as before so every call site in
 * the app is unchanged — only `?` placeholders (SQLite style) are used, and are
 * translated to Postgres's `$1, $2, ...` here. Every method is now async, so
 * call sites use `await db.prepare(...).get(...)` etc.
 */

// Preview deployments use only PREVIEW_DATABASE_URL; see lib/environment.ts.
function connectionString(): string {
  return databaseUrlFor();
}

const globalForDb = globalThis as unknown as { __seoSql?: postgres.Sql };

function open(): postgres.Sql {
  const url = connectionString();
  const options: postgres.Options<Record<string, postgres.PostgresType>> = {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // SQLite silently bound a JS `undefined` parameter as NULL; postgres.js
    // throws UNDEFINED_VALUE instead. Every call site here was written under
    // the old SQLite assumption, so restore that behavior globally rather
    // than auditing every `?? null` by hand.
    transform: { undefined: null },
    // Postgres NOTICEs ("relation ... already exists, skipping") are informational; keep them out of the logs.
    onnotice: () => {},
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
// A failed initialization (e.g. the database was briefly unreachable) isn't cached: the next query retries it
// instead of every query in this instance failing until it's recycled.
let migrated: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!migrated) {
    migrated = migrate().catch((e) => {
      migrated = null;
      throw e;
    });
  }
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

/** A query function inside a transaction: same `?` placeholders as db.prepare, returns the rows. */
export type TxQuery = (sqlText: string, ...args: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * Runs `fn` in one database transaction: every statement commits together, or — if `fn` throws — none do.
 * Used where a partial write would be misleading (e.g. saving many months of KPI targets at once).
 */
export async function withTransaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T> {
  await ready();
  return (await getSql().begin(async (tx) => {
    const q: TxQuery = async (sqlText, ...args) =>
      (await tx.unsafe(toPositional(sqlText), args as postgres.ParameterOrJSON<never>[])) as unknown as Record<string, unknown>[];
    return fn(q);
  })) as T;
}

/**
 * The underlying postgres.js tagged-template client, for call sites that need
 * multi-row inserts (`sql(array, ...cols)`) or other features the `?`-based
 * `db.prepare()` shim doesn't cover.
 */
export async function rawSql(): Promise<postgres.Sql> {
  await ready();
  return getSql();
}

// Schema statements live in lib/schema.ts, shared with the versioned migration
// runner (scripts/migrate.mts). A database whose schema_migrations already records
// 0001_baseline (Production since 17 Oct 2026; Preview and local once they have
// started once) is managed by the runner, so a new server instance only checks
// that one row instead of re-running the ~43 idempotent baseline statements
// (each a round trip on every cold start, and a NOTICE line in the logs).
// A database that has never been baselined still gets them, as before.
//
// Versioned migrations after the baseline (0002+) are applied automatically
// only on Preview and in local development — databases that are isolated and
// disposable. Production never migrates itself: an owner runs
// `npm run migrate -- --apply` against it, and until then features that need
// the newer tables report themselves unavailable (see tableExists).
async function migrate(): Promise<void> {
  const sql = getSql();
  const production = deploymentOf() === "production";
  if (await baselined(sql)) {
    // Managed by the runner: Production only reports what's missing (it never migrates itself); Preview and
    // development apply pending versioned migrations, if any, one instance at a time.
    if (production) await reportPending(sql);
    else if (await hasPending(sql)) await withInitLock(sql, (conn) => applyVersioned(conn));
    return;
  }
  // Never baselined (a fresh Preview or local database, or Production before the runner): run the idempotent
  // baseline — and on Preview/development the versioned migrations — under one lock, so instances starting together
  // don't race on the same DDL or migration rows.
  await withInitLock(sql, async (conn) => {
    if (!(await baselined(conn))) for (const statement of BASELINE_STATEMENTS) await conn.unsafe(statement);
    if (!production) await applyVersioned(conn);
  });
}

/** Arbitrary, fixed advisory-lock key for schema initialization. */
const INIT_LOCK = 7316254001;

/** Runs `fn` holding a session advisory lock on one reserved connection, released however `fn` ends. */
async function withInitLock(sql: postgres.Sql, fn: (conn: postgres.Sql) => Promise<void>): Promise<void> {
  const conn = await sql.reserve();
  try {
    await conn`SELECT pg_advisory_lock(${INIT_LOCK})`;
    try {
      await fn(conn);
    } finally {
      await conn`SELECT pg_advisory_unlock(${INIT_LOCK})`;
    }
  } finally {
    conn.release();
  }
}

async function appliedIds(sql: postgres.Sql): Promise<{ id: string; checksum: string }[]> {
  return (await sql`SELECT id, checksum FROM schema_migrations ORDER BY id`) as unknown as { id: string; checksum: string }[];
}

async function hasPending(sql: postgres.Sql): Promise<boolean> {
  return planMigrations(MIGRATIONS, await appliedIds(sql)).pending.length > 0;
}

/**
 * Production never migrates itself; a deployment whose code expects migrations the database doesn't have says so
 * in the logs once per instance (the affected features also report themselves unavailable via tableExists).
 */
async function reportPending(sql: postgres.Sql): Promise<void> {
  const plan = planMigrations(MIGRATIONS, await appliedIds(sql));
  if (plan.pending.length || plan.changed.length || plan.unknown.length) {
    console.error(
      `Database migrations need attention: pending ${plan.pending.map((m) => m.id).join(", ") || "none"}; ` +
        `changed ${plan.changed.join(", ") || "none"}; unknown ${plan.unknown.join(", ") || "none"}. ` +
        "Run the migration runner (npm run migrate) against this database.",
    );
  }
}

/** Whether this database's schema is managed by the versioned runner (0001_baseline recorded). */
async function baselined(sql: postgres.Sql): Promise<boolean> {
  const [t] = await sql`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`;
  if (!t?.present) return false;
  const rows = await sql`SELECT 1 FROM schema_migrations WHERE id = ${MIGRATIONS[0].id}`;
  return rows.length > 0;
}

async function applyVersioned(sql: postgres.Sql): Promise<void> {
  const [t] = await sql`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`;
  if (!t?.present) await sql.unsafe(MIGRATIONS_TABLE);
  let applied = await appliedIds(sql);
  if (!applied.length) {
    // The baseline statements above have just run, so record 0001 as baselined.
    const baseline = MIGRATIONS[0];
    await sql`INSERT INTO schema_migrations (id, checksum, applied_at, mode)
              VALUES (${baseline.id}, ${checksumOf(baseline)}, ${Date.now()}, 'baseline') ON CONFLICT (id) DO NOTHING`;
    applied = [{ id: baseline.id, checksum: checksumOf(baseline) }];
  }
  const plan = planMigrations(MIGRATIONS, applied);
  if (plan.changed.length || plan.unknown.length) {
    console.error("Migration history disagrees with the code; not applying versioned migrations.", plan.changed, plan.unknown);
    return;
  }
  // Each migration in its own transaction. Explicit BEGIN/COMMIT: `sql` is a reserved single connection here
  // (see withInitLock), which postgres.js doesn't give a begin() helper.
  for (const m of plan.pending) {
    await sql.unsafe("BEGIN");
    try {
      for (const statement of m.statements) await sql.unsafe(statement);
      await sql`INSERT INTO schema_migrations (id, checksum, applied_at, mode) VALUES (${m.id}, ${checksumOf(m)}, ${Date.now()}, 'auto')`;
      await sql.unsafe("COMMIT");
    } catch (e) {
      await sql.unsafe("ROLLBACK").catch(() => {});
      throw e;
    }
  }
}

const tableCache = new Map<string, Promise<boolean>>();
/** Whether a table exists (cached per process). Production may not have run newer migrations yet. */
export function tableExists(name: string): Promise<boolean> {
  let hit = tableCache.get(name);
  if (!hit) {
    hit = (async () => {
      await ready();
      const [row] = await getSql()`SELECT to_regclass(${"public." + name}) IS NOT NULL AS ok`;
      return Boolean(row?.ok);
    })();
    tableCache.set(name, hit);
  }
  return hit;
}
