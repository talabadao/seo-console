// Logical backup format used before Production migrations (docs/seo-console-v2/WORKSPACE-MEMBERS.md, rollout):
// <dir>/manifest.json + one <table>.jsonl per table in `public` (row_to_json of every row, ordered by all columns),
// written by scripts/workspace/backup.mts from one REPEATABLE READ snapshot. This module restores such a backup
// into a database whose schema the repository's migrations create, and re-exports it the same way so a restore
// can be proven byte-identical. Used by the rehearsal (workspaceRehearsal.ts); never connects anywhere by itself.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";
import { BASELINE_STATEMENTS } from "../../lib/schema";
import { MIGRATIONS_TABLE } from "../../lib/migrations";
import { MIGRATIONS } from "../../db/migrations";

export interface BackupManifest {
  exportedAt: string;
  target: string;
  server: string;
  migrations: Array<{ id: string; checksum: string; applied_at: number | string }>;
  tables: Array<{ table: string; columns: string[]; rows: number; sha256: string; file: string }>;
  sequences: Array<{ name: string; last_value: string | number | null }>;
}

export const PAGE = 2000;
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

export const readManifest = (dir: string): BackupManifest => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

/** SHA-256 and row count of a table exported exactly as the backup does (row_to_json, ordered by every column). */
export async function tableDigest(sql: postgres.Sql, table: string, columns: string[]): Promise<{ sha256: string; rows: number }> {
  const hash = createHash("sha256");
  let rows = 0;
  const order = columns.map((_, i) => String(i + 1)).join(", ");
  for (let offset = 0; ; offset += PAGE) {
    const page = await sql.unsafe(`SELECT row_to_json(x)::text AS j FROM (SELECT ${columns.map(q).join(", ")} FROM public.${q(table)} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${offset}) x`);
    for (const r of page) {
      hash.update(`${r.j}\n`);
      rows++;
    }
    if (page.length < PAGE) break;
  }
  return { sha256: hash.digest("hex"), rows };
}

/**
 * Creates the schema the backup was taken on (baseline + exactly the migrations it records, with their
 * schema_migrations rows from the backup) and loads every table. Returns per-table verification against the
 * manifest. The connection must be a superuser (foreign keys are not re-checked while loading).
 */
export async function restoreBackup(sql: postgres.Sql, dir: string): Promise<{ ok: boolean; lines: string[] }> {
  const manifest = readManifest(dir);
  const recorded = new Set(manifest.migrations.map((m) => m.id));
  for (const s of BASELINE_STATEMENTS) await sql.unsafe(s);
  await sql.unsafe(MIGRATIONS_TABLE);
  for (const m of MIGRATIONS.slice(1)) {
    if (!recorded.has(m.id)) continue;
    for (const s of m.statements) await sql.unsafe(s);
  }
  await sql.unsafe("SET session_replication_role = replica");
  const lines: string[] = [];
  let ok = true;
  for (const t of manifest.tables) {
    const cols = (await sql`SELECT attname FROM pg_attribute WHERE attrelid = to_regclass(${`public.${q(t.table)}`}) AND attnum > 0 AND NOT attisdropped ORDER BY attnum`).map(
      (r) => r.attname as string,
    );
    const missing = t.columns.filter((c) => !cols.includes(c));
    if (!cols.length || missing.length) {
      ok = false;
      lines.push(`${t.table}: cannot restore (${cols.length ? `missing columns ${missing.join(", ")}` : "table missing"})`);
      continue;
    }
    const data = readFileSync(join(dir, t.file), "utf8").split("\n").filter(Boolean);
    for (let i = 0; i < data.length; i += 500) {
      const batch = `[${data.slice(i, i + 500).join(",")}]`;
      await sql.unsafe(`INSERT INTO public.${q(t.table)} (${t.columns.map(q).join(", ")}) SELECT ${t.columns.map(q).join(", ")} FROM json_populate_recordset(NULL::public.${q(t.table)}, $1::text::json)`, [batch]);
    }
    const d = await tableDigest(sql, t.table, t.columns);
    const same = d.sha256 === t.sha256 && d.rows === t.rows;
    if (!same) ok = false;
    lines.push(`${t.table}: ${d.rows}/${t.rows} rows ${same ? "identical" : "DIFFERENT"}`);
  }
  for (const s of manifest.sequences) {
    if (s.last_value != null) await sql.unsafe(`SELECT setval('public.${q(s.name)}', ${Number(s.last_value)}, true)`);
  }
  await sql.unsafe("SET session_replication_role = DEFAULT");
  return { ok, lines };
}
