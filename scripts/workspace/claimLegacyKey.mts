// Operator script: the protected path for a legacy SerpApi key still stored in plain text on a project whose
// human owner is unclear (e.g. projects migrated from the shared analytics accounts). Once the owner confirms whose
// key it is, it becomes that person's own encrypted account credential and is removed from the project. In the team
// model such keys are never used for runs; this only lets the rightful person keep using it as their own.
//
//   MIGRATE_DATABASE_URL=… CREDENTIALS_ENCRYPTION_KEY=… npx tsx scripts/workspace/claimLegacyKey.mts <projectId> <person's login> [--apply --confirm=<host/db>] [--replace]
//
// Without --apply it only reports. If the person already has a different SerpApi key, nothing changes unless
// --replace is given (an explicit choice, never last-write-wins); the same key just clears the project copy.
// Never prints the key (only a fingerprint prefix).
import postgres from "postgres";
import { createHash } from "node:crypto";
import { describeTarget } from "../../lib/migrations";
import { encryptFor } from "../../lib/credentials/crypto";

const [projectArg, email] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
const replace = process.argv.includes("--replace");
const confirm = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
const url = process.env.MIGRATE_DATABASE_URL;
if (!url || !projectArg || !email) {
  console.error("Usage: claimLegacyKey.mts <projectId> <login address> [--apply --confirm=<host/db>] [--replace]");
  process.exit(1);
}
const target = describeTarget(url);
if (apply && confirm !== target) {
  console.error(`Refusing to apply: pass --confirm=${target}`);
  process.exit(1);
}
const fp = (k: string) => createHash("sha256").update(k).digest("hex").slice(0, 16);
const sql = postgres(url, { max: 1, onnotice: () => {}, ...(/sslmode=/.test(url) ? {} : { ssl: "require" as const }) });
try {
  await sql.begin(async (tx) => {
    const [p] = await tx`SELECT id, name, serpapi_key FROM projects WHERE id = ${Number(projectArg)} FOR UPDATE`;
    const key = (p?.serpapi_key as string | null)?.trim();
    if (!p || !key) throw new Error("That project has no legacy SerpApi key.");
    const people = await tx`SELECT DISTINCT u.id FROM user_identities i JOIN users u ON u.id = i.user_id
                             WHERE lower(i.email) = ${email.trim().toLowerCase()} AND u.kind = 'person' AND u.status = 'active'`;
    if (people.length !== 1) throw new Error(`${email} hasn't signed in with a verified login yet.`);
    const userId = Number(people[0].id);
    const [mine] = await tx`SELECT fingerprint FROM account_credentials WHERE user_id = ${userId} AND provider = 'serpapi'`;
    const same = mine && mine.fingerprint === fp(key);
    console.log(`#${p.id} ${p.name}: legacy key ${fp(key).slice(0, 6)}…; ${email} ${mine ? `has key ${String(mine.fingerprint).slice(0, 6)}…${same ? " (the same)" : " (different)"}` : "has no SerpApi key"}`);
    if (mine && !same && !replace) throw new Error("Different keys: rerun with --replace to make the legacy key this person's key, or remove the project copy in the app.");
    if (!apply) {
      console.log("Dry run: nothing changed.");
      return;
    }
    if (!same) {
      const enc = encryptFor(userId, "serpapi", JSON.stringify({ apiKey: key }));
      await tx`INSERT INTO account_credentials (user_id, provider, ciphertext, key_id, hint, fingerprint, updated_at)
               VALUES (${userId}, 'serpapi', ${enc.ciphertext}, ${enc.keyId}, ${key.slice(-4)}, ${fp(key)}, ${Date.now()})
               ON CONFLICT (user_id, provider) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, key_id = EXCLUDED.key_id, hint = EXCLUDED.hint,
                 fingerprint = EXCLUDED.fingerprint, updated_at = EXCLUDED.updated_at, verified_at = NULL, verify_status = NULL, verify_message = NULL`;
    }
    await tx`UPDATE projects SET serpapi_key = NULL, serpapi_key_updated_at = NULL WHERE id = ${p.id}`;
    await tx`INSERT INTO identity_audit (user_id, event, detail, created_at) VALUES (${userId}, 'operator-claim-legacy-key', ${tx.json({ projectId: Number(p.id), replaced: Boolean(mine && !same) })}, ${Date.now()})`;
    console.log("Applied: the key is now this person's own encrypted credential; the project copy was removed.");
  });
} finally {
  await sql.end();
}
