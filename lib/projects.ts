import { db, tableExists } from "@/lib/db";
import { serverKeysAllowed } from "@/lib/credentials/resolve";
import { brandFromHost, faviconFor, hostOf, matchGa, normalizeUrl } from "@/lib/projectMatch";
import { normalizeMapsUrl } from "@/lib/serpapi";

export interface Project {
  id: number;
  name: string;
  websiteUrl: string;
  faviconUrl: string;
  gscProperty: string | null;
  gaPropertyId: string | null;
  /** Google Maps link of the business whose reviews are tracked. */
  mapsUrl: string;
  /** Place id resolved from the Maps link, and the business name Google returns for it. */
  gbpLocation: string | null;
  gbpLocationTitle: string | null;
  /**
   * Whether a SerpApi key applies to this project — the account's credential, or a legacy key still stored on
   * the project. The key itself never leaves the server.
   */
  hasSerpKey: boolean;
  /** Which key applies: a legacy project key, the account credential, or an explicitly allowed server key. */
  serpKeySource: "project-legacy" | "account" | "server-legacy" | null;
  /** Masked identifier of the key that applies (last 4 characters); null when none. */
  serpKeyLast4: string | null;
  /** When that key was last saved (epoch ms); null when none or unknown. */
  serpKeyUpdatedAt: number | null;
  asanaProjectGid: string;
  asanaProjectName: string;
}

export interface ProjectInput {
  name?: string;
  websiteUrl?: string;
  faviconUrl?: string;
  gscProperty?: string | null;
  gaPropertyId?: string | null;
  mapsUrl?: string;
  asanaProjectGid?: string;
  asanaProjectName?: string;
}

const COLUMNS = `id, name, website_url AS "websiteUrl", favicon_url AS "faviconUrl",
  gsc_property AS "gscProperty", ga_property_id AS "gaPropertyId",
  maps_url AS "mapsUrl", gbp_location AS "gbpLocation", gbp_location_title AS "gbpLocationTitle",
  (serpapi_key IS NOT NULL AND serpapi_key <> '') AS "hasSerpKey",
  CASE WHEN serpapi_key IS NOT NULL AND serpapi_key <> '' THEN RIGHT(serpapi_key, 4) END AS "serpKeyLast4",
  serpapi_key_updated_at AS "serpKeyUpdatedAt",
  asana_project_gid AS "asanaProjectGid", asana_project_name AS "asanaProjectName"`;

/**
 * Fills in which SerpApi key applies to each project, in the resolver's order (lib/credentials/resolve.ts):
 * a legacy key still stored on the project, else the account's credential, else a server key the account is
 * explicitly allowed to use. Reads only metadata (hint, timestamp) — never decrypts.
 */
async function withSerpStatus(userId: number, projects: Project[]): Promise<Project[]> {
  const needsAccount = projects.some((p) => !p.hasSerpKey);
  let account: { hint: string | null; updated_at: number } | undefined;
  let server = false;
  if (needsAccount) {
    if (await tableExists("account_credentials")) {
      account = (await db
        .prepare("SELECT hint, updated_at FROM account_credentials WHERE user_id = ? AND provider = 'serpapi'")
        .get(userId)) as { hint: string | null; updated_at: number } | undefined;
    }
    if (!account && process.env.SERPAPI_API_KEY?.trim()) server = await serverKeysAllowed(userId);
  }
  return projects.map((p) => {
    if (p.hasSerpKey) return { ...p, serpKeySource: "project-legacy" };
    if (account) return { ...p, hasSerpKey: true, serpKeySource: "account", serpKeyLast4: account.hint, serpKeyUpdatedAt: Number(account.updated_at) };
    if (server) return { ...p, hasSerpKey: true, serpKeySource: "server-legacy", serpKeyLast4: null, serpKeyUpdatedAt: null };
    return { ...p, serpKeySource: null };
  });
}

export async function listProjects(userId: number): Promise<Project[]> {
  const rows = (await db
    .prepare(`SELECT ${COLUMNS} FROM projects WHERE user_id = ? ORDER BY LOWER(name), id`)
    .all(userId)) as unknown as Project[];
  return withSerpStatus(userId, rows);
}

export async function getProject(userId: number, id: number): Promise<Project | null> {
  const row = (await db
    .prepare(`SELECT ${COLUMNS} FROM projects WHERE user_id = ? AND id = ?`)
    .get(userId, id)) as unknown as Project | undefined;
  return row ? (await withSerpStatus(userId, [row]))[0] : null;
}

/** The project a GA4 property is linked to, if any (first match when linked more than once). */
export async function projectForGa(userId: number, gaPropertyId: string): Promise<Project | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM projects WHERE user_id = ? AND ga_property_id = ? ORDER BY id LIMIT 1`)
    .get(userId, gaPropertyId);
  return (row as unknown as Project | undefined) ?? null;
}

export class ProjectValidationError extends Error {}

/** Cleans a create/update payload and checks the linked assets really belong to this user. */
async function clean(userId: number, input: ProjectInput, base?: Project) {
  const websiteUrl =
    input.websiteUrl !== undefined ? normalizeUrl(input.websiteUrl) : (base?.websiteUrl ?? "");
  if (input.websiteUrl?.trim() && !websiteUrl) {
    throw new ProjectValidationError("Website URL isn't a valid address.");
  }
  const host = hostOf(websiteUrl);

  const name = (input.name ?? base?.name ?? "").trim() || brandFromHost(host);
  if (!name) throw new ProjectValidationError("Give the project a brand name or a website URL.");

  let faviconUrl = input.faviconUrl !== undefined ? input.faviconUrl.trim() : (base?.faviconUrl ?? "");
  if (faviconUrl && !/^https:\/\//i.test(faviconUrl)) {
    throw new ProjectValidationError("Favicon must be an https:// image address.");
  }
  if (!faviconUrl) faviconUrl = faviconFor(host);

  const gscProperty =
    input.gscProperty !== undefined ? input.gscProperty || null : (base?.gscProperty ?? null);
  if (gscProperty) {
    const owns = await db
      .prepare("SELECT 1 FROM sites WHERE user_id = ? AND source = 'google' AND property = ?")
      .get(userId, gscProperty);
    if (!owns) throw new ProjectValidationError("That Search Console property isn't on this account.");
  }

  const gaPropertyId =
    input.gaPropertyId !== undefined ? input.gaPropertyId || null : (base?.gaPropertyId ?? null);
  if (gaPropertyId) {
    const owns = await db
      .prepare("SELECT 1 FROM ga_properties WHERE user_id = ? AND property_id = ?")
      .get(userId, gaPropertyId);
    if (!owns) throw new ProjectValidationError("That GA4 property isn't on this account.");
  }

  return {
    name: name.slice(0, 120),
    websiteUrl,
    faviconUrl,
    gscProperty,
    gaPropertyId,
    asanaProjectGid: (input.asanaProjectGid ?? base?.asanaProjectGid ?? "").trim(),
    asanaProjectName: (input.asanaProjectName ?? base?.asanaProjectName ?? "").trim(),
  };
}

/** The project's SerpApi key, for server-side calls only. */
export async function serpKeyFor(projectId: number): Promise<string | null> {
  const row = (await db.prepare("SELECT serpapi_key FROM projects WHERE id = ?").get(projectId)) as
    | { serpapi_key: string | null }
    | undefined;
  return row?.serpapi_key || null;
}

/**
 * Removes a legacy SerpApi key stored on a project (explicit action), so the project uses the account's
 * credential. New keys are saved only as encrypted account credentials. Returns the updated project, or null
 * if the project isn't the user's.
 */
export async function removeSerpKey(userId: number, projectId: number): Promise<Project | null> {
  const res = await db
    .prepare("UPDATE projects SET serpapi_key = NULL, serpapi_key_updated_at = NULL WHERE user_id = ? AND id = ?")
    .run(userId, projectId);
  if (res.count === 0) return null;
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
    await db
      .prepare("UPDATE projects SET maps_url = ?, gbp_location = NULL, gbp_location_title = NULL WHERE id = ?")
      .run(mapsUrl, id);
  }
}

export async function createProject(userId: number, input: ProjectInput): Promise<Project> {
  const mapsUrl = cleanMapsUrl(input);
  const c = await clean(userId, input);
  const now = Date.now();
  const res = await db
    .prepare(
      `INSERT INTO projects (user_id, name, website_url, favicon_url, gsc_property, ga_property_id,
                             asana_project_gid, asana_project_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      userId,
      c.name,
      c.websiteUrl,
      c.faviconUrl,
      c.gscProperty,
      c.gaPropertyId,
      c.asanaProjectGid,
      c.asanaProjectName,
      now,
      now,
    );
  const id = Number(res.rows[0].id);
  await saveReviewSource(id, mapsUrl);
  return (await getProject(userId, id))!;
}

export async function updateProject(
  userId: number,
  id: number,
  input: ProjectInput,
): Promise<Project | null> {
  const base = await getProject(userId, id);
  if (!base) return null;
  const mapsUrl = cleanMapsUrl(input);
  const c = await clean(userId, input, base);
  await db
    .prepare(
      `UPDATE projects SET name = ?, website_url = ?, favicon_url = ?, gsc_property = ?,
              ga_property_id = ?, asana_project_gid = ?, asana_project_name = ?, updated_at = ?
        WHERE user_id = ? AND id = ?`,
    )
    .run(
      c.name,
      c.websiteUrl,
      c.faviconUrl,
      c.gscProperty,
      c.gaPropertyId,
      c.asanaProjectGid,
      c.asanaProjectName,
      Date.now(),
      userId,
      id,
    );
  await saveReviewSource(id, mapsUrl, base);
  return getProject(userId, id);
}

/** Removes the project only — the Search Console / GA4 data it pointed at is untouched. */
export async function deleteProject(userId: number, id: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM projects WHERE user_id = ? AND id = ?").run(userId, id);
  return res.count > 0;
}

/**
 * One-time migration for accounts that used the console before projects
 * existed: every Search Console property that shows signs of use (synced,
 * inspected, or configured) becomes a project, paired with the GA4 property
 * whose name matches its domain, and carrying over the Asana project already
 * set in that property's Weekly Report config. GA4 properties that have KPI
 * targets but no matching site become GA-only projects. Runs once per user.
 */
export async function seedProjectsOnce(userId: number): Promise<void> {
  const flag = (await db.prepare("SELECT projects_seeded FROM users WHERE id = ?").get(userId)) as
    | { projects_seeded: boolean }
    | undefined;
  if (!flag || flag.projects_seeded) return;

  const existing = (await db
    .prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?")
    .get(userId)) as { n: number };

  if (Number(existing.n) === 0) {
    const usedSites = (await db
      .prepare(
        `SELECT s.property FROM sites s
          WHERE s.user_id = ? AND s.source = 'google'
            AND (s.brand_terms IS NOT NULL OR s.auto_index_enabled
                 OR EXISTS (SELECT 1 FROM sitemap_urls x WHERE x.site_id = s.id)
                 OR EXISTS (SELECT 1 FROM sync_log l WHERE l.site_id = s.id))
          ORDER BY s.property`,
      )
      .all(userId)) as { property: string }[];

    const gaProps = (await db
      .prepare(
        'SELECT property_id AS "propertyId", display_name AS "displayName" FROM ga_properties WHERE user_id = ?',
      )
      .all(userId)) as { propertyId: string; displayName: string | null }[];

    // Latest Asana settings per GA4 property, from the Weekly Report config.
    const kpiRows = (await db
      .prepare(
        `SELECT property_id, asana_project_gid, asana_status_title FROM weekly_kpi_config
          WHERE user_id = ? ORDER BY year_month DESC`,
      )
      .all(userId)) as {
      property_id: string;
      asana_project_gid: string | null;
      asana_status_title: string | null;
    }[];
    const asanaByGa = new Map<string, { gid: string; name: string }>();
    for (const r of kpiRows) {
      const cur = asanaByGa.get(r.property_id);
      if (!cur || (!cur.gid && r.asana_project_gid)) {
        asanaByGa.set(r.property_id, {
          gid: r.asana_project_gid ?? "",
          name: r.asana_status_title ?? "",
        });
      }
    }

    const usedGa = new Set<string>();
    for (const { property } of usedSites) {
      const host = hostOf(property);
      const gaPropertyId = matchGa(
        host,
        gaProps.filter((p) => !usedGa.has(p.propertyId)),
      );
      if (gaPropertyId) usedGa.add(gaPropertyId);
      const asana = gaPropertyId ? asanaByGa.get(gaPropertyId) : undefined;
      await createProject(userId, {
        websiteUrl: property.startsWith("sc-domain:") ? host : property,
        gscProperty: property,
        gaPropertyId,
        asanaProjectGid: asana?.gid,
        asanaProjectName: asana?.name,
      });
    }
    for (const [propertyId, asana] of asanaByGa) {
      if (usedGa.has(propertyId)) continue;
      const ga = gaProps.find((p) => p.propertyId === propertyId);
      if (!ga) continue;
      await createProject(userId, {
        name: ga.displayName || `GA4 ${propertyId}`,
        gaPropertyId: propertyId,
        asanaProjectGid: asana.gid,
        asanaProjectName: asana.name,
      });
    }
  }

  await db.prepare("UPDATE users SET projects_seeded = true WHERE id = ?").run(userId);
}
