// Full logical backup of a database's app schema (public) before a Production migration, from one consistent
// snapshot (REPEATABLE READ, READ ONLY): one JSON Lines file per table (row_to_json of every row, ordered by all
// columns, paged), sequence positions, and a manifest with columns, row counts and SHA-256 per table. Restore and
// prove it with scripts/capacity/workspaceRehearsal.ts (restoreBackup re-exports every table and compares).
//
//   npx tsx --env-file=<owner-only file with MIGRATE_DATABASE_URL> scripts/workspace/backup.mts <output directory>
//
// Reads only MIGRATE_DATABASE_URL. Prints table names and counts, never values. The output holds sensitive data
// (account records, encrypted keys): write it to an owner-only folder and delete it when no longer needed.
// (COPY streaming stalled over the Neon connection; plain paged queries are used instead.)
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const PAGE = 2000;
const url = process.env.MIGRATE_DATABASE_URL;
const dir = process.argv[2];
if (!url || !dir) {
  console.error("Usage: MIGRATE_DATABASE_URL=… backup.mts <output directory>");
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
const sql = postgres(url, { max: 1, onnotice: () => {}, ...(/sslmode=/.test(url) ? {} : { ssl: "require" as const }) });
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
try {
  const manifest = await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
    await tx`SET LOCAL TimeZone = 'UTC'`;
    const server = (await tx`SELECT current_setting('server_version') AS v`)[0].v as string;
    const migrations = await tx`SELECT id, checksum, applied_at FROM schema_migrations ORDER BY id`;
    const tables = (await tx`SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`).map(
      (r) => r.t as string,
    );
    const out: Array<{ table: string; columns: string[]; rows: number; sha256: string; file: string }> = [];
    for (const t of tables) {
      const columns = (await tx`SELECT attname FROM pg_attribute WHERE attrelid = ${`public.${q(t)}`}::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`).map(
        (r) => r.attname as string,
      );
      const file = `${t}.jsonl`;
      const fd = openSync(join(dir, file), "w");
      const hash = createHash("sha256");
      let rows = 0;
      const order = columns.map((_, i) => String(i + 1)).join(", ");
      for (let offset = 0; ; offset += PAGE) {
        const page = await tx.unsafe(`SELECT row_to_json(x)::text AS j FROM (SELECT ${columns.map(q).join(", ")} FROM public.${q(t)} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${offset}) x`);
        for (const r of page) {
          const line = `${r.j}\n`;
          writeSync(fd, line);
          hash.update(line);
          rows++;
        }
        if (page.length < PAGE) break;
      }
      closeSync(fd);
      const count = Number((await tx.unsafe(`SELECT COUNT(*)::bigint AS n FROM public.${q(t)}`))[0].n);
      if (count !== rows) throw new Error(`${t}: exported ${rows} rows but the table has ${count}`);
      console.log(`  ${t}: ${rows} rows`);
      out.push({ table: t, columns, rows, sha256: hash.digest("hex"), file });
    }
    const sequences = await tx`SELECT sequencename AS name, last_value FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1`;
    return { exportedAt: new Date().toISOString(), target: `${new URL(url).hostname}/${new URL(url).pathname.slice(1)}`, server, migrations, tables: out, sequences };
  });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`backup of ${manifest.target}: ${manifest.tables.length} tables, ${manifest.tables.reduce((n, t) => n + t.rows, 0)} rows, migrations through ${manifest.migrations.at(-1)?.id}`);
} finally {
  await sql.end();
}
