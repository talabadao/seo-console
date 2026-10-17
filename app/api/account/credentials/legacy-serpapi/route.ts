import { NextRequest, NextResponse } from "next/server";
import { credentialGuard } from "@/lib/credentials/api";
import { adoptLegacySerpKey, consolidateLegacySerpKeys } from "@/lib/credentials/resolve";
import { removeSerpKey } from "@/lib/projects";

/**
 * Resolves a legacy project SerpApi key explicitly:
 * - { action: "adopt", projectId }  make that project's key the account's SerpApi credential (replacing any
 *   account key), and remove every project copy of the same key;
 * - { action: "clear", projectId }  remove that project's own key so it uses the account credential.
 * Only this account's projects can be named; nothing is chosen automatically between different keys.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; projectId?: unknown };
  const projectId = Number(body.projectId);
  if (!Number.isSafeInteger(projectId)) return NextResponse.json({ error: "bad project" }, { status: 400 });
  const g = await credentialGuard({ write: body.action === "adopt" });
  if ("error" in g) return g.error;
  if (body.action === "adopt") {
    if (!(await adoptLegacySerpKey(g.user.id, projectId))) return NextResponse.json({ error: "That project has no SerpApi key of its own." }, { status: 404 });
  } else if (body.action === "clear") {
    if (!(await removeSerpKey(g.user.id, projectId))) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  return NextResponse.json({ legacySerp: await consolidateLegacySerpKeys(g.user.id) });
}
