// Operator script: disables (or re-enables) a person's access. This is the operator-controlled switch the workspace
// model keeps instead of a role-management interface — ordinary Users can't suspend one another. A disabled person
// can't sign in and their sessions stop on the next request; their projects, history and inbox are kept.
//
//   MIGRATE_DATABASE_URL=… npx tsx scripts/workspace/setUserStatus.mts person@artemisdigital.com disabled --confirm=<host/db>
//   MIGRATE_DATABASE_URL=… npx tsx scripts/workspace/setUserStatus.mts person@artemisdigital.com active --confirm=<host/db>
//
// The address is matched against verified login addresses. A disabled primary manager's projects keep the person
// as primary manager (paid schedules pause, lib/spending.ts) until a manager transfers it.
import postgres from "postgres";
import { describeTarget } from "../../lib/migrations";

const [email, status] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const confirm = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
const url = process.env.MIGRATE_DATABASE_URL;
if (!url || !email || !["active", "disabled"].includes(status ?? "")) {
  console.error("Usage: MIGRATE_DATABASE_URL=… setUserStatus.mts <login address> active|disabled --confirm=<host/db>");
  process.exit(1);
}
const target = describeTarget(url);
if (confirm !== target) {
  console.error(`Refusing: pass --confirm=${target}`);
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {}, ...(/sslmode=/.test(url) ? {} : { ssl: "require" as const }) });
try {
  await sql.begin(async (tx) => {
    const rows = await tx`SELECT DISTINCT u.id, u.status FROM user_identities i JOIN users u ON u.id = i.user_id
                           WHERE lower(i.email) = ${email.trim().toLowerCase()} AND u.kind = 'person' AND u.status IN ('active', 'disabled')`;
    if (rows.length !== 1) throw new Error(`No single person signs in as ${email}.`);
    const id = Number(rows[0].id);
    await tx`UPDATE users SET status = ${status}, updated_at = ${Date.now()} WHERE id = ${id}`;
    await tx`INSERT INTO identity_audit (user_id, event, email, detail, created_at) VALUES (${id}, ${`operator-${status}`}, ${email.toLowerCase()}, ${tx.json({ from: String(rows[0].status) })}, ${Date.now()})`;
    console.log(`${email}: ${rows[0].status} → ${status}`);
  });
} finally {
  await sql.end();
}
