import { NextRequest, NextResponse } from "next/server";
import { isDenied, viewer } from "@/lib/access";
import { AsanaUnavailableError, asanaIdentitySuggestions, confirmAsanaIdentity } from "@/lib/asanaConnections";

/** Asana users whose email is exactly one of your verified logins (suggestions to confirm), and your current one. */
export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  let suggestions: Array<{ gid: string; name: string; email: string }> = [];
  let error: string | null = null;
  try {
    suggestions = await asanaIdentitySuggestions(user.workspace_id!, user.id);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json({ current: user.asana_user_gid ? { gid: user.asana_user_gid, name: user.asana_user_name } : null, suggestions, error });
}

/** Confirms your Asana user: { gid } from the suggestions, or { token } of your own (used once, not stored). */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { gid?: string; token?: string };
  try {
    return NextResponse.json({ ok: true, asana: await confirmAsanaIdentity(user.workspace_id!, user.id, { gid: body.gid, token: body.token }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof AsanaUnavailableError ? e.message : e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
