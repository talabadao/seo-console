// Rehearses the Production migration steps (PRODUCTION-PILOT.md R3) on a throwaway local Postgres shaped like
// Production today: the v1 schema created by the app's old startup check, v1-style data (a legacy project SerpApi
// key, old weekly KPI targets), and no schema_migrations table. Then runs the real runner exactly as the release
// will: status → baseline → apply → status, re-runs apply (must be a no-op), and re-runs the v1 startup statements
// against the migrated database (what a rollback to the v1 deployment does on boot).
//
//   cd scripts/capacity && npm install      # once
//   npx tsx scripts/capacity/migrateRehearsal.ts   # from the repository root

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { BASELINE_STATEMENTS } from "../../lib/schema";

const PORT = 54331;
const dataDir = mkdtempSync(join(tmpdir(), "seo-migrate-"));
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "rehearse", password: "rehearse", port: PORT, persistent: false, onLog: () => {}, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
const URL = `postgres://rehearse:rehearse@127.0.0.1:${PORT}/prodlike?sslmode=disable`;

function runner(...args: string[]): string {
  try {
    return execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.mts", ...args], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MIGRATE_DATABASE_URL: URL }, encoding: "utf8" });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return `EXIT ${err.status}\n${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

async function main() {
  await server.initialise();
  await server.start();
  await server.createDatabase("prodlike");
  const sql = postgres(URL, { max: 1, onnotice: () => {} });

  // 1. Production today: v1 schema (lib/db.ts startup statements at 05f0c1d) and v1 data.
  for (const s of BASELINE_STATEMENTS) await sql.unsafe(s);
  await sql.unsafe(`
    INSERT INTO users (email, created_at, updated_at) VALUES ('tinledoihoa@gmail.com', 1, 1), ('tin@artemisdigital.com', 1, 1);
    INSERT INTO ga_properties (user_id, property_id, display_name, time_zone, created_at) VALUES (1, '111', 'Shop', 'Asia/Ho_Chi_Minh', 1);
    INSERT INTO projects (user_id, name, website_url, ga_property_id, serpapi_key, created_at, updated_at) VALUES (1, 'Góc Săn Deal', 'https://gocsandeal.com/', '111', 'legacy-project-key', 1, 1);
    INSERT INTO weekly_kpi_config (user_id, property_id, year_month, traffic_organic_target, traffic_ai_target, lead_organic_target, lead_ai_target, lead_events, updated_at)
      VALUES (1, '111', '2026-10', 5000, 0, 40, 0, '[]', 1);`);
  const before = await sql`SELECT to_regclass('public.schema_migrations') AS t`;
  console.log("prod-like start: schema_migrations exists =", before[0].t != null);

  const target = runner().match(/[\w.-]+\/prodlike/)?.[0] ?? "127.0.0.1/prodlike";
  console.log("--- status (read-only) ---\n" + runner());
  console.log("--- baseline ---\n" + runner("--baseline", `--confirm=${target}`));
  console.log("--- apply ---\n" + runner("--apply", `--confirm=${target}`));
  console.log("--- status after ---\n" + runner());
  console.log("--- apply again (must change nothing) ---\n" + runner("--apply", `--confirm=${target}`));
  console.log("--- wrong confirm (must refuse) ---\n" + runner("--apply", "--confirm=prod.example/neondb"));

  const applied = await sql`SELECT id, mode FROM schema_migrations ORDER BY id`;
  console.log("applied:", applied.map((r) => `${r.id}:${r.mode}`).join(", "));
  // Data survived and the KPI backfill copied the old target; the legacy project key is untouched.
  console.log("project key kept:", (await sql`SELECT serpapi_key FROM projects WHERE id = 1`)[0].serpapi_key === "legacy-project-key");
  console.log("kpi backfill:", JSON.stringify(await sql`SELECT metric, period, target FROM kpi_targets ORDER BY metric`));

  // 2. Rollback to the v1 deployment: its startup re-runs the v1 statements against the migrated schema.
  for (const s of BASELINE_STATEMENTS) await sql.unsafe(s);
  console.log("v1 startup statements on migrated DB: ok; users =", (await sql`SELECT COUNT(*)::int AS n FROM users`)[0].n);
  await sql.end();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await server.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });
