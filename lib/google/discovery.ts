// What the workspace's shared Google connections can read: Search Console sites and GA4 properties, discovered per
// connection (sites.connection_id / ga_properties.connection_id). Project mappings choose a (property, connection)
// pair from these lists, so the same property readable by both analytics accounts is synced through one chosen
// connection only. Discovery runs when a connection is (re)connected or on an explicit refresh — not on page loads.

import { db } from "@/lib/db";
import { listSites } from "./searchconsole";
import { listGaProperties } from "@/lib/ga4";
import { connectionAccessToken } from "./connections";

export interface DiscoveredSite {
  id: number;
  property: string;
  permissionLevel: string | null;
  connectionId: number;
  connectionEmail: string;
}

export interface DiscoveredGaProperty {
  propertyId: string;
  displayName: string | null;
  accountName: string | null;
  connectionId: number;
  connectionEmail: string;
}

export async function workspaceSites(workspaceId: number): Promise<DiscoveredSite[]> {
  const rows = (await db
    .prepare(
      `SELECT s.id, s.property, s.permission_level, s.connection_id, c.email FROM sites s JOIN google_connections c ON c.id = s.connection_id
        WHERE c.workspace_id = ? AND s.source = 'google' ORDER BY s.property, lower(c.email)`,
    )
    .all(workspaceId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    property: String(r.property),
    permissionLevel: (r.permission_level as string | null) ?? null,
    connectionId: Number(r.connection_id),
    connectionEmail: String(r.email),
  }));
}

export async function workspaceGaProperties(workspaceId: number): Promise<DiscoveredGaProperty[]> {
  const rows = (await db
    .prepare(
      `SELECT g.property_id, g.display_name, g.account_name, g.connection_id, c.email FROM ga_properties g JOIN google_connections c ON c.id = g.connection_id
        WHERE c.workspace_id = ? ORDER BY g.account_name, g.display_name, lower(c.email)`,
    )
    .all(workspaceId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    propertyId: String(r.property_id),
    displayName: (r.display_name as string | null) ?? null,
    accountName: (r.account_name as string | null) ?? null,
    connectionId: Number(r.connection_id),
    connectionEmail: String(r.email),
  }));
}

/**
 * Refreshes one connection's lists from Google. Sites and properties it can no longer read are removed from its
 * list (a project still mapped to one then reports it as unavailable); rows other connections discovered are untouched.
 */
export async function refreshConnection(connectionId: number): Promise<{ sites: number; gaProperties: number; errors: string[] }> {
  const token = await connectionAccessToken(connectionId);
  const legacy = (await db.prepare("SELECT legacy_user_id FROM google_connections WHERE id = ?").get(connectionId)) as { legacy_user_id: number | null } | undefined;
  const legacyUser = legacy?.legacy_user_id ?? null;
  const now = Date.now();
  const errors: string[] = [];
  let sites = 0;
  let gaProperties = 0;
  try {
    const remote = (await listSites(token)).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
    for (const s of remote) {
      await db
        .prepare(
          `INSERT INTO sites (user_id, connection_id, source, property, permission_level, created_at) VALUES (?, ?, 'google', ?, ?, ?)
           ON CONFLICT (connection_id, source, property) WHERE connection_id IS NOT NULL DO UPDATE SET permission_level = EXCLUDED.permission_level`,
        )
        .run(legacyUser, connectionId, s.siteUrl, s.permissionLevel, now);
    }
    sites = remote.length;
  } catch (e) {
    errors.push(`Search Console: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
  try {
    const remote = await listGaProperties(token);
    const keep = new Set(remote.map((p) => p.propertyId));
    for (const p of remote) {
      await db
        .prepare(
          `INSERT INTO ga_properties (user_id, connection_id, property_id, display_name, account_name, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (connection_id, property_id) WHERE connection_id IS NOT NULL DO UPDATE SET display_name = EXCLUDED.display_name, account_name = EXCLUDED.account_name`,
        )
        .run(legacyUser, connectionId, p.propertyId, p.displayName, p.accountName, now);
    }
    for (const row of (await db.prepare("SELECT property_id FROM ga_properties WHERE connection_id = ?").all(connectionId)) as Array<{ property_id: string }>) {
      if (!keep.has(row.property_id)) await db.prepare("DELETE FROM ga_properties WHERE connection_id = ? AND property_id = ?").run(connectionId, row.property_id);
    }
    gaProperties = remote.length;
  } catch (e) {
    errors.push(`GA4: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
  return { sites, gaProperties, errors };
}
