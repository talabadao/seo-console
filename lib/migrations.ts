import { createHash } from "node:crypto";

/**
 * A versioned schema migration. Migrations are plain SQL statements so they
 * can be checksummed: once a migration has been applied somewhere, its
 * statements must never change — add a new migration instead.
 */
export interface Migration {
  /** Sortable, unique, never reused: "0001_baseline", "0002_workspaces", … */
  id: string;
  description: string;
  statements: readonly string[];
}

export interface AppliedMigration {
  id: string;
  checksum: string;
}

export function checksumOf(m: Migration): string {
  return createHash("sha256").update(m.statements.join("\n;\n")).digest("hex");
}

export interface MigrationPlan {
  /** Known migrations not yet applied, in id order. */
  pending: Migration[];
  /** Applied migrations whose statements have since been edited. */
  changed: string[];
  /** Applied ids this code doesn't know about (the database is ahead of the code). */
  unknown: string[];
}

/**
 * Compares the migrations in the code with those recorded in the database.
 * A plan with `changed` or `unknown` entries must not be applied: both mean
 * the code and the database disagree about history.
 */
export function planMigrations(available: readonly Migration[], applied: readonly AppliedMigration[]): MigrationPlan {
  const ids = available.map((m) => m.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`Duplicate migration id: ${[...new Set(dupes)].join(", ")}`);
  const sorted = [...ids].sort();
  if (ids.some((id, i) => id !== sorted[i])) throw new Error("Migrations must be listed in id order.");

  const byId = new Map(applied.map((a) => [a.id, a.checksum]));
  const known = new Set(ids);
  return {
    pending: available.filter((m) => !byId.has(m.id)),
    changed: available.filter((m) => byId.has(m.id) && byId.get(m.id) !== checksumOf(m)).map((m) => m.id),
    unknown: applied.filter((a) => !known.has(a.id)).map((a) => a.id),
  };
}

/** "postgres://user:pass@host/db?x" → "host/db", for logs that must never show credentials. */
export function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
}

export const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  BIGINT NOT NULL,
    mode        TEXT NOT NULL
  )
`;
