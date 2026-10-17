// Verifies lib/db.ts initialization against a real Postgres server, with several server instances (Node
// processes) starting at the same moment. An event trigger records every DDL statement each phase executes.
//   1. Fresh database, development: 8 concurrent instances → all succeed; baseline + migrations applied once each.
//   2. Baselined database, development and production: 8 concurrent instances each → zero DDL statements.
//   3. Existing data and an encrypted credential saved before the restart stay readable.
//   4. Production with a migration missing → still serves, and logs which migration is pending (not silent).
//   5. Preview/development with a new migration → concurrent instances apply it exactly once.
//
//   cd scripts/capacity && npm install    # once
//   npx tsx scripts/capacity/startupCheck.ts   # from the repository root

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { BASELINE_STATEMENTS } from "../../lib/schema";
import { MIGRATIONS } from "../../db/migrations";

const PORT = 54335;
const dir = mkdtempSync(join(tmpdir(), "seo-startup-"));
const server = new EmbeddedPostgres({ databaseDir: dir, user: "s", password: "s", port: PORT, persistent: false, onLog: () => {}, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
const URL = `postgres://s:s@127.0.0.1:${PORT}/app?sslmode=disable`;
const KEY = Buffer.alloc(32, 9).toString("base64");

function instance(mode: string, env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res) => {
    const p = spawn(process.execPath, ["--import", "tsx", "scripts/capacity/startupWorker.ts", mode], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: URL, CREDENTIALS_ENCRYPTION_KEY: KEY, ...env },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => res({ code: code ?? 1, out: out.trim(), err: err.trim() }));
  });
}

const results: Array<[string, boolean, string]> = [];
const check = (name: string, pass: boolean, detail: string) => results.push([name, pass, detail]);

async function main() {
  await server.initialise();
  await server.start();
  await server.createDatabase("app");
  const sql = postgres(URL, { max: 1, onnotice: () => {} });
  await sql.unsafe(`
    CREATE TABLE ddl_log (id bigserial PRIMARY KEY, tag text, at timestamptz DEFAULT now());
    CREATE FUNCTION log_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO ddl_log(tag) VALUES (tg_tag); END $$;
    CREATE EVENT TRIGGER log_ddl ON ddl_command_start EXECUTE FUNCTION log_ddl();`);
  const ddl = async () => Number((await sql`SELECT COUNT(*)::int AS n FROM ddl_log`)[0].n);

  // 1. Fresh database, 8 instances at once (development: baseline + versioned migrations).
  let before = await ddl();
  const fresh = await Promise.all(Array.from({ length: 8 }, () => instance("count")));
  const migrated = await sql`SELECT id, mode, COUNT(*) OVER (PARTITION BY id) AS n FROM schema_migrations ORDER BY id`;
  check("fresh: 8 concurrent instances start", fresh.every((r) => r.code === 0), fresh.map((r) => (r.code === 0 ? "ok" : r.out || r.err)).join(" | ").slice(0, 300));
  check(
    "fresh: every migration recorded exactly once",
    migrated.length === MIGRATIONS.length && migrated.every((r) => Number(r.n) === 1),
    migrated.map((r) => `${r.id}:${r.mode}`).join(", "),
  );
  check("fresh: DDL executed (baseline + migrations, once)", true, `${(await ddl()) - before} DDL statements; baseline alone is ${BASELINE_STATEMENTS.length}`);

  // 3a. Data written before the restart: a user and an encrypted credential.
  await sql`INSERT INTO users (email, created_at, updated_at) VALUES ('tinledoihoa@gmail.com', 0, 0)`;
  const saved = await instance("save-credential");
  check("credential saved (encrypted) before restart", saved.code === 0 && saved.out.includes('"credentialReadable":true'), saved.out);

  // 2. Baselined database: development and production, 8 instances each, at once.
  for (const env of [{}, { VERCEL_ENV: "production" }] as const) {
    before = await ddl();
    const runs = await Promise.all(Array.from({ length: 8 }, () => instance("read", env)));
    const label = "VERCEL_ENV" in env ? "production" : "development";
    check(`baselined ${label}: 8 concurrent instances start`, runs.every((r) => r.code === 0), runs.map((r) => (r.code === 0 ? "ok" : r.out || r.err)).join(" | ").slice(0, 300));
    check(`baselined ${label}: zero DDL on startup`, (await ddl()) - before === 0, `${(await ddl()) - before} DDL statements (before this change: all ${BASELINE_STATEMENTS.length} baseline batches per instance)`);
    check(`baselined ${label}: data and encrypted credential readable`, runs.every((r) => r.out.includes('"users":1') && r.out.includes('"credentialReadable":true')), runs[0].out);
  }

  // 4. Production with a migration missing: still serves, and logs it.
  const last = MIGRATIONS[MIGRATIONS.length - 1].id;
  const row = (await sql`SELECT id, checksum, applied_at, mode FROM schema_migrations WHERE id = ${last}`)[0];
  if (!row) throw new Error(`${last} is not recorded; can't run phase 4`);
  await sql`DELETE FROM schema_migrations WHERE id = ${last}`;
  before = await ddl();
  const pending = await instance("read", { VERCEL_ENV: "production" });
  check("production with a pending migration: serves", pending.code === 0, pending.out);
  check("production with a pending migration: logged, not silent", pending.err.includes(`pending ${last}`), pending.err.split("\n")[0].slice(0, 200));
  check("production never self-migrates", (await ddl()) - before === 0 && (await sql`SELECT 1 FROM schema_migrations WHERE id = ${last}`).length === 0, "no DDL, row still missing");
  // 5. Baselined Preview/development database with a newly added migration: concurrent instances apply it once.
  await sql.unsafe("DROP TABLE page_meta");
  const dev = await Promise.all(Array.from({ length: 8 }, () => instance("read")));
  const recorded = await sql`SELECT COUNT(*)::int AS n FROM schema_migrations WHERE id = ${last}`;
  const table = await sql`SELECT to_regclass('public.page_meta') IS NOT NULL AS present`;
  check("preview/dev with a new migration: 8 concurrent instances start", dev.every((r) => r.code === 0), dev.map((r) => (r.code === 0 ? "ok" : r.out || r.err)).join(" | ").slice(0, 300));
  check("preview/dev with a new migration: applied exactly once", Number(recorded[0].n) === 1 && table[0].present, `${last} rows ${recorded[0].n}, table present ${table[0].present}`);

  await sql.end();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const [name, pass, detail] of results) console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${detail}`);
    if (!results.every(([, p]) => p)) process.exitCode = 1;
    await server.stop().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  });
