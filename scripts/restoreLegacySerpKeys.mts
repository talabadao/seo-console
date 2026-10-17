/**
 * Targeted rollback helper for the one known v2 → v1 incompatibility: when an account opens Account → API
 * credentials, v2 moves identical (or chosen) legacy per-project SerpApi keys into the encrypted account credential
 * and clears the plain-text copy on the project. v1 only reads projects.serpapi_key, so after a code rollback those
 * projects would lose Maps reviews. Instead of restoring the whole database, this copies just those keys back from
 * the pre-release Neon backup branch.
 *
 *   npx tsx --env-file=%USERPROFILE%\.seo-console\restore.env scripts/restoreLegacySerpKeys.mts            # dry run
 *   npx tsx --env-file=%USERPROFILE%\.seo-console\restore.env scripts/restoreLegacySerpKeys.mts --apply
 *
 * restore.env holds BACKUP_DATABASE_URL (branch pre-v2-pilot-2026-10-17, read-only use) and TARGET_DATABASE_URL
 * (Production, unpooled). Only projects whose key is empty on Production but present in the backup are updated, and
 * only when the project still belongs to the same account. Prints project ids and names, never keys.
 */
import postgres from "postgres";
import { describeTarget } from "../lib/migrations.ts";

const apply = process.argv.includes("--apply");
const backupUrl = process.env.BACKUP_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;
if (!backupUrl || !targetUrl) {
  console.error("Set BACKUP_DATABASE_URL and TARGET_DATABASE_URL in the protected env file.");
  process.exit(1);
}
if (describeTarget(backupUrl) === describeTarget(targetUrl)) {
  console.error("The backup and target are the same database; refusing.");
  process.exit(1);
}

const backup = postgres(backupUrl, { max: 1, onnotice: () => {} });
const target = postgres(targetUrl, { max: 1, onnotice: () => {} });
try {
  const old = (await backup.begin("READ ONLY", (tx) =>
    tx`SELECT id, user_id, name, serpapi_key FROM projects WHERE serpapi_key IS NOT NULL AND serpapi_key <> ''`,
  )) as unknown as Array<{ id: number; user_id: number; name: string; serpapi_key: string }>;
  console.log(`backup ${describeTarget(backupUrl)}: ${old.length} project(s) had a legacy SerpApi key`);
  let restored = 0;
  for (const p of old) {
    const [now] = await target`SELECT user_id, serpapi_key FROM projects WHERE id = ${p.id}`;
    if (!now) {
      console.log(`  #${p.id} ${p.name}: no longer exists on the target, skipped`);
      continue;
    }
    if (Number(now.user_id) !== Number(p.user_id)) {
      console.log(`  #${p.id} ${p.name}: owner changed, skipped`);
      continue;
    }
    if (now.serpapi_key) {
      console.log(`  #${p.id} ${p.name}: still has a key, unchanged`);
      continue;
    }
    if (apply) {
      await target`UPDATE projects SET serpapi_key = ${p.serpapi_key}, serpapi_key_updated_at = ${Date.now()} WHERE id = ${p.id} AND (serpapi_key IS NULL OR serpapi_key = '')`;
    }
    restored++;
    console.log(`  #${p.id} ${p.name}: ${apply ? "restored" : "would restore"}`);
  }
  console.log(`${apply ? "restored" : "dry run: would restore"} ${restored} key(s) on ${describeTarget(targetUrl)}`);
} finally {
  await backup.end({ timeout: 5 });
  await target.end({ timeout: 5 });
}
