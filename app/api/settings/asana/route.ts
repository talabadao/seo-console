import { NextRequest, NextResponse } from "next/server";
import { isDenied, viewer } from "@/lib/access";
import { AsanaUnavailableError, listAsanaConnections, saveAsanaConnection } from "@/lib/asanaConnections";

/**
 * Asana reporting connections: saving a personal access token adds (or refreshes) a workspace connection that
 * projects can map; the token is verified, stored encrypted and never returned. Removing one is done in
 * Account → Data connections.
 */
export async function POST(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const { apiKey } = (await req.json().catch(() => ({}))) as { apiKey?: string };
  const token = (apiKey ?? "").trim();
  if (!token) return NextResponse.json({ error: "Paste an Asana personal access token. To remove a connection, use Account → Data connections." }, { status: 400 });
  try {
    const saved = await saveAsanaConnection(user.workspace_id!, user.id, token);
    return NextResponse.json({ ok: true, connected: true, name: saved.name, connectionId: saved.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof AsanaUnavailableError ? e.message : e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  const list = await listAsanaConnections(user.workspace_id!);
  return NextResponse.json({ connected: list.some((c) => c.status === "ok"), connections: list.length, mine: list.filter((c) => c.grantedByUserId === user.id).length });
}
