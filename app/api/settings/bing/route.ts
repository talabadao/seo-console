import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { getUserSites } from "@/lib/providers/bing";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { apiKey } = (await req.json().catch(() => ({}))) as { apiKey?: string };
  const key = (apiKey ?? "").trim();

  if (!key) {
    db.prepare("UPDATE users SET bing_api_key = NULL WHERE id = ?").run(user.id);
    return NextResponse.json({ ok: true, connected: false });
  }

  try {
    const sites = await getUserSites(key);
    const now = Date.now();
    const upsert = db.prepare(
      `INSERT INTO sites (user_id, source, property, permission_level, created_at)
       VALUES (?, 'bing', ?, 'owner', ?)
       ON CONFLICT(user_id, source, property) DO NOTHING`,
    );
    for (const s of sites) upsert.run(user.id, s, now);
    db.prepare("UPDATE users SET bing_api_key = ?, updated_at = ? WHERE id = ?").run(
      key,
      now,
      user.id,
    );
    return NextResponse.json({ ok: true, connected: true, sites });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ connected: Boolean(user.bing_api_key) });
}
