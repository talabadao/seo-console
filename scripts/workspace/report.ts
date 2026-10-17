// Old → new mapping report for the workspace model (migration 0014), read-only, on a migrated database.
// Lists what the migration decided and what needs a human decision: people and their kinds, shared connections,
// projects (legacy owner → workspace, brand, primary manager, members, connections), projects needing a human
// manager, hidden projects, legacy per-project SerpApi keys, personal credentials and budgets by account,
// possible duplicate projects (same host — for review, never merged), and identities that would need a merge.
// No secrets: credential rows are reported by provider and fingerprint prefix only.

import type postgres from "postgres";

export interface MappingReport {
  people: Array<{ id: number; email: string; kind: string; status: string; workspace: number | null; identities: number; manages: number }>;
  connections: Array<{ id: number; email: string; legacyUser: number | null; status: string; sites: number; gaProperties: number; projects: number }>;
  asanaConnections: Array<{ id: number; legacyUser: number | null; projects: number }>;
  projects: Array<{
    id: number;
    name: string;
    legacyOwner: string;
    workspace: number | null;
    brand: string | null;
    primaryManager: string | null;
    members: string[];
    gscConnection: number | null;
    gaConnection: number | null;
    deleted: boolean;
  }>;
  needsManager: Array<{ id: number; name: string; legacyOwner: string; brand: string | null }>;
  hidden: Array<{ id: number; name: string; legacyOwner: string }>;
  legacyProjectKeys: Array<{ id: number; name: string; legacyOwner: string }>;
  credentials: Array<{ user: string; provider: string; fingerprint: string }>;
  budgets: Array<{ user: string; scope: string; metric: string }>;
  possibleDuplicates: Array<{ host: string; projects: Array<{ id: number; name: string; legacyOwner: string }> }>;
  invariantViolations: string[];
}

export async function mappingReport(sql: postgres.Sql): Promise<MappingReport> {
  const people = (await sql`
    SELECT u.id, u.email, u.kind, u.status, u.workspace_id,
           (SELECT COUNT(*)::int FROM user_identities i WHERE i.user_id = u.id) AS identities,
           (SELECT COUNT(*)::int FROM project_members m JOIN projects p ON p.id = m.project_id WHERE m.user_id = u.id AND p.deleted_at IS NULL) AS manages
      FROM users u ORDER BY u.id`).map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    kind: String(r.kind),
    status: String(r.status),
    workspace: r.workspace_id == null ? null : Number(r.workspace_id),
    identities: Number(r.identities),
    manages: Number(r.manages),
  }));
  const connections = (await sql`
    SELECT c.id, c.email, c.legacy_user_id, c.status,
           (SELECT COUNT(*)::int FROM sites s WHERE s.connection_id = c.id) AS sites,
           (SELECT COUNT(*)::int FROM ga_properties g WHERE g.connection_id = c.id) AS ga,
           (SELECT COUNT(*)::int FROM projects p WHERE p.deleted_at IS NULL AND (p.gsc_connection_id = c.id OR p.ga_connection_id = c.id)) AS projects
      FROM google_connections c ORDER BY c.id`).map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    legacyUser: r.legacy_user_id == null ? null : Number(r.legacy_user_id),
    status: String(r.status),
    sites: Number(r.sites),
    gaProperties: Number(r.ga),
    projects: Number(r.projects),
  }));
  const asanaConnections = (await sql`
    SELECT a.id, a.legacy_user_id, (SELECT COUNT(*)::int FROM projects p WHERE p.asana_connection_id = a.id AND p.deleted_at IS NULL) AS projects
      FROM asana_connections a ORDER BY a.id`).map((r) => ({ id: Number(r.id), legacyUser: r.legacy_user_id == null ? null : Number(r.legacy_user_id), projects: Number(r.projects) }));
  const projectRows = await sql`
    SELECT p.id, p.name, o.email AS owner, p.workspace_id, b.name AS brand, pm.email AS primary_manager, p.gsc_connection_id, p.ga_connection_id,
           p.deleted_at IS NOT NULL AS deleted, p.website_url, (p.serpapi_key IS NOT NULL AND p.serpapi_key <> '') AS legacy_key,
           COALESCE((SELECT array_agg(u.email ORDER BY u.email) FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = p.id), '{}') AS members
      FROM projects p JOIN users o ON o.id = p.user_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN users pm ON pm.id = p.primary_manager_id
     ORDER BY p.id`;
  const projects = projectRows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    legacyOwner: String(r.owner),
    workspace: r.workspace_id == null ? null : Number(r.workspace_id),
    brand: (r.brand as string | null) ?? null,
    primaryManager: (r.primary_manager as string | null) ?? null,
    members: (r.members as string[]) ?? [],
    gscConnection: r.gsc_connection_id == null ? null : Number(r.gsc_connection_id),
    gaConnection: r.ga_connection_id == null ? null : Number(r.ga_connection_id),
    deleted: Boolean(r.deleted),
  }));
  const live = projectRows.filter((r) => !r.deleted);
  const needsManager = live.filter((r) => r.workspace_id != null && r.primary_manager == null).map((r) => ({ id: Number(r.id), name: String(r.name), legacyOwner: String(r.owner), brand: (r.brand as string | null) ?? null }));
  const hidden = live.filter((r) => r.workspace_id == null).map((r) => ({ id: Number(r.id), name: String(r.name), legacyOwner: String(r.owner) }));
  const legacyProjectKeys = live.filter((r) => r.legacy_key).map((r) => ({ id: Number(r.id), name: String(r.name), legacyOwner: String(r.owner) }));
  const credentials = (await sql`SELECT u.email, c.provider, left(c.fingerprint, 6) AS fp FROM account_credentials c JOIN users u ON u.id = c.user_id ORDER BY u.email, c.provider`).map((r) => ({
    user: String(r.email),
    provider: String(r.provider),
    fingerprint: `${r.fp}…`,
  }));
  const budgets = (await sql`SELECT u.email, b.project_id, b.metric FROM budget_limits b JOIN users u ON u.id = b.user_id ORDER BY u.email, b.project_id, b.metric`).map((r) => ({
    user: String(r.email),
    scope: Number(r.project_id) === 0 ? "account" : `project ${r.project_id}`,
    metric: String(r.metric),
  }));
  const byHost = new Map<string, Array<{ id: number; name: string; legacyOwner: string }>>();
  for (const r of live) {
    const host = String(r.website_url ?? "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
    if (!host) continue;
    byHost.set(host, [...(byHost.get(host) ?? []), { id: Number(r.id), name: String(r.name), legacyOwner: String(r.owner) }]);
  }
  const possibleDuplicates = [...byHost.entries()].filter(([, ps]) => ps.length > 1).map(([host, ps]) => ({ host, projects: ps }));

  const invariantViolations: string[] = [];
  for (const r of await sql`SELECT p.id FROM projects p WHERE p.primary_manager_id IS NOT NULL AND p.deleted_at IS NULL
                              AND NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = p.primary_manager_id)`) {
    invariantViolations.push(`project ${r.id}: primary manager is not a management member`);
  }
  for (const r of await sql`SELECT p.id FROM projects p WHERE p.deleted_at IS NULL AND p.primary_manager_id IS NULL
                              AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id)`) {
    invariantViolations.push(`project ${r.id}: has members but no primary manager`);
  }
  for (const r of await sql`SELECT m.project_id, u.email FROM project_members m JOIN users u ON u.id = m.user_id WHERE u.kind <> 'person'`) {
    invariantViolations.push(`project ${r.project_id}: ${r.email} is a management member but not a person`);
  }
  return { people, connections, asanaConnections, projects, needsManager, hidden, legacyProjectKeys, credentials, budgets, possibleDuplicates, invariantViolations };
}
