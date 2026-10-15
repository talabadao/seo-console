# Database migrations

## Where things are
- `lib/schema.ts` — the schema as it existed when versioned migrations were introduced (production commit `05f0c1d`): every `CREATE TABLE/INDEX IF NOT EXISTS`, every later `ADD COLUMN IF NOT EXISTS`, and one old data fix.
- `db/migrations/0001_baseline.ts` — migration `0001_baseline`, made of exactly those statements.
- `db/migrations/index.ts` — the ordered list of migrations. New migrations are appended here.
- `lib/migrations.ts` — planning logic (pending / edited / unknown), checksums, the `schema_migrations` table.
- `scripts/migrate.mts` — the command-line runner (`npm run migrate`).

## How the existing schema is baselined
Production already has every table and column in `0001_baseline`, created over time by the app's startup check in `lib/db.ts`. Re-running the baseline there would change nothing (every statement is idempotent), but the clean approach is to **record** it as applied without running it:

```bash
# 1. Status (read-only). Prints the target as host/database, e.g. ep-xyz.neon.tech/neondb
MIGRATE_DATABASE_URL=… npm run migrate

# 2. Record 0001_baseline as applied, without running its statements
MIGRATE_DATABASE_URL=… npm run migrate -- --baseline --confirm=ep-xyz.neon.tech/neondb
```

A new, empty database (for example the Preview database) is built with `--apply` instead, which runs `0001_baseline` and records it.

The `schema_migrations` table stores each migration's id, a SHA-256 checksum of its statements, when it was applied and whether it was `apply` or `baseline`. If an applied migration is later edited, or the database records a migration this code doesn't know, the runner refuses to change anything.

## Rules
1. Never edit or reorder a migration once it has been applied anywhere; add a new one.
2. Changes are additive: new tables, nullable or defaulted columns, new indexes. Removing or renaming anything happens only in a later "contract" release after a rollback window (see `docs/seo-console-v2/MIGRATION-PLAN.md`).
3. Each migration runs in its own transaction.
4. The runner reads only `MIGRATE_DATABASE_URL` (never `DATABASE_URL` or `.env` files), and write modes need `--confirm=<host/database>`.
5. **Until Preview isolation is verified, run write modes only against a local or Preview database.** Production is baselined in the rollout milestone, with a backup taken first.

## Transition
For now `lib/db.ts` still applies `BASELINE_STATEMENTS` when a server instance starts, exactly as before (the statements were moved, not changed). Once production is baselined, new schema changes ship as migrations `0002_…` onwards, and the startup step is replaced by the runner in the deploy process.
