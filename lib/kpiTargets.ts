// Monthly KPI targets — the one source the dashboard, All projects and the Weekly report read, and the one
// KPI Planning writes (table kpi_targets, migration 0007). Stored per project, metric and period ("YYYY-MM").
// - Blank (no row) means "no target": that KPI isn't shown. A stored 0 is an explicit target of zero.
// - Saves are all-or-nothing (one transaction) and optimistic: each change carries the version the editor loaded,
//   and if someone else changed that month/metric since, nothing is written and the conflicts are returned.
// - Targets are plans only: a future month has targets but never invented actual results.

import { db, tableExists, withTransaction, type TxQuery } from "@/lib/db";

export type KpiMetricId = "traffic_organic" | "traffic_ai" | "lead_organic" | "lead_ai";

export interface KpiMetricSpec {
  id: KpiMetricId;
  label: string;
  /** Column header in the planner. */
  short: string;
  unit: "sessions" | "leads";
  /** What is measured, so organic, AI and lead targets aren't confused. */
  scope: string;
  direction: "higher" | "lower";
  /** Decimal places accepted (counts are whole numbers). */
  precision: number;
  /** The field the Weekly report / dashboard config has always used for this metric. */
  legacyField: "trafficOrganicTarget" | "trafficAiTarget" | "leadOrganicTarget" | "leadAiTarget";
}

/**
 * The KPIs SEO Console measures today (GA4, through the project's linked property). Revenue and ranking targets
 * aren't measured against targets yet, so they aren't offered here.
 */
export const KPI_METRICS: KpiMetricSpec[] = [
  { id: "traffic_organic", label: "Organic sessions", short: "Organic sessions", unit: "sessions", scope: "GA4 sessions from Organic Search", direction: "higher", precision: 0, legacyField: "trafficOrganicTarget" },
  { id: "traffic_ai", label: "AI search sessions", short: "AI sessions", unit: "sessions", scope: "GA4 sessions from AI search sources (Settings → Tracking)", direction: "higher", precision: 0, legacyField: "trafficAiTarget" },
  { id: "lead_organic", label: "Organic leads", short: "Organic leads", unit: "leads", scope: "Chosen lead events from organic sessions", direction: "higher", precision: 0, legacyField: "leadOrganicTarget" },
  { id: "lead_ai", label: "AI search leads", short: "AI leads", unit: "leads", scope: "Chosen lead events from AI search sessions", direction: "higher", precision: 0, legacyField: "leadAiTarget" },
];

export const metricSpec = (id: string) => KPI_METRICS.find((m) => m.id === id);
export const MAX_TARGET = 1e12;
export const MAX_PERIODS = 60;

export const isPeriod = (p: unknown): p is string => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Every period from `from` to `to` inclusive (empty when reversed); at most MAX_PERIODS. */
export function periodRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = from; p <= to && out.length < MAX_PERIODS; p = addMonths(p, 1)) out.push(p);
  return out;
}

/** The current month in a time zone (the project's GA4 property zone; UTC when unknown or invalid). */
export function currentPeriod(timeZone: string | null, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit" }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    if (y && m) return `${y}-${m}`;
  } catch {
    // invalid zone name: fall through to UTC
  }
  return now.toISOString().slice(0, 7);
}

/** The project's GA4 time zone, as discovered by its GA4 connection (null when unknown). */
export async function projectTimeZone(project: { gaPropertyId: string | null; gaConnectionId: number | null }): Promise<string | null> {
  if (!project.gaPropertyId || project.gaConnectionId == null) return null;
  const r = (await db.prepare("SELECT time_zone FROM ga_properties WHERE connection_id = ? AND property_id = ?").get(project.gaConnectionId, project.gaPropertyId)) as
    | { time_zone: string | null }
    | undefined;
  return r?.time_zone ?? null;
}

export async function kpiTargetsReady(): Promise<boolean> {
  return tableExists("kpi_targets");
}

export interface TargetCell {
  value: number;
  updatedAt: number;
}

export type TargetGrid = Record<string, Partial<Record<KpiMetricId, TargetCell>>>;

/** Saved targets for a project between two periods (inclusive). */
export async function readTargets(projectId: number, from: string, to: string): Promise<TargetGrid> {
  const out: TargetGrid = {};
  if (!(await kpiTargetsReady())) return out;
  const rows = (await db
    .prepare("SELECT metric, period, target, updated_at FROM kpi_targets WHERE project_id = ? AND period >= ? AND period <= ? ORDER BY period")
    .all(projectId, from, to)) as unknown as Array<{ metric: string; period: string; target: number; updated_at: number }>;
  for (const r of rows) {
    if (!metricSpec(r.metric)) continue;
    (out[r.period] ??= {})[r.metric as KpiMetricId] = { value: Number(r.target), updatedAt: Number(r.updated_at) };
  }
  return out;
}

/** Targets for one month: null = blank (no target), a number (including 0) = the target. */
export async function targetsForMonth(projectId: number, period: string): Promise<Record<KpiMetricId, number | null>> {
  const grid = await readTargets(projectId, period, period);
  return Object.fromEntries(KPI_METRICS.map((m) => [m.id, grid[period]?.[m.id]?.value ?? null])) as Record<KpiMetricId, number | null>;
}

export class KpiInputError extends Error {
  constructor(
    message: string,
    readonly cells: Array<{ period: string; metric: string; message: string }> = [],
  ) {
    super(message);
    this.name = "KpiInputError";
  }
}

export class KpiConflictError extends Error {
  constructor(readonly conflicts: Array<{ period: string; metric: KpiMetricId; current: TargetCell | null }>) {
    super(`${conflicts.length} target${conflicts.length === 1 ? " was" : "s were"} changed by someone else since you opened the planner. Nothing was saved.`);
    this.name = "KpiConflictError";
  }
}

export interface TargetChange {
  period: string;
  metric: KpiMetricId;
  /** null clears the target (blank); 0 is an explicit zero target. */
  value: number | null;
  /** The cell's updatedAt when the editor loaded it; null if it was blank. */
  expectedUpdatedAt: number | null;
}

/** Validates a batch: periods, metrics, numbers, precision, duplicates. Throws KpiInputError listing every bad cell. */
export function validateChanges(raw: unknown): TargetChange[] {
  if (!Array.isArray(raw)) throw new KpiInputError("No changes to save.");
  if (raw.length > MAX_PERIODS * KPI_METRICS.length) throw new KpiInputError("Too many changes at once.");
  const cells: Array<{ period: string; metric: string; message: string }> = [];
  const seen = new Set<string>();
  const out: TargetChange[] = [];
  for (const item of raw) {
    const c = (item ?? {}) as Record<string, unknown>;
    const period = String(c.period ?? "");
    const metric = String(c.metric ?? "");
    const spec = metricSpec(metric);
    const bad = (message: string) => cells.push({ period, metric, message });
    if (!isPeriod(period)) {
      bad("Not a valid month (YYYY-MM).");
      continue;
    }
    if (!spec) {
      bad("Unknown KPI.");
      continue;
    }
    const key = `${period}|${metric}`;
    if (seen.has(key)) {
      bad("This month and KPI appear twice in one save.");
      continue;
    }
    seen.add(key);
    const expected = c.expectedUpdatedAt == null ? null : Number(c.expectedUpdatedAt);
    if (c.value === null || c.value === undefined || c.value === "") {
      out.push({ period, metric: spec.id, value: null, expectedUpdatedAt: expected });
      continue;
    }
    const v = typeof c.value === "number" ? c.value : Number(String(c.value).replace(/[,\s]/g, ""));
    if (!Number.isFinite(v)) bad("Enter a number, or leave it blank for no target.");
    else if (v < 0) bad("Targets can't be negative.");
    else if (v > MAX_TARGET) bad("That number is too large.");
    else if (Math.round(v * 10 ** spec.precision) / 10 ** spec.precision !== v) bad(spec.precision === 0 ? "Use a whole number." : `At most ${spec.precision} decimal places.`);
    else out.push({ period, metric: spec.id, value: v, expectedUpdatedAt: expected });
  }
  if (cells.length) throw new KpiInputError(`${cells.length} target${cells.length === 1 ? " isn't" : "s aren't"} valid. Nothing was saved.`, cells);
  return out;
}

async function currentCell(q: TxQuery, projectId: number, c: TargetChange, lock: boolean): Promise<TargetCell | null> {
  const rows = await q(
    `SELECT target, updated_at FROM kpi_targets WHERE project_id = ? AND metric = ? AND period = ?${lock ? " FOR UPDATE" : ""}`,
    projectId,
    c.metric,
    c.period,
  );
  return rows[0] ? { value: Number(rows[0].target), updatedAt: Number(rows[0].updated_at) } : null;
}

/**
 * Saves every change in one transaction. The caller has checked that the project is the user's. Returns the
 * number of cells written; throws KpiConflictError (nothing written) when a cell changed since it was loaded.
 */
export async function saveTargets(userId: number, projectId: number, changes: TargetChange[]): Promise<{ saved: number }> {
  if (!changes.length) return { saved: 0 };
  return withTransaction(async (q) => {
    const conflicts: KpiConflictError["conflicts"] = [];
    const now = Date.now();
    let saved = 0;
    for (const c of changes) {
      const current = await currentCell(q, projectId, c, true);
      if ((current?.updatedAt ?? null) !== c.expectedUpdatedAt) {
        conflicts.push({ period: c.period, metric: c.metric, current });
        continue;
      }
      if (c.value === null) {
        if (current) await q("DELETE FROM kpi_targets WHERE project_id = ? AND metric = ? AND period = ?", projectId, c.metric, c.period);
      } else if (current) {
        await q("UPDATE kpi_targets SET target = ?, updated_at = ?, updated_by = ? WHERE project_id = ? AND metric = ? AND period = ?", c.value, now, userId, projectId, c.metric, c.period);
      } else {
        // A blank cell: insert only if nobody created it meanwhile (two editors filling the same blank month).
        const inserted = await q(
          "INSERT INTO kpi_targets (project_id, metric, period, target, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING period",
          projectId,
          c.metric,
          c.period,
          c.value,
          now,
          userId,
        );
        if (!inserted.length) {
          conflicts.push({ period: c.period, metric: c.metric, current: await currentCell(q, projectId, c, false) });
          continue;
        }
      }
      saved++;
    }
    // Throwing rolls the whole transaction back: never "some months saved".
    if (conflicts.length) throw new KpiConflictError(conflicts);
    return { saved };
  });
}
