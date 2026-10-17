// Project-level settings (table project_settings, migration 0002).
//
// Lead events — which GA4 events count as "leads" — have one source of truth
// per project, shared by the project dashboard, GA4 reports and the Weekly
// Report. Before 0002 they were chosen in the Weekly Report per GA4 property
// and month; until a project saves its own list, the most recent of those
// selections is used, so nothing is reset. On a database without the new
// table (Production before its migration), reads and writes use that legacy
// location exactly as before.

import { db, tableExists } from "@/lib/db";

export type LeadEventsSource = "project" | "weekly-report" | "none";

export interface LeadEventsSetting {
  events: string[];
  /** Where the list came from: the project setting, the legacy Weekly Report selection, or nothing yet. */
  source: LeadEventsSource;
  /** Legacy month the list was taken from, when source is "weekly-report". */
  legacyMonth: string | null;
  /** False when the database hasn't run migration 0002 yet. */
  projectLevelAvailable: boolean;
}

function parseList(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : null;
  } catch {
    return null;
  }
}

/**
 * The newest non-empty Weekly Report selection for a GA4 property, if any. Those selections were saved per login;
 * the property's project now owns its lead events, so any team member's older selection is the fallback (the
 * viewer's own first).
 */
async function legacyLeadEvents(userId: number, propertyId: string): Promise<{ events: string[]; month: string } | null> {
  const rows = (await db
    .prepare(
      `SELECT year_month, lead_events FROM weekly_kpi_config
        WHERE property_id = ? ORDER BY year_month DESC, (user_id = ?) DESC, updated_at DESC`,
    )
    .all(propertyId, userId)) as { year_month: string; lead_events: string }[];
  for (const r of rows) {
    const list = parseList(r.lead_events);
    if (list && list.length) return { events: list, month: r.year_month };
  }
  return null;
}

export async function leadEventsFor(
  userId: number,
  project: { id: number; gaPropertyId: string | null },
): Promise<LeadEventsSetting> {
  const available = await tableExists("project_settings");
  if (available) {
    const row = (await db.prepare("SELECT lead_events FROM project_settings WHERE project_id = ?").get(project.id)) as
      | { lead_events: string | null }
      | undefined;
    const list = parseList(row?.lead_events);
    if (list) return { events: list, source: "project", legacyMonth: null, projectLevelAvailable: true };
  }
  const legacy = project.gaPropertyId ? await legacyLeadEvents(userId, project.gaPropertyId) : null;
  return legacy
    ? { events: legacy.events, source: "weekly-report", legacyMonth: legacy.month, projectLevelAvailable: available }
    : { events: [], source: "none", legacyMonth: null, projectLevelAvailable: available };
}

/**
 * Saves the project's lead events. Without the project_settings table the list
 * is written where the Weekly Report has always kept it (every saved month of
 * the property), so behaviour matches the pre-0002 app.
 */
export async function saveLeadEvents(
  userId: number,
  project: { id: number; gaPropertyId: string | null },
  events: string[],
): Promise<LeadEventsSource> {
  const clean = [...new Set(events.map((e) => e.trim()).filter(Boolean))];
  if (await tableExists("project_settings")) {
    await db
      .prepare(
        `INSERT INTO project_settings (project_id, lead_events, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET lead_events = EXCLUDED.lead_events, updated_at = EXCLUDED.updated_at`,
      )
      .run(project.id, JSON.stringify(clean), Date.now());
    return "project";
  }
  if (!project.gaPropertyId) throw new Error("Link a GA4 property before choosing lead events.");
  const updated = await db
    .prepare("UPDATE weekly_kpi_config SET lead_events = ?, updated_at = ? WHERE user_id = ? AND property_id = ?")
    .run(JSON.stringify(clean), Date.now(), userId, project.gaPropertyId);
  if (!updated.count) {
    await db
      .prepare("INSERT INTO weekly_kpi_config (user_id, property_id, year_month, lead_events, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, project.gaPropertyId, new Date().toISOString().slice(0, 7), JSON.stringify(clean), Date.now());
  }
  return "weekly-report";
}

/** The SE Ranking site chosen for a project; null = match by website (or no table yet). */
export async function seRankingSiteFor(projectId: number): Promise<number | null> {
  if (!(await tableExists("project_settings"))) return null;
  const row = (await db.prepare("SELECT seranking_site_id FROM project_settings WHERE project_id = ?").get(projectId)) as
    | { seranking_site_id: number | null }
    | undefined;
  return row?.seranking_site_id ?? null;
}

export async function saveSeRankingSite(projectId: number, siteId: number | null): Promise<void> {
  if (!(await tableExists("project_settings"))) throw new Error("This database needs migration 0002 before an SE Ranking project can be chosen.");
  await db
    .prepare(
      `INSERT INTO project_settings (project_id, seranking_site_id, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET seranking_site_id = EXCLUDED.seranking_site_id, updated_at = EXCLUDED.updated_at`,
    )
    .run(projectId, siteId, Date.now());
}
