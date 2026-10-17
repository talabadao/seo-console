import { NextResponse } from "next/server";
import { isDenied, viewer } from "@/lib/access";
import { listConnections } from "@/lib/google/connections";
import { listAsanaConnections } from "@/lib/asanaConnections";

/**
 * The workspace's shared data connections (Google accounts and Asana tokens) with the granting person and health.
 * Never a token or secret.
 */
export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  return NextResponse.json({
    me: user.id,
    google: await listConnections(user.workspace_id!),
    asana: await listAsanaConnections(user.workspace_id!),
  });
}
