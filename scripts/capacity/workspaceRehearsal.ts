// Rehearses migration 0014 (and anything else pending) on a throwaway local Postgres loaded from a real backup
// (scripts/workspace/backup.mts): restore and prove the backup identical, run the real migration runner (status →
// apply → apply again, which must change nothing), check the workspace invariants, confirm that every original row
// is still there, and write the old → new mapping report. Nothing here connects to Production.
//
//   cd scripts/capacity && npm install            # once
//   npx tsx scripts/capacity/workspaceRehearsal.ts <backup directory> [report.json]    # from the repository root
//
// The report lists people, shared connections, project mappings and the decisions a human must make (projects
// that need a primary manager, hidden projects, legacy project keys, possible duplicates). It contains team email
// addresses and project names, no secrets.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { readManifest, restoreBackup } from "./backupRestore";
import { mappingReport } from "../workspace/report";
import { MIGRATIONS } from "../../db/migrations";

const backupDir = process.argv[2];
const reportPath = process.argv[3];
if (!backupDir) {
  console.error("Usage: workspaceRehearsal.ts <backup directory> [report.json]");
  process.exit(1);
}
const PORT = 54341;
const dataDir = mkdtempSync(join(tmpdir(), "seo-ws-rehearsal-"));
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "rehearse", password: "rehearse", port: PORT, persistent: false, onLog: () => {}, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
const URL = `postgres://rehearse:rehearse@127.0.0.1:${PORT}/rehearsal?sslmode=disable`;

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
  await server.createDatabase("rehearsal");
  const sql = postgres(URL, { max: 1, onnotice: () => {} });
  try {
    const manifest = readManifest(backupDir);
    console.log(`backup of ${manifest.target} at ${manifest.exportedAt}, migrations through ${manifest.migrations.at(-1)?.id}`);
    const restored = await restoreBackup(sql, backupDir);
    console.log(`restore: ${restored.ok ? "every table identical to the backup" : "FAILED"}`);
    if (!restored.ok) {
      console.log(restored.lines.filter((l) => !l.endsWith("identical")).join("\n"));
      process.exitCode = 1;
      return;
    }
    const before = new Map<string, number>();
    for (const t of manifest.tables) before.set(t.table, t.rows);

    const target = runner().match(/[\w.-]+\/rehearsal/)?.[0] ?? "127.0.0.1/rehearsal";
    console.log("--- status ---\n" + runner().trim());
    const t0 = Date.now();
    console.log("--- apply ---\n" + runner("--apply", `--confirm=${target}`).trim());
    console.log(`apply took ${Date.now() - t0} ms`);
    console.log("--- apply again (must change nothing) ---\n" + runner("--apply", `--confirm=${target}`).trim());

    // The statements themselves are idempotent: run 0014 again directly (the runner skips applied migrations).
    const counts = async () =>
      JSON.stringify(
        await sql`SELECT (SELECT COUNT(*) FROM google_connections) AS c, (SELECT COUNT(*) FROM asana_connections) AS a, (SELECT COUNT(*) FROM project_members) AS m,
                         (SELECT COUNT(*) FROM brands) AS b, (SELECT COUNT(*) FROM workspaces) AS w, (SELECT COUNT(*) FILTER (WHERE primary_manager_id IS NOT NULL) FROM projects) AS pm`,
      );
    const first = await counts();
    const ws = MIGRATIONS.find((m) => m.id === "0014_workspace_members");
    if (ws) for (const s of ws.statements) await sql.unsafe(s);
    console.log(`0014 statements re-run directly: ${first === (await counts()) ? "no change" : "CHANGED"}`);

    // No original row lost.
    let lost = 0;
    for (const [table, rows] of before) {
      const now = Number((await sql.unsafe(`SELECT COUNT(*)::bigint AS n FROM public."${table}"`))[0].n);
      if (now < rows) {
        lost++;
        console.log(`  ${table}: ${rows} → ${now} ROWS LOST`);
      }
    }
    console.log(`original rows kept in every table: ${lost === 0 ? "yes" : `NO (${lost} tables)`}`);

    const report = await mappingReport(sql);
    console.log(`people: ${report.people.filter((p) => p.kind === "person").length} persons, ${report.people.filter((p) => p.kind !== "person").length} shared-connection accounts`);
    console.log(`google connections: ${report.connections.length}; asana connections: ${report.asanaConnections.length}`);
    console.log(`projects: ${report.projects.length} (${report.projects.filter((p) => p.workspace === 1).length} in the workspace, ${report.hidden.length} hidden for review)`);
    console.log(`need a human primary manager: ${report.needsManager.length}; legacy project SerpApi keys: ${report.legacyProjectKeys.length}; possible duplicates: ${report.possibleDuplicates.length}`);
    console.log(`invariant violations: ${report.invariantViolations.length ? report.invariantViolations.join("; ") : "none"}`);
    if (reportPath) {
      writeFileSync(reportPath, JSON.stringify(report, null, 1));
      console.log(`report written to ${reportPath}`);
    }
    if (report.invariantViolations.length || lost) process.exitCode = 1;
  } finally {
    await sql.end();
  }
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
