/**
 * Standalone daily sync — pulls the last N days of Search Console data for every
 * connected property of every user, into the local SQLite DB.
 *
 *   npm run sync
 *
 * Schedule on Windows: Task Scheduler → Create Task → Action "Start a program":
 *   Program:   node   (or the full path from `where node`)
 *   Arguments: node_modules/tsx/dist/cli.mjs scripts/sync.mts
 *   Start in:  C:\path\to\seo-dashboard
 */
import { readFileSync } from "node:fs";

// Load .env.local (Next loads this automatically; a plain node process does not).
try {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  console.warn("No .env.local found — relying on ambient env vars.");
}

const { db } = await import("../lib/db.ts");
const { syncAllForUser } = await import("../lib/sync.ts");

const users = db
  .prepare("SELECT * FROM users WHERE google_refresh_token IS NOT NULL")
  .all() as Array<{ id: number; email: string }>;

if (!users.length) {
  console.log("No connected users. Sign in through the web app first.");
  process.exit(0);
}

for (const u of users) {
  console.log(`\n▶ ${u.email}`);
  const results = await syncAllForUser(u as never);
  for (const r of results) {
    console.log(
      r.ok
        ? `  ✓ ${r.property} — ${r.rowsWritten} rows (${r.startDate}…${r.endDate})`
        : `  ✗ ${r.property} — ${r.error}`,
    );
  }
}
console.log("\nDone.");
process.exit(0);
