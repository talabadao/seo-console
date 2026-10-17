/**
 * Read-only preflight for the Production migration (docs/seo-console-v2/PRODUCTION-PILOT.md step 3).
 *
 *   npx tsx --env-file=%USERPROFILE%\.seo-console\prod-migrate.env scripts/prodPreflight.mts
 *
 * Reads only MIGRATE_DATABASE_URL (like scripts/migrate.mts) and runs in a READ ONLY transaction. Prints no
 * secrets: the target as host/database, the shape of the URL, and counts. Checks that it is the database Vercel's
 * Production uses (host and database-name lengths from the store metadata, unpooled, not the Preview database), and
 * that it is still in the expected pre-migration state.
 */
import postgres from "postgres";
import { describeTarget } from "../lib/migrations.ts";
import { ALLOWED_EMAILS } from "../lib/auth/allowlist.ts";

/** From Vercel store neon-camel-coin (store_JlbZAKpefXvDyQHo, Neon project little-cake-58811032): secret lengths only. */
const EXPECT = { unpooledHostLength: 53, databaseLength: 6 };
/** The isolated Preview database's endpoint (never the Production target). */
const PREVIEW_ENDPOINT = "ep-spring-firefly-b7804i0v";

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  console.error("MIGRATE_DATABASE_URL is not set (pass --env-file with the protected file).");
  process.exit(1);
}
const u = new URL(url);
const checks: Array<[string, boolean, string]> = [];
const ok = (name: string, pass: boolean, detail: string) => checks.push([name, pass, detail]);

ok("target", true, describeTarget(url));
ok("unpooled host (no -pooler)", !u.hostname.includes("-pooler"), u.hostname.includes("-pooler") ? "pooled host: use the connection string with pooling OFF" : "ok");
ok("host length matches Production store", u.hostname.length === EXPECT.unpooledHostLength, `length ${u.hostname.length}, expected ${EXPECT.unpooledHostLength}`);
ok("database name length matches", u.pathname.replace(/^\//, "").length === EXPECT.databaseLength, `length ${u.pathname.replace(/^\//, "").length}, expected ${EXPECT.databaseLength}`);
ok("not the Preview database", !u.hostname.startsWith(PREVIEW_ENDPOINT), u.hostname.startsWith(PREVIEW_ENDPOINT) ? "this is the Preview database" : "ok");
ok("TLS required", /sslmode=require|sslmode=verify/.test(u.search), u.search.includes("sslmode") ? "ok" : "add ?sslmode=require");

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql.begin("READ ONLY", async (tx) => {
    const [v] = await tx`SELECT current_setting('server_version') AS version, current_database() AS db, current_setting('server_encoding') AS enc`;
    ok("server", true, `Postgres ${v.version}, database ${v.db}, encoding ${v.enc}`);
    const [m] = await tx`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`;
    if (m.present) {
      const rows = await tx`SELECT id, mode FROM schema_migrations ORDER BY id`;
      ok("migration state", true, `schema_migrations present: ${rows.map((r) => `${r.id}:${r.mode}`).join(", ") || "empty"}`);
    } else ok("migration state", true, "no schema_migrations table (expected: v1, never migrated)");
    const tables = await tx`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`;
    const names = tables.map((t) => t.table_name as string);
    const v1 = ["users", "projects", "sites", "ga_properties", "weekly_kpi_config"];
    ok("v1 tables present", v1.every((t) => names.includes(t)), `${names.length} tables; v1 core ${v1.filter((t) => names.includes(t)).length}/${v1.length}`);
    const v2 = ["project_settings", "account_credentials", "kpi_targets", "report_cache", "serp_snapshots", "notifications", "page_meta"];
    ok("v2 tables", true, `${v2.filter((t) => names.includes(t)).length}/${v2.length} already present`);
    const [c] = await tx`SELECT (SELECT COUNT(*)::int FROM users) AS users, (SELECT COUNT(*)::int FROM projects) AS projects`;
    const emails = (await tx`SELECT lower(email) AS e FROM users`).map((r) => r.e as string);
    const allowed = ALLOWED_EMAILS.filter((e) => emails.includes(e.toLowerCase())).length;
    ok("data", c.users > 0, `${c.users} users (${allowed} of ${ALLOWED_EMAILS.length} allowlisted accounts present), ${c.projects} projects`);
  });
} catch (e) {
  ok("connect (read-only)", false, e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/[^\s]+/g, "<url>") : String(e));
} finally {
  await sql.end({ timeout: 5 });
}

for (const [name, pass, detail] of checks) console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${detail}`);
process.exitCode = checks.every(([, pass]) => pass) ? 0 : 1;
