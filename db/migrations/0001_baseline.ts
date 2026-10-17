import type { Migration } from "../../lib/migrations";
import { BASELINE_STATEMENTS } from "../../lib/schema";

/**
 * The schema as it stood when versioned migrations were introduced
 * (production commit 05f0c1d). Every statement is idempotent, so on an
 * existing database it changes nothing; on an empty one it builds the full
 * schema. Existing databases are normally recorded with `--baseline` instead
 * of running it (see db/migrations/README.md).
 */
export const migration: Migration = {
  id: "0001_baseline",
  description: "Schema as of production 05f0c1d (tables, added columns, longtail default fix)",
  statements: BASELINE_STATEMENTS,
};
