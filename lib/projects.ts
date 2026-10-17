// Projects in the team workspace (docs/seo-console-v2/WORKSPACE-MEMBERS.md).
// - Every active User in the workspace can VIEW every live project and its results.
// - Project management members (the creator first, then whoever is shared in) can edit, run, share/unshare,
//   transfer primary management and delete; all members have the same powers. One member is the primary manager
//   (pays for scheduled paid work). Creator attribution (created_by) never changes.
// - Invariants, enforced in one transaction per change: the primary manager is always a management member, a
//   project with members always has a primary manager, and the last manager can't be removed.
// - Deletion is recoverable (deleted_at) and cancels queued work; usage history stays.
// projects.user_id is the legacy owner (history and the previous release's view); it is not used for access.

import { db, tableExists, withTransaction } from "@/lib/db";
import { brandFromHost, faviconFor, hostOf, normalizeUrl } from "@/lib/projectMatch";
import { normalizeMapsUrl } from "@/lib/serpapi";

export interface Project {
  id: number;
  name: string;
  websiteUrl: string;
  faviconUrl: string;
  gscProperty: string | null;
  gaPropertyId: string | null;
  /** The shared Google connections that read Search Console and GA4 for this project. */
  gscConnectionId: number | null;
  gaConnectionId: number | null;
  /** Google Maps link of the business whose reviews are tracked. */
  mapsUrl: string;
  /** Place id resolved from the Maps link, and the business name Google returns for it. */
  gbpLocation: string | null;
  gbpLocationTitle: string | null;
  /** Whether the viewer has a SerpApi key for paid runs (their own account credential). Never the key itself. */
  hasSerpKey: boolean;
  /** Where the viewer's SerpApi key comes from (their account credential), or null. */
  serpKeySource: "account" | null;
  serpKeyLast4: string | null;
  serpKeyUpdatedAt: number | null;
  /** A legacy SerpApi key is still stored on the project, waiting for an owner decision (never used for runs). */
  legacyProjectKey: boolean;
  asanaProjectGid: string;
  asanaProjectName: string;
  asanaConnectionId: number | null;
  workspaceId: number;
  brandId: number | null;
  brandName: string | null;
  createdBy: number | null;
  createdByName: string | null;
  primaryManagerId: number | null;
  primaryManagerName: string | null;
  /** The viewer is a management member of this project. */
  canManage: boolean;
  isPrimaryManager: boolean;
  managerCount: number;
}

export interface ProjectInput {
  name?: string;
  websiteUrl?: string;
  faviconUrl?: string;
  gscProperty?: string | null;
  gaPropertyId?: string | null;
  gscConnectionId?: number | null;
  gaConnectionId?: number | null;
  mapsUrl?: string;
  asanaProjectGid?: string;
  asanaProjectName?: string;
  asanaConnectionId?: number | null;
  brandId?: number | null;
}

/** The viewer's workspace (null when the User isn't an active person in one). */
const WS = `(SELECT workspace_id FROM users WHERE id = ? AND kind = 'person' AND status = 'active')`;

const COLUMNS = `p.id, p.name, p.website_url AS "websiteUrl", p.favicon_url AS "faviconUrl",
  p.gsc_property AS "gscProperty", p.ga_property_id AS "gaPropertyId",
  p.gsc_connection_id AS "gscConnectionId", p.ga_connection_id AS "gaConnectionId",
  p.maps_url AS "mapsUrl", p.gbp_location AS "gbpLocation", p.gbp_location_title AS "gbpLocationTitle",
  (p.serpapi_key IS NOT NULL AND p.serpapi_key <> '') AS "legacyProjectKey",
  p.asana_project_gid AS "asanaProjectGid", p.asana_project_name AS "asanaProjectName", p.asana_connection_id AS "asanaConnectionId",
  p.workspace_id AS "workspaceId", p.brand_id AS "brandId", b.name AS "brandName",
  p.created_by AS "createdBy", COALESCE(cu.name, cu.email) AS "createdByName",
  p.primary_manager_id AS "primaryManagerId", COALESCE(pm.name, pm.email) AS "primaryManagerName",
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?) AS "canManage",
  (SELECT COUNT(*)::int FROM project_members m WHERE m.project_id = p.id) AS "managerCount"`;

const FROM = `FROM projects p
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN users cu ON cu.id = COALESCE((SELECT merged_into FROM users x WHERE x.id = p.created_by), p.created_by)
  LEFT JOIN users pm ON pm.id = p.primary_manager_id`;

type Row = Omit<Project, "hasSerpKey" | "serpKeySource" | "serpKeyLast4" | "serpKeyUpdatedAt" | "isPrimaryManager">;

/** The viewer's own SerpApi credential status (metadata only; never decrypts). */
async function withSerpStatus(userId: number, rows: Row[]): Promise<Project[]> {
  let account: { hint: string | null; updated_at: number } | undefined;
  if (rows.length && (await tableExists("account_credentials"))) {
    account = (await db.prepare("SELECT hint, updated_at FROM account_credentials WHERE user_id = ? AND provider = 'serpapi'").get(userId)) as
      | { hint: string | null; updated_at: number }
      | undefined;
  }
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    gscConnectionId: r.gscConnectionId == null ? null : Number(r.gscConnectionId),
    gaConnectionId: r.gaConnectionId == null ? null : Number(r.gaConnectionId),
    asanaConnectionId: r.asanaConnectionId == null ? null : Number(r.asanaConnectionId),
    workspaceId: Number(r.workspaceId),
    brandId: r.brandId == null ? null : Number(r.brandId),
    createdBy: r.createdBy == null ? null : Number(r.createdBy),
    primaryManagerId: r.primaryManagerId == null ? null : Number(r.primaryManagerId),
    managerCount: Number(r.managerCount),
    canManage: Boolean(r.canManage),
    legacyProjectKey: Boolean(r.legacyProjectKey),
    isPrimaryManager: r.primaryManagerId != null && Number(r.primaryManagerId) === userId,
    hasSerpKey: Boolean(account),
    serpKeySource: account ? "account" : null,
    serpKeyLast4: account?.hint ?? null,
    serpKeyUpdatedAt: account ? Number(account.updated_at) : null,
  }));
}

/** Every live project in the viewer's workspace (all brands), with the viewer's management flag. */
export async function listProjects(userId: number): Promise<Project[]> {
  const rows = (await db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE p.workspace_id = ${WS} AND p.deleted_at IS NULL ORDER BY LOWER(p.name), p.id`)
    .all(userId, userId)) as unknown as Row[];
  return withSerpStatus(userId, rows);
}

/** A live project the viewer may see (any project in their workspace), or null. */
export async function getProject(userId: number, id: number): Promise<Project | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const row = (await db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE p.id = ? AND p.workspace_id = ${WS} AND p.deleted_at IS NULL`)
    .get(userId, id, userId)) as unknown as Row | undefined;
  return row ? (await withSerpStatus(userId, [row]))[0] : null;
}

/** A live project the viewer manages (a management member), or null. */
export async function getManagedProject(userId: number, id: number): Promise<Project | null> {
  const p = await getProject(userId, id);
  return p?.canManage ? p : null;
}

/** A live project by id for background work (no viewer): only workspace projects. */
export async function projectById(id: number): Promise<Project | null> {
  const row = (await db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE p.id = ? AND p.workspace_id IS NOT NULL AND p.deleted_at IS NULL`)
    .get(0, id)) as unknown as Row | undefined;
  return row ? (await withSerpStatus(0, [row]))[0] : null;
}

/** The viewer's visible project a GA4 property is linked to, if any (first match when linked more than once). */
export async function projectForGa(userId: number, gaPropertyId: string): Promise<Project | null> {
  const r = (await db
    .prepare(`SELECT p.id FROM projects p WHERE p.workspace_id = ${WS} AND p.deleted_at IS NULL AND p.ga_property_id = ? ORDER BY p.id LIMIT 1`)
    .get(userId, gaPropertyId)) as { id: number } | undefined;
  return r ? getProject(userId, Number(r.id)) : null;
}

/** A project whose Search Console property is this one (for property-based routes), preferring the given project. */
export async function projectForGsc(userId: number, property: string, preferId?: number | null): Promise<Project | null> {
  const r = (await db
    .prepare(
      `SELECT p.id FROM projects p WHERE p.workspace_id = ${WS} AND p.deleted_at IS NULL AND p.gsc_property = ?
        ORDER BY (p.id = ?) DESC, p.id LIMIT 1`,
    )
    .get(userId, property, preferId ?? 0)) as { id: number } | undefined;
  return r ? getProject(userId, Number(r.id)) : null;
}

export class ProjectValidationError extends Error {}
export class ProjectForbiddenError extends Error {}

/** The connection a mapping uses: the one given, else the project's current one, else the only one that lists it. */
async function mappingConnection(
  workspaceId: number,
  kind: "gsc" | "ga4",
  value: string,
  requested: number | null | undefined,
  current: number | null | undefined,
): Promise<number> {
  const listQuery =
    kind === "gsc"
      ? "SELECT s.connection_id AS id FROM sites s JOIN google_connections c ON c.id = s.connection_id WHERE c.workspace_id = ? AND s.source = 'google' AND s.property = ?"
      : "SELECT g.connection_id AS id FROM ga_properties g JOIN google_connections c ON c.id = g.connection_id WHERE c.workspace_id = ? AND g.property_id = ?";
  const ids = ((await db.prepare(listQuery).all(workspaceId, value)) as Array<{ id: number }>).map((r) => Number(r.id));
  const label = kind === "gsc" ? "Search Console property" : "GA4 property";
  if (requested != null) {
    if (!ids.includes(Number(requested))) throw new ProjectValidationError(`That ${label} isn't available through the chosen Google connection.`);
    return Number(requested);
  }
  if (current != null && ids.includes(Number(current))) return Number(current);
  if (ids.length === 1) return ids[0];
  if (!ids.length) throw new ProjectValidationError(`That ${label} isn't available through any connected Google account.`);
  throw new ProjectValidationError(`Several connected Google accounts can read that ${label}. Choose which connection this project uses.`);
}

async function brandOk(workspaceId: number, brandId: number | null | undefined): Promise<number | null> {
  if (brandId == null) return null;
  const ok = await db.prepare("SELECT 1 FROM brands WHERE id = ? AND workspace_id = ?").get(brandId, workspaceId);
  if (!ok) throw new ProjectValidationError("Unknown brand.");
  return Number(brandId);
}

async function asanaConnectionOk(workspaceId: number, id: number | null | undefined): Promise<number | null> {
  if (id == null) return null;
  const ok = await db.prepare("SELECT 1 FROM asana_connections WHERE id = ? AND workspace_id = ?").get(id, workspaceId);
  if (!ok) throw new ProjectValidationError("Unknown Asana connection.");
  return Number(id);
}

/** Cleans a create/update payload and checks every mapping against the workspace's connections. */
async function clean(workspaceId: number, input: ProjectInput, base?: Project) {
  const websiteUrl = input.websiteUrl !== undefined ? normalizeUrl(input.websiteUrl) : (base?.websiteUrl ?? "");
  if (input.websiteUrl?.trim() && !websiteUrl) throw new ProjectValidationError("Website URL isn't a valid address.");
  const host = hostOf(websiteUrl);
  const name = (input.name ?? base?.name ?? "").trim() || brandFromHost(host);
  if (!name) throw new ProjectValidationError("Give the project a brand name or a website URL.");
  let faviconUrl = input.faviconUrl !== undefined ? input.faviconUrl.trim() : (base?.faviconUrl ?? "");
  if (faviconUrl && !/^https:\/\//i.test(faviconUrl)) throw new ProjectValidationError("Favicon must be an https:// image address.");
  if (!faviconUrl) faviconUrl = faviconFor(host);

  const gscProperty = input.gscProperty !== undefined ? input.gscProperty || null : (base?.gscProperty ?? null);
  const gscConnectionId = gscProperty
    ? input.gscProperty !== undefined || input.gscConnectionId !== undefined
      ? await mappingConnection(workspaceId, "gsc", gscProperty, input.gscConnectionId, base?.gscConnectionId)
      : (base?.gscConnectionId ?? null)
    : null;
  const gaPropertyId = input.gaPropertyId !== undefined ? input.gaPropertyId || null : (base?.gaPropertyId ?? null);
  const gaConnectionId = gaPropertyId
    ? input.gaPropertyId !== undefined || input.gaConnectionId !== undefined
      ? await mappingConnection(workspaceId, "ga4", gaPropertyId, input.gaConnectionId, base?.gaConnectionId)
      : (base?.gaConnectionId ?? null)
    : null;
  const asanaProjectGid = (input.asanaProjectGid ?? base?.asanaProjectGid ?? "").trim();
  const asanaConnectionId = asanaProjectGid
    ? await asanaConnectionOk(workspaceId, input.asanaConnectionId !== undefined ? input.asanaConnectionId : (base?.asanaConnectionId ?? null))
    : null;
  return {
    name: name.slice(0, 120),
    websiteUrl,
    faviconUrl,
    gscProperty,
    gscConnectionId,
    gaPropertyId,
    gaConnectionId,
    asanaProjectGid,
    asanaProjectName: (input.asanaProjectName ?? base?.asanaProjectName ?? "").trim(),
    asanaConnectionId,
    brandId: input.brandId !== undefined ? await brandOk(workspaceId, input.brandId) : (base?.brandId ?? null),
  };
}

/** The legacy SerpApi key stored on a project, for the protected consolidation path only. */
export async function serpKeyFor(projectId: number): Promise<string | null> {
  const row = (await db.prepare("SELECT serpapi_key FROM projects WHERE id = ?").get(projectId)) as { serpapi_key: string | null } | undefined;
  return row?.serpapi_key || null;
}

/** Removes a legacy SerpApi key from a project (a management action). Returns the project, or null without access. */
export async function removeSerpKey(userId: number, projectId: number): Promise<Project | null> {
  if (!(await getManagedProject(userId, projectId))) return null;
  await db.prepare("UPDATE projects SET serpapi_key = NULL, serpapi_key_updated_at = NULL WHERE id = ?").run(projectId);
  return getProject(userId, projectId);
}

function cleanMapsUrl(input: ProjectInput): string | undefined {
  if (input.mapsUrl === undefined) return undefined;
  if (!input.mapsUrl.trim()) return "";
  const url = normalizeMapsUrl(input.mapsUrl);
  if (!url) throw new ProjectValidationError("That isn't a Google Maps link.");
  return url;
}

/** Saves the Maps link. A new link clears the resolved place so it is looked up again. */
async function saveReviewSource(id: number, mapsUrl: string | undefined, base?: Project) {
  if (mapsUrl !== undefined && mapsUrl !== (base?.mapsUrl ?? "")) {
    await db.prepare("UPDATE projects SET maps_url = ?, gbp_location = NULL, gbp_location_title = NULL WHERE id = ?").run(mapsUrl, id);
  }
}

async function workspaceOf(userId: number): Promise<number> {
  const r = (await db.prepare("SELECT workspace_id FROM users WHERE id = ? AND kind = 'person' AND status = 'active'").get(userId)) as { workspace_id: number | null } | undefined;
  if (!r?.workspace_id) throw new ProjectForbiddenError("Only active team members can create projects.");
  return Number(r.workspace_id);
}

/** The brand of the creator's company login, used as a new project's default brand. */
async function defaultBrand(userId: number, workspaceId: number): Promise<number | null> {
  const r = (await db
    .prepare(
      `SELECT b.id FROM user_identities i JOIN brands b ON b.workspace_id = ? AND b.email_domain = i.hosted_domain
        WHERE i.user_id = ? ORDER BY i.last_login_at DESC NULLS LAST LIMIT 1`,
    )
    .get(workspaceId, userId)) as { id: number } | undefined;
  return r ? Number(r.id) : null;
}

/** Any User can create a project; the creator becomes its first management member and primary manager. */
export async function createProject(userId: number, input: ProjectInput): Promise<Project> {
  const workspaceId = await workspaceOf(userId);
  const mapsUrl = cleanMapsUrl(input);
  const c = await clean(workspaceId, input);
  const brandId = c.brandId ?? (await defaultBrand(userId, workspaceId));
  const now = Date.now();
  const id = await withTransaction(async (q) => {
    const [row] = await q(
      `INSERT INTO projects (user_id, name, website_url, favicon_url, gsc_property, ga_property_id, gsc_connection_id, ga_connection_id,
                             asana_project_gid, asana_project_name, asana_connection_id, workspace_id, brand_id, created_by, primary_manager_id,
                             created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      userId,
      c.name,
      c.websiteUrl,
      c.faviconUrl,
      c.gscProperty,
      c.gaPropertyId,
      c.gscConnectionId,
      c.gaConnectionId,
      c.asanaProjectGid,
      c.asanaProjectName,
      c.asanaConnectionId,
      workspaceId,
      brandId,
      userId,
      userId,
      now,
      now,
    );
    const pid = Number(row.id);
    await q("INSERT INTO project_members (project_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)", pid, userId, userId, now);
    return pid;
  });
  await saveReviewSource(id, mapsUrl);
  return (await getProject(userId, id))!;
}

/** Edits a project. Management members only; returns null when the project isn't visible or isn't managed. */
export async function updateProject(userId: number, id: number, input: ProjectInput): Promise<Project | null> {
  const base = await getManagedProject(userId, id);
  if (!base) return null;
  const mapsUrl = cleanMapsUrl(input);
  const c = await clean(base.workspaceId, input, base);
  await db
    .prepare(
      `UPDATE projects SET name = ?, website_url = ?, favicon_url = ?, gsc_property = ?, gsc_connection_id = ?, ga_property_id = ?, ga_connection_id = ?,
              asana_project_gid = ?, asana_project_name = ?, asana_connection_id = ?, brand_id = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(c.name, c.websiteUrl, c.faviconUrl, c.gscProperty, c.gscConnectionId, c.gaPropertyId, c.gaConnectionId, c.asanaProjectGid, c.asanaProjectName, c.asanaConnectionId, c.brandId, Date.now(), id);
  await saveReviewSource(id, mapsUrl, base);
  return getProject(userId, id);
}

// --- Management membership -----------------------------------------------------------------------------------

export interface ProjectManager {
  userId: number;
  name: string | null;
  email: string;
  picture: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
  addedAt: number;
  addedByName: string | null;
}

export async function listManagers(projectId: number): Promise<ProjectManager[]> {
  const rows = (await db
    .prepare(
      `SELECT m.user_id, u.name, u.email, u.picture, u.job_title, m.added_at, COALESCE(a.name, a.email) AS added_by_name, (p.primary_manager_id = m.user_id) AS is_primary
         FROM project_members m JOIN users u ON u.id = m.user_id JOIN projects p ON p.id = m.project_id LEFT JOIN users a ON a.id = m.added_by
        WHERE m.project_id = ? ORDER BY (p.primary_manager_id = m.user_id) DESC, lower(COALESCE(u.name, u.email))`,
    )
    .all(projectId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    userId: Number(r.user_id),
    name: (r.name as string | null) ?? null,
    email: String(r.email),
    picture: (r.picture as string | null) ?? null,
    jobTitle: (r.job_title as string | null) ?? null,
    isPrimary: Boolean(r.is_primary),
    addedAt: Number(r.added_at),
    addedByName: (r.added_by_name as string | null) ?? null,
  }));
}

/** Locks the project row and checks that the actor manages it (inside a transaction). */
async function lockManaged(q: (sql: string, ...a: unknown[]) => Promise<Record<string, unknown>[]>, actorId: number, projectId: number) {
  const [p] = await q(
    `SELECT p.id, p.workspace_id, p.primary_manager_id FROM projects p
      WHERE p.id = ? AND p.deleted_at IS NULL AND p.workspace_id = ${WS} FOR UPDATE`,
    projectId,
    actorId,
  );
  if (!p) throw new ProjectForbiddenError("Unknown project.");
  const [m] = await q("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?", projectId, actorId);
  if (!m) throw new ProjectForbiddenError("Only the project's managers can change who manages it.");
  return { workspaceId: Number(p.workspace_id), primaryId: p.primary_manager_id == null ? null : Number(p.primary_manager_id) };
}

async function activePeople(q: (sql: string, ...a: unknown[]) => Promise<Record<string, unknown>[]>, workspaceId: number, ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const rows = await q(
    `SELECT id FROM users WHERE id = ANY(?::bigint[]) AND workspace_id = ? AND kind = 'person' AND status = 'active'`,
    `{${ids.join(",")}}`,
    workspaceId,
  );
  return rows.map((r) => Number(r.id));
}

/** Shares project management with existing team members. Any management member may do it. */
export async function addManagers(actorId: number, projectId: number, userIds: number[]): Promise<{ added: number }> {
  const ids = [...new Set(userIds.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 50);
  return withTransaction(async (q) => {
    const { workspaceId, primaryId } = await lockManaged(q, actorId, projectId);
    const ok = await activePeople(q, workspaceId, ids);
    if (ok.length !== ids.length) throw new ProjectValidationError("Projects can only be shared with active team members.");
    let added = 0;
    const now = Date.now();
    for (const id of ok) {
      const r = await q("INSERT INTO project_members (project_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING user_id", projectId, id, actorId, now);
      added += r.length;
    }
    // A project that had no manager (e.g. one migrated from a shared analytics account) gets its first primary manager.
    if (primaryId == null && ok.length) await q("UPDATE projects SET primary_manager_id = ?, spending_version = spending_version + 1 WHERE id = ?", ok[0], projectId);
    return { added };
  });
}

/** Cancels not-yet-started paid work billed to someone who no longer pays for this project, and bumps the version. */
async function revokeSpending(q: (sql: string, ...a: unknown[]) => Promise<Record<string, unknown>[]>, projectId: number, oldPayer: number | null, reason: string): Promise<void> {
  await q("UPDATE projects SET spending_version = spending_version + 1 WHERE id = ?", projectId);
  if (oldPayer != null) {
    await q(
      "UPDATE ai_runs SET status = 'cancelled', error = ?, finished_at = ? WHERE project_id = ? AND payer_user_id = ? AND status = 'queued'",
      reason,
      Date.now(),
      projectId,
      oldPayer,
    );
  }
}

/**
 * Removes a management member (any member may remove any other, including the creator, or themself). Removing the
 * primary manager requires a replacement who is (or becomes) a member; the last manager can't be removed.
 */
export async function removeManager(actorId: number, projectId: number, userId: number, opts: { newPrimaryId?: number | null } = {}): Promise<void> {
  await withTransaction(async (q) => {
    const { workspaceId, primaryId } = await lockManaged(q, actorId, projectId);
    const members = (await q("SELECT user_id FROM project_members WHERE project_id = ?", projectId)).map((r) => Number(r.user_id));
    if (!members.includes(userId)) throw new ProjectValidationError("That person doesn't manage this project.");
    if (members.length <= 1) throw new ProjectValidationError("A project needs at least one manager. Add someone else before removing the last manager.");
    if (primaryId === userId) {
      const next = opts.newPrimaryId != null ? Number(opts.newPrimaryId) : null;
      if (next == null || next === userId) throw new ProjectValidationError("Choose a new primary manager before removing the current one.");
      if (!(await activePeople(q, workspaceId, [next])).length) throw new ProjectValidationError("The new primary manager must be an active team member.");
      await q("INSERT INTO project_members (project_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", projectId, next, actorId, Date.now());
      await q("UPDATE projects SET primary_manager_id = ? WHERE id = ?", next, projectId);
      await revokeSpending(q, projectId, userId, "Primary manager changed: paid work billed to the previous manager was cancelled.");
    }
    await q("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", projectId, userId);
  });
}

/**
 * Transfers primary management (any management member may). The new primary manager is added as a member if
 * needed. Paid schedules pause until the new manager enables scheduled spending; queued paid work billed to the
 * old manager is cancelled — never rebilled.
 */
export async function transferPrimary(actorId: number, projectId: number, newPrimaryId: number): Promise<void> {
  await withTransaction(async (q) => {
    const { workspaceId, primaryId } = await lockManaged(q, actorId, projectId);
    if (primaryId === newPrimaryId) return;
    if (!(await activePeople(q, workspaceId, [newPrimaryId])).length) throw new ProjectValidationError("The new primary manager must be an active team member.");
    await q("INSERT INTO project_members (project_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", projectId, newPrimaryId, actorId, Date.now());
    await q("UPDATE projects SET primary_manager_id = ? WHERE id = ?", newPrimaryId, projectId);
    await revokeSpending(q, projectId, primaryId, "Primary manager changed: paid work billed to the previous manager was cancelled.");
  });
}

/**
 * Deletes a project (any management member): recoverable (deleted_at), its queued refreshes and queued paid work are
 * cancelled, and usage history stays. The Search Console / GA4 data it pointed at is untouched.
 */
export async function deleteProject(userId: number, id: number): Promise<boolean> {
  return withTransaction(async (q) => {
    try {
      await lockManaged(q, userId, id);
    } catch {
      return false;
    }
    const now = Date.now();
    await q("UPDATE projects SET deleted_at = ?, deleted_by = ?, spending_version = spending_version + 1 WHERE id = ?", now, userId, id);
    await q("UPDATE sync_jobs SET status = 'cancelled', cancelled_reason = 'project deleted', finished_at = ? WHERE project_id = ? AND status = 'queued'", now, id);
    await q("UPDATE ai_runs SET status = 'cancelled', error = 'Project deleted.', finished_at = ? WHERE project_id = ? AND status = 'queued'", now, id);
    return true;
  });
}
