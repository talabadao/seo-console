// Operator script: gives projects a verified HUMAN primary manager (and optional extra managers) from an explicit
// mapping the owner confirmed — e.g. the projects migrated from the shared analytics accounts, which have none.
// Never guesses: every person must already have signed in with a verified login (a user_identities row), and a
// project that already has a primary manager is left as it is unless --replace-primary is given.
//
//   MIGRATE_DATABASE_URL=… npx tsx scripts/workspace/assignManagers.mts mapping.json                 # dry run
//   MIGRATE_DATABASE_URL=… npx tsx scripts/workspace/assignManagers.mts mapping.json --apply --confirm=<host/db>
//
// mapping.json: [{ "projectId": 12, "primary": "person@artemisdigital.com", "managers": ["other@headsonpillows.com"] }]
// Addresses are matched against verified login addresses (exactly, case-insensitive). Prints project names,
// addresses and decisions only.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { describeTarget } from "../../lib/migrations";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const replacePrimary = args.includes("--replace-primary");
const confirm = args.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
const url = process.env.MIGRATE_DATABASE_URL;
if (!url || !file) {
  console.error("Usage: MIGRATE_DATABASE_URL=… assignManagers.mts <mapping.json> [--apply --confirm=<host/db>] [--replace-primary]");
  process.exit(1);
}
const target = describeTarget(url);
if (apply && confirm !== target) {
  console.error(`Refusing to apply: pass --confirm=${target}`);
  process.exit(1);
}
const mapping = JSON.parse(readFileSync(file, "utf8")) as Array<{ projectId: number; primary: string; managers?: string[] }>;
const sql = postgres(url, { max: 1, onnotice: () => {}, ...(/sslmode=/.test(url) ? {} : { ssl: "require" as const }) });

async function personByEmail(tx: postgres.TransactionSql, email: string): Promise<{ id: number; workspace_id: number } | null> {
  const rows = await tx`SELECT u.id, u.workspace_id FROM user_identities i JOIN users u ON u.id = i.user_id
                         WHERE lower(i.email) = ${email.trim().toLowerCase()} AND u.kind = 'person' AND u.status = 'active' AND u.workspace_id IS NOT NULL`;
  return rows.length === 1 ? { id: Number(rows[0].id), workspace_id: Number(rows[0].workspace_id) } : null;
}

let problems = 0;
try {
  console.log(`${apply ? "APPLY" : "DRY RUN"} on ${target}: ${mapping.length} project(s)`);
  for (const m of mapping) {
    await sql.begin(async (tx) => {
      const [p] = await tx`SELECT id, name, workspace_id, primary_manager_id, deleted_at FROM projects WHERE id = ${m.projectId} FOR UPDATE`;
      if (!p || p.deleted_at != null || p.workspace_id == null) {
        problems++;
        console.log(`  #${m.projectId}: not a live workspace project — skipped`);
        return;
      }
      const primary = await personByEmail(tx, m.primary);
      if (!primary || primary.workspace_id !== Number(p.workspace_id)) {
        problems++;
        console.log(`  #${p.id} ${p.name}: ${m.primary} hasn't signed in with a verified login yet (or isn't in this workspace) — skipped`);
        return;
      }
      const extra: number[] = [];
      for (const e of m.managers ?? []) {
        const u = await personByEmail(tx, e);
        if (!u || u.workspace_id !== Number(p.workspace_id)) {
          problems++;
          console.log(`  #${p.id} ${p.name}: manager ${e} hasn't signed in yet — not added`);
        } else extra.push(u.id);
      }
      const keepPrimary = p.primary_manager_id != null && !replacePrimary;
      console.log(
        `  #${p.id} ${p.name}: ${keepPrimary ? `keeps its primary manager; adds ${m.primary} as a manager` : `primary manager → ${m.primary}`}${extra.length ? ` (+${extra.length} manager${extra.length === 1 ? "" : "s"})` : ""}`,
      );
      if (!apply) return;
      const now = Date.now();
      for (const id of [primary.id, ...extra]) {
        await tx`INSERT INTO project_members (project_id, user_id, added_by, added_at) VALUES (${p.id}, ${id}, NULL, ${now}) ON CONFLICT DO NOTHING`;
      }
      if (!keepPrimary) {
        await tx`UPDATE projects SET primary_manager_id = ${primary.id}, spending_version = spending_version + 1 WHERE id = ${p.id}`;
      }
      await tx`INSERT INTO identity_audit (user_id, event, detail, created_at)
               VALUES (${primary.id}, 'operator-assign-manager', ${tx.json({ projectId: Number(p.id), primary: !keepPrimary, extra })}, ${now})`;
    });
  }
  console.log(problems ? `${problems} problem(s): fix the mapping or wait until those people have signed in, then run again.` : "No problems.");
  if (!apply) console.log("Nothing was changed (dry run).");
} finally {
  await sql.end();
}
