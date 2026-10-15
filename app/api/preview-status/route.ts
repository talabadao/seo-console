import { NextResponse } from "next/server";
import postgres from "postgres";
import {
  databaseUrlFor,
  deploymentOf,
  externalWritesAllowed,
  missingPreviewSettings,
  schedulesAllowed,
} from "@/lib/environment";
import { describeTarget } from "@/lib/migrations";

export const dynamic = "force-dynamic";

/**
 * Read-only readiness of the Preview database: can we connect, does the app
 * schema exist, and which versioned migrations are recorded. Uses its own
 * short-lived connection (not lib/db, which would create the schema) and
 * runs only SELECTs.
 */
async function readiness(url: string) {
  const sql = postgres(url, { max: 1, connect_timeout: 8, idle_timeout: 1, ...(/sslmode=/.test(url) ? {} : { ssl: "require" as const }) });
  try {
    const [row] = await sql`SELECT to_regclass('public.users') IS NOT NULL AS schema,
                                   to_regclass('public.schema_migrations') IS NOT NULL AS history`;
    const migrations = row.history ? (await sql`SELECT id FROM schema_migrations ORDER BY id`).map((r) => String(r.id)) : [];
    const users = row.schema ? Number((await sql`SELECT count(*)::int AS n FROM users`)[0].n) : null;
    return { reachable: true, schema: Boolean(row.schema), migrations, users, error: null };
  } catch (e) {
    // Driver messages name the host at most; strip anything that looks like a URL with credentials anyway.
    const message = (e instanceof Error ? e.message : String(e)).replace(/postgres(ql)?:\/\/\S+/g, "<connection string>");
    return { reachable: false, schema: false, migrations: [], users: null, error: message.slice(0, 200) };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

/**
 * Preview deployments only: shows which database the preview is connected to
 * (host and database name, never credentials), whether it's ready, and which
 * safeguards are on, so isolation can be verified without reading secrets.
 * Not found elsewhere.
 */
export async function GET() {
  if (deploymentOf() !== "preview") return NextResponse.json({ error: "not found" }, { status: 404 });
  let database: string | null = null;
  let databaseError: string | null = null;
  let databaseReady = null;
  try {
    const url = databaseUrlFor();
    database = describeTarget(url);
    databaseReady = await readiness(url);
  } catch (e) {
    databaseError = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json(
    {
      deployment: "preview",
      database,
      databaseError,
      databaseReady,
      externalWrites: externalWritesAllowed(),
      schedules: schedulesAllowed(),
      missingSettings: missingPreviewSettings(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
