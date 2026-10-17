// Saved custom GA4 reports (migration 0013). Every read and write is scoped by the signed-in account AND the
// project: a report ID from another account or project is "not found", never readable or writable. Callers
// check project ownership first (getProject(user.id, projectId)); the WHERE clauses repeat it.

import { db, tableExists } from "@/lib/db";
import { LIMITS, normalizeSpec, type ReportSpec } from "./spec";

export interface SavedReport {
  id: number;
  projectId: number;
  propertyId: string;
  name: string;
  spec: ReportSpec;
  createdAt: number;
  updatedAt: number;
}

export const MAX_SAVED_PER_PROJECT = 100;

export const savedReportsAvailable = () => tableExists("ga4_saved_reports");

function toReport(r: Record<string, unknown>): SavedReport {
  const raw = typeof r.spec === "string" ? JSON.parse(r.spec) : r.spec;
  const n = normalizeSpec(raw);
  return {
    id: Number(r.id),
    projectId: Number(r.project_id),
    propertyId: String(r.property_id),
    name: String(r.name),
    // A stored definition was valid when saved; if a later rule rejects it, open it as saved for editing.
    spec: "spec" in n ? n.spec : (raw as ReportSpec),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, LIMITS.name) : "");

export async function listSaved(userId: number, projectId: number): Promise<SavedReport[]> {
  const rows = (await db
    .prepare("SELECT * FROM ga4_saved_reports WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC, id DESC")
    .all(userId, projectId)) as Record<string, unknown>[];
  return rows.map(toReport);
}

export async function getSaved(userId: number, projectId: number, id: number): Promise<SavedReport | null> {
  const r = (await db.prepare("SELECT * FROM ga4_saved_reports WHERE id = ? AND user_id = ? AND project_id = ?").get(id, userId, projectId)) as
    | Record<string, unknown>
    | undefined;
  return r ? toReport(r) : null;
}

export async function createSaved(userId: number, projectId: number, propertyId: string, name: string, spec: ReportSpec): Promise<SavedReport | "limit"> {
  const n = (await db.prepare("SELECT COUNT(*)::int AS n FROM ga4_saved_reports WHERE user_id = ? AND project_id = ?").get(userId, projectId)) as { n: number };
  if (Number(n.n) >= MAX_SAVED_PER_PROJECT) return "limit";
  const now = Date.now();
  const r = (await db
    .prepare(
      `INSERT INTO ga4_saved_reports (user_id, project_id, property_id, name, spec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?) RETURNING *`,
    )
    .get(userId, projectId, propertyId, name, JSON.stringify(spec), now, now)) as Record<string, unknown>;
  return toReport(r);
}

/** Updates name and definition, and (when given) the property the report is for. Null: not this account's. */
export async function updateSaved(
  userId: number,
  projectId: number,
  id: number,
  patch: { name: string; spec: ReportSpec; propertyId?: string },
): Promise<SavedReport | null> {
  const r = (await db
    .prepare(
      `UPDATE ga4_saved_reports SET name = ?, spec = ?::jsonb, property_id = COALESCE(?, property_id), updated_at = ?
        WHERE id = ? AND user_id = ? AND project_id = ? RETURNING *`,
    )
    .get(patch.name, JSON.stringify(patch.spec), patch.propertyId ?? null, Date.now(), id, userId, projectId)) as Record<string, unknown> | undefined;
  return r ? toReport(r) : null;
}

export async function deleteSaved(userId: number, projectId: number, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM ga4_saved_reports WHERE id = ? AND user_id = ? AND project_id = ?").run(id, userId, projectId);
  return Number(r.count ?? 0) > 0;
}
