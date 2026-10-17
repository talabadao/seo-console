/**
 * Seeds an isolated Preview (or local) database with synthetic fixtures, so
 * migrations and data-writing code can be tested without production data.
 *
 *   MIGRATE_DATABASE_URL=… npm run seed:preview -- --confirm=<host/db>
 *
 * Reads only MIGRATE_DATABASE_URL and requires --confirm with the target's
 * host and database name (`npm run migrate` prints it). The schema must
 * already exist (`npm run migrate -- --apply …`). Safe to run more than once:
 * every row is keyed on fixture-only identifiers and upserted.
 *
 * All fixture data is invented: example.com domains, a .invalid email, no
 * tokens or keys. The fixture account is not on the sign-in allowlist.
 */
import postgres from "postgres";
import { describeTarget } from "../lib/migrations.ts";

const FIXTURE_EMAIL = "preview-fixture@example.invalid";

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  console.error("Set MIGRATE_DATABASE_URL to the Preview or local database (this script ignores DATABASE_URL).");
  process.exit(1);
}
const target = describeTarget(url);
const confirm = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
if (confirm !== target) {
  console.error(`Refusing to seed: pass --confirm=${target} to confirm the target database.`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, ...(/sslmode=/.test(url) ? {} : { ssl: "require" as const }) });
const now = Date.now();
const day = (offset: number) => new Date(now - offset * 86400000).toISOString().slice(0, 10);

try {
  await sql.begin(async (tx) => {
    const [user] = await tx`
      INSERT INTO users (email, name, created_at, updated_at, projects_seeded)
      VALUES (${FIXTURE_EMAIL}, 'Preview Fixture', ${now}, ${now}, true)
      ON CONFLICT (email) DO UPDATE SET updated_at = EXCLUDED.updated_at
      RETURNING id`;

    await tx`
      INSERT INTO sites (user_id, source, property, permission_level, created_at)
      VALUES (${user.id}, 'google', 'sc-domain:example.com', 'siteOwner', ${now})
      ON CONFLICT (user_id, source, property) DO NOTHING`;

    const existing = await tx`SELECT id FROM projects WHERE user_id = ${user.id} AND name = 'Example Hotel (fixture)'`;
    const projectId =
      existing[0]?.id ??
      (
        await tx`
          INSERT INTO projects (user_id, name, website_url, favicon_url, gsc_property, created_at, updated_at)
          VALUES (${user.id}, 'Example Hotel (fixture)', 'https://example.com', '', 'sc-domain:example.com', ${now}, ${now})
          RETURNING id`
      )[0].id;

    const [page] = await tx`
      INSERT INTO psi_pages (project_id, url, created_at)
      VALUES (${projectId}, 'https://example.com/', ${now})
      ON CONFLICT (project_id, url) DO UPDATE SET url = EXCLUDED.url
      RETURNING id`;

    for (let i = 0; i < 7; i++) {
      for (const [strategy, score, lcp] of [
        ["mobile", 55 + i, 3900 - i * 60],
        ["desktop", 85 + (i % 3), 1800 - i * 20],
      ] as const) {
        await tx`
          INSERT INTO psi_runs (page_id, strategy, run_date, fetched_at, score, lcp, tbt, cls, recs_json)
          VALUES (${page.id}, ${strategy}, ${day(i)}, ${now}, ${score}, ${lcp}, 250, 0.05, '[]')
          ON CONFLICT (page_id, strategy, run_date) DO NOTHING`;
      }
    }
  });
  console.log(`Seeded fixtures into ${target} (user ${FIXTURE_EMAIL}, project "Example Hotel (fixture)").`);
} finally {
  await sql.end();
}
