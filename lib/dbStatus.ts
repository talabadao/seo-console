// Which deployment is serving and which schema migrations its database has recorded, for Account → Sync & cache.
// Read-only and non-sensitive: migration ids only, never a host, user or connection string. Lets an owner confirm
// in the signed-in app that a database (e.g. the isolated Preview one) has actually applied a migration.

import { db, tableExists } from "@/lib/db";
import { deploymentOf, type Deployment } from "@/lib/environment";
import { MIGRATIONS } from "@/db/migrations";

export interface DatabaseStatus {
  environment: Deployment;
  /** Migration ids recorded in schema_migrations, oldest first (null: no migrations table). */
  applied: string[] | null;
  /** Migrations this code knows that the database hasn't recorded. */
  pending: string[];
}

export async function databaseStatus(): Promise<DatabaseStatus> {
  const applied = (await tableExists("schema_migrations"))
    ? ((await db.prepare("SELECT id FROM schema_migrations ORDER BY id").all()) as Array<{ id: string }>).map((r) => String(r.id))
    : null;
  return { environment: deploymentOf(), applied, pending: MIGRATIONS.map((m) => m.id).filter((id) => !applied?.includes(id)) };
}
