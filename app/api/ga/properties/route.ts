import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { listGaProperties } from "@/lib/ga4";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!hasAnalyticsScope(user.google_scopes)) {
    return NextResponse.json({ properties: [], needsReconnect: true });
  }

  let refreshError: string | null = null;
  try {
    const token = await accessTokenFor(user);
    const remote = await listGaProperties(token);
    const now = Date.now();
    const upsert = db.prepare(`
      INSERT INTO ga_properties (user_id, property_id, display_name, account_name, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, property_id) DO UPDATE SET
        display_name = excluded.display_name, account_name = excluded.account_name
    `);
    for (const p of remote) {
      upsert.run(user.id, p.propertyId, p.displayName, p.accountName, now);
    }
    // Drop properties the user no longer has access to.
    const keep = new Set(remote.map((p) => p.propertyId));
    for (const row of db
      .prepare("SELECT property_id FROM ga_properties WHERE user_id = ?")
      .all(user.id) as { property_id: string }[]) {
      if (!keep.has(row.property_id)) {
        db.prepare("DELETE FROM ga_properties WHERE user_id = ? AND property_id = ?").run(
          user.id,
          row.property_id,
        );
      }
    }
  } catch (e) {
    refreshError = e instanceof Error ? e.message : String(e);
  }

  const properties = db
    .prepare(
      "SELECT property_id AS propertyId, display_name AS displayName, account_name AS accountName FROM ga_properties WHERE user_id = ? ORDER BY account_name, display_name",
    )
    .all(user.id);

  return NextResponse.json({ properties, refreshError });
}
