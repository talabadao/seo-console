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

// Schema statements live in lib/schema.ts, shared with the versioned migration
// runner (scripts/migrate.mts). Until production is switched over to that
// runner, every new server instance still applies the idempotent baseline here.
//
// Versioned migrations after the baseline (0002+) are applied automatically
// only on Preview and in local development — databases that are isolated and
// disposable. Production never migrates itself: an owner runs
// `npm run migrate -- --apply` against it, and until then features that need
// the newer tables report themselves unavailable (see tableExists).
async function migrate(): Promise<void> {
  const sql = getSql();
  for (const statement of BASELINE_STATEMENTS) await sql.unsafe(statement);
  if (deploymentOf() !== "production") await applyVersioned(sql);
}

async function applyVersioned(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(MIGRATIONS_TABLE);
  let applied = (await sql`SELECT id, checksum FROM schema_migrations ORDER BY id`) as unknown as { id: string; checksum: string }[];
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
  for (const m of plan.pending) {
    await sql.begin(async (tx) => {
      for (const statement of m.statements) await tx.unsafe(statement);
      await tx`INSERT INTO schema_migrations (id, checksum, applied_at, mode) VALUES (${m.id}, ${checksumOf(m)}, ${Date.now()}, 'auto')`;
    });
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
