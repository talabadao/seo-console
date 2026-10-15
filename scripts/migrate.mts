/**
 * Versioned schema migrations.
 *
 *   MIGRATE_DATABASE_URL=… npm run migrate                      # status only (read-only)
 *   MIGRATE_DATABASE_URL=… npm run migrate -- --baseline --confirm=<host/db>
 *   MIGRATE_DATABASE_URL=… npm run migrate -- --apply    --confirm=<host/db>
 *
 * Reads only MIGRATE_DATABASE_URL, never DATABASE_URL or .env files, so it
 * can't touch a database by accident. Write modes also require --confirm with
 * the target's host and database name, which the status run prints.
 *
 * --baseline  records 0001_baseline as applied without running it (for a
 *             database that already has the schema, e.g. production).
 * --apply     runs every pending migration, each in its own transaction,
 *             and records it.
 *
 * See db/migrations/README.md. Until the rollout milestone, run write modes
 * only against the isolated Preview or a local database.
 */
import postgres from "postgres";
import { MIGRATIONS } from "../db/migrations/index.ts";
import { MIGRATIONS_TABLE, checksumOf, describeTarget, planMigrations } from "../lib/migrations.ts";

const args = process.argv.slice(2);
const mode = args.includes("--apply") ? "apply" : args.includes("--baseline") ? "baseline" : "status";
const confirm = args.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  console.error("Set MIGRATE_DATABASE_URL to the database to migrate (this script ignores DATABASE_URL).");
  process.exit(1);
}
const target = describeTarget(url);
if (mode !== "status" && confirm !== target) {
  console.error(`Refusing to ${mode}: pass --confirm=${target} to confirm the target database.`);
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  onnotice: () => {},
  ...(/sslmode=/.test(url) ? {} : { ssl: "require" as const }),
});

try {
  const hasTable = (await sql`SELECT to_regclass('public.schema_migrations') AS t`)[0].t !== null;
  const applied = hasTable
    ? ((await sql`SELECT id, checksum FROM schema_migrations ORDER BY id`) as unknown as { id: string; checksum: string }[])
    : [];
  const plan = planMigrations(MIGRATIONS, applied);

  console.log(`Target: ${target}`);
  console.log(`Migrations table: ${hasTable ? "present" : "not created yet"}`);
  console.log(`Applied: ${applied.map((a) => a.id).join(", ") || "none"}`);
  console.log(`Pending: ${plan.pending.map((m) => m.id).join(", ") || "none"}`);
  if (plan.changed.length || plan.unknown.length) {
    console.error(`Edited after being applied: ${plan.changed.join(", ") || "none"}`);
    console.error(`Applied but unknown to this code: ${plan.unknown.join(", ") || "none"}`);
    console.error("Code and database disagree about history; nothing will be changed.");
    process.exitCode = 1;
  } else if (mode === "baseline") {
    const baseline = MIGRATIONS[0];
    if (applied.length) {
      console.log("Already has migration history; --baseline does nothing.");
    } else {
      await sql.unsafe(MIGRATIONS_TABLE);
      await sql`INSERT INTO schema_migrations (id, checksum, applied_at, mode)
                VALUES (${baseline.id}, ${checksumOf(baseline)}, ${Date.now()}, 'baseline')`;
      console.log(`Recorded ${baseline.id} as applied (statements not run).`);
    }
  } else if (mode === "apply") {
    await sql.unsafe(MIGRATIONS_TABLE);
    for (const m of plan.pending) {
      await sql.begin(async (tx) => {
        for (const statement of m.statements) await tx.unsafe(statement);
        await tx`INSERT INTO schema_migrations (id, checksum, applied_at, mode)
                 VALUES (${m.id}, ${checksumOf(m)}, ${Date.now()}, 'apply')`;
      });
      console.log(`Applied ${m.id}: ${m.description}`);
    }
    if (!plan.pending.length) console.log("Nothing to apply.");
  }
} finally {
  await sql.end();
}
