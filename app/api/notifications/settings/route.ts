import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getSettings, notificationsReady, runRules, saveSettings } from "@/lib/notifications/store";
import { DEFAULT_SETTINGS } from "@/lib/notifications/rules";

/** Notification thresholds and minimum volumes for the signed-in account. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await notificationsReady())) return NextResponse.json({ error: "This database hasn't run migration 0010 (notifications) yet." }, { status: 503 });
  return NextResponse.json({ settings: await getSettings(user.id), defaults: DEFAULT_SETTINGS });
}

/** Saves settings (numbers are clamped; unknown fields ignored) and re-runs the rules with them. Existing notifications stay. */
export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await notificationsReady())) return NextResponse.json({ error: "notifications unavailable" }, { status: 503 });
  const settings = await saveSettings(user.id, await req.json().catch(() => ({})));
  const run = await runRules(user.id, { force: true });
  return NextResponse.json({ settings, created: run.created });
}
