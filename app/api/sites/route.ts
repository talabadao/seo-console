import { NextResponse } from "next/server";
import { isDenied, viewer } from "@/lib/access";
import { workspaceSites } from "@/lib/google/discovery";
import { listConnections } from "@/lib/google/connections";
import { dataDateRange, lastSync } from "@/lib/metrics";

/**
 * Search Console sites the workspace's shared Google connections can read (each with its connection), for project
 * mappings. Read from the stored lists; refreshing them is Account → Data connections → Refresh.
 */
export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  const rows = await workspaceSites(user.workspace_id!);
  const connections = await listConnections(user.workspace_id!);
  const sites = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      source: "google",
      property: r.property,
      permission_level: r.permissionLevel,
      connectionId: r.connectionId,
      connectionEmail: r.connectionEmail,
      dataRange: await dataDateRange(r.id),
      lastSync: (await lastSync(r.id)) ?? null,
    })),
  );
  // A personal login never carries Google data access; a connection that must be reconnected is reported instead.
  const reconnect = connections.filter((c) => c.status !== "ok").map((c) => ({ id: c.id, email: c.email, status: c.status }));
  return NextResponse.json({ sites, needsReconnect: false, connectionsNeedingAttention: reconnect });
}
