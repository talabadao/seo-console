import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { verifyAsanaToken } from "@/lib/asana";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { apiKey } = (await req.json().catch(() => ({}))) as { apiKey?: string };
  const token = (apiKey ?? "").trim();

  if (!token) {
    await db.prepare("UPDATE users SET asana_api_token = NULL WHERE id = ?").run(user.id);
    return NextResponse.json({ ok: true, connected: false });
  }

  try {
    const who = await verifyAsanaToken(token);
    await db
      .prepare("UPDATE users SET asana_api_token = ?, updated_at = ? WHERE id = ?")
      .run(token, Date.now(), user.id);
    return NextResponse.json({ ok: true, connected: true, name: who.name });
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
  return NextResponse.json({ connected: Boolean(user.asana_api_token) });
}
