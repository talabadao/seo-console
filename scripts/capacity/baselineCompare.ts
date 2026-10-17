// Compares Production's public schema (read-only) with a fresh local database built from the baseline statements
// (lib/schema.ts = 0001_baseline), before recording 0001 as applied without running it. Reads MIGRATE_DATABASE_URL
// only; prints table/column names and types, never data or secrets.
//
//   npx tsx --env-file=<protected file> scripts/capacity/baselineCompare.ts

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { BASELINE_STATEMENTS } from "../../lib/schema";

type Col = { table_name: string; column_name: string; data_type: string };
const Q = `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`;

async function main() {
  const prod = postgres(process.env.MIGRATE_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const prodCols = (await prod.begin("READ ONLY", (tx) => tx.unsafe(Q))) as unknown as Col[];
  await prod.end();

  const dir = mkdtempSync(join(tmpdir(), "seo-baseline-"));
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "b", password: "b", port: 54333, persistent: false, onLog: () => {}, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
  await server.initialise();
  await server.start();
  await server.createDatabase("base");
  const local = postgres("postgres://b:b@127.0.0.1:54333/base?sslmode=disable", { max: 1, onnotice: () => {} });
  for (const s of BASELINE_STATEMENTS) await local.unsafe(s);
  const baseCols = (await local.unsafe(Q)) as unknown as Col[];
  await local.end();
  await server.stop();
  rmSync(dir, { recursive: true, force: true });

  const key = (c: Col) => `${c.table_name}.${c.column_name}`;
  const prodMap = new Map(prodCols.map((c) => [key(c), c.data_type]));
  const baseMap = new Map(baseCols.map((c) => [key(c), c.data_type]));
  const missing = [...baseMap.keys()].filter((k) => !prodMap.has(k));
  const typeDiff = [...baseMap.entries()].filter(([k, t]) => prodMap.has(k) && prodMap.get(k) !== t).map(([k, t]) => `${k}: baseline ${t}, production ${prodMap.get(k)}`);
  const extra = [...prodMap.keys()].filter((k) => !baseMap.has(k));
  console.log(`baseline columns: ${baseMap.size} in ${new Set(baseCols.map((c) => c.table_name)).size} tables`);
  console.log(`production columns: ${prodMap.size} in ${new Set(prodCols.map((c) => c.table_name)).size} tables`);
  console.log(`missing in production: ${missing.length ? missing.join(", ") : "none"}`);
  console.log(`type differences: ${typeDiff.length ? typeDiff.join("; ") : "none"}`);
  console.log(`only in production: ${extra.length ? extra.join(", ") : "none"}`);
  process.exitCode = missing.length || typeDiff.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, "<url>") : e);
  process.exitCode = 1;
});
