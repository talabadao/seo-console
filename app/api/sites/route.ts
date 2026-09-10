import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { accessTokenFor } from "@/lib/google/oauth";
import { listSites } from "@/lib/google/searchconsole";
import { db } from "@/lib/db";
import { dataDateRange, lastSync } from "@/lib/metrics";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let refreshError: string | null = null;
  try {
    const token = await accessTokenFor(user);
    const remote = await listSites(token);
    const now = Date.now();
    const upsert = db.prepare(
      `INSERT INTO sites (user_id, source, property, permission_level, created_at)
       VALUES (?, 'google', ?, ?, ?)
       ON CONFLICT(user_id, source, property) DO UPDATE SET permission_level = excluded.permission_level`,
    );
    for (const s of remote) {
      if (s.permissionLevel === "siteUnverifiedUser") continue;
      upsert.run(user.id, s.siteUrl, s.permissionLevel, now);
    }
  } catch (e) {
    refreshError = e instanceof Error ? e.message : String(e);
  }

  const rows = db
    .prepare(
      "SELECT id, source, property, permission_level FROM sites WHERE user_id = ? AND source = 'google' ORDER BY property",
    )
    .all(user.id) as {
    id: number;
    source: string;
    property: string;
    permission_level: string | null;
  }[];

  const sites = rows.map((r) => ({
    ...r,
    dataRange: dataDateRange(r.id),
    lastSync: lastSync(r.id) ?? null,
  }));

  return NextResponse.json({ sites, refreshError });
}
