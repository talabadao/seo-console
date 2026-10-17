import { NextResponse } from "next/server";
import { isDenied, viewer } from "@/lib/access";
import { workspaceGaProperties } from "@/lib/google/discovery";

/**
 * GA4 properties the workspace's shared Google connections can read (each with its connection), for project
 * mappings and the Analytics pages. Read from the stored lists; refreshing them is Account → Data connections.
 */
export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  const properties = (await workspaceGaProperties(user.workspace_id!)).map((p) => ({
    propertyId: p.propertyId,
    displayName: p.displayName ?? p.propertyId,
    accountName: p.accountName ?? "",
    connectionId: p.connectionId,
    connectionEmail: p.connectionEmail,
  }));
  return NextResponse.json({ properties, refreshError: null, enableUrl: null, needsReconnect: false });
}
