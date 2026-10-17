// KPI Planning: the migration backfill, multi-month saves across years, blank vs zero, validation, transactional
// all-or-nothing saves, concurrent edits, the project's time zone, and the dashboard / Weekly report reading the
// same saved targets. Runs the real baseline schema and every migration on PGlite.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { pg } = await vi.hoisted(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  return { pg: new PGlite() };
});

const toPositional = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

vi.mock("@/lib/db", () => ({
  db: {
    prepare: (sql: string) => ({
      get: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows[0],
      all: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows,
      run: async (...args: unknown[]) => {
        const r = await pg.query(toPositional(sql), args);
        return { count: r.affectedRows ?? 0, rows: r.rows };
      },
    }),
  },
  tableExists: async (name: string) => (await pg.query<{ t: string | null }>("SELECT to_regclass($1) AS t", [`public.${name}`])).rows[0].t != null,
  withTransaction: async <T,>(fn: (q: (sql: string, ...args: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>) =>
    pg.transaction(async (tx) => fn(async (sql, ...args) => (await tx.query(toPositional(sql), args)).rows as Record<string, unknown>[])),
}));

import { BASELINE_STATEMENTS } from "@/lib/schema";
import { MIGRATIONS } from "@/db/migrations";
import {
  KpiConflictError,
  KpiInputError,
  addMonths,
  currentPeriod,
  periodRange,
  readTargets,
  saveTargets,
  targetsForMonth,
  validateChanges,
  type TargetChange,
} from "@/lib/kpiTargets";
import { configFor, saveConfig } from "@/lib/weeklyReport";

const backfill = MIGRATIONS.find((m) => m.id === "0007_kpi_targets")!;

beforeAll(async () => {
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  await pg.exec(`INSERT INTO users (email, created_at, updated_at) VALUES ('owner@artemisdigital.com', 0, 0), ('other@artemisdigital.com', 0, 0);`);
  await pg.exec(`
    INSERT INTO ga_properties (user_id, property_id, display_name, time_zone, created_at) VALUES (1, '111', 'Wewine', 'Asia/Ho_Chi_Minh', 0), (1, '222', 'Unlinked', NULL, 0);
    INSERT INTO projects (id, user_id, name, ga_property_id, created_at, updated_at) VALUES (1, 1, 'Wewine', '111', 0, 0), (2, 1, 'Wewine copy', '111', 0, 0), (3, 2, 'Theirs', NULL, 0, 0);
    -- Old per-property targets: 0 meant "no target".
    INSERT INTO weekly_kpi_config (user_id, property_id, year_month, traffic_organic_target, traffic_ai_target, lead_organic_target, lead_ai_target, lead_events, updated_at)
      VALUES (1, '111', '2026-09', 5000, 0, 40, 0, '[]', 1000), (1, '111', '2026-10', 5200, 300, 0, 0, '[]', 1000), (1, '222', '2026-10', 900, 0, 0, 0, '[]', 1000);`);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
});

const change = (period: string, metric: TargetChange["metric"], value: number | null, expectedUpdatedAt: number | null = null): TargetChange => ({ period, metric, value, expectedUpdatedAt });

describe("migration backfill", () => {
  it("copies every target above 0 to each project linked to the property; zeros stay blank", async () => {
    expect(await targetsForMonth(1, "2026-09")).toEqual({ traffic_organic: 5000, traffic_ai: null, lead_organic: 40, lead_ai: null });
    expect(await targetsForMonth(2, "2026-10")).toEqual({ traffic_organic: 5200, traffic_ai: 300, lead_organic: null, lead_ai: null });
    // A property with no project keeps its targets in weekly_kpi_config only.
    expect((await pg.query("SELECT COUNT(*)::int AS n FROM kpi_targets")).rows[0]).toEqual({ n: 8 });
  });

  it("is safe to run again and never overwrites a target set in KPI Planning", async () => {
    await pg.query("UPDATE kpi_targets SET target = 6000 WHERE project_id = 1 AND metric = 'traffic_organic' AND period = '2026-10'");
    for (const s of backfill.statements) await pg.exec(s);
    expect((await targetsForMonth(1, "2026-10")).traffic_organic).toBe(6000);
    expect((await pg.query("SELECT COUNT(*)::int AS n FROM kpi_targets")).rows[0]).toEqual({ n: 8 });
  });
});

describe("periods", () => {
  it("uses the project's time zone for the current month", () => {
    const lateOct = new Date("2026-10-31T20:00:00Z");
    expect(currentPeriod("Asia/Ho_Chi_Minh", lateOct)).toBe("2026-11");
    expect(currentPeriod("UTC", lateOct)).toBe("2026-10");
    expect(currentPeriod("Not/AZone", lateOct)).toBe("2026-10");
    expect(currentPeriod(null, lateOct)).toBe("2026-10");
  });

  it("builds ranges across calendar years", () => {
    expect(periodRange("2026-11", "2027-04")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"]);
    expect(addMonths("2027-12", 1)).toBe("2028-01");
    expect(periodRange("2027-01", "2031-12")).toHaveLength(60);
    expect(periodRange("2027-05", "2027-01")).toEqual([]);
  });
});

describe("saving many months", () => {
  beforeEach(async () => {
    await pg.exec("DELETE FROM kpi_targets WHERE project_id = 2");
  });

  it("saves a 2026–2027 plan and a 2027–2028 plan in one go each", async () => {
    const a = periodRange("2026-11", "2027-10").map((p, i) => change(p, "traffic_organic", 5000 + i * 100));
    expect(await saveTargets(1, 2, a)).toEqual({ saved: 12 });
    const b = periodRange("2027-07", "2028-06").flatMap((p) => [change(p, "lead_ai", 12, null)]);
    expect(await saveTargets(1, 2, b)).toEqual({ saved: 12 });
    const grid = await readTargets(2, "2026-11", "2028-06");
    expect(grid["2026-11"]?.traffic_organic?.value).toBe(5000);
    expect(grid["2027-10"]?.traffic_organic?.value).toBe(6100);
    expect(grid["2028-06"]?.lead_ai?.value).toBe(12);
    expect(Object.keys(grid)).toHaveLength(20);
  });

  it("keeps blank and an explicit zero apart", async () => {
    await saveTargets(1, 2, [change("2027-01", "traffic_ai", 0), change("2027-01", "lead_ai", 15)]);
    expect(await targetsForMonth(2, "2027-01")).toEqual({ traffic_organic: null, traffic_ai: 0, lead_organic: null, lead_ai: 15 });
    const at = (await readTargets(2, "2027-01", "2027-01"))["2027-01"]!.lead_ai!.updatedAt;
    await saveTargets(1, 2, [change("2027-01", "lead_ai", null, at)]);
    expect((await targetsForMonth(2, "2027-01")).lead_ai).toBeNull();
  });

  it("is all or nothing: one conflicting cell means nothing is written", async () => {
    await saveTargets(1, 2, [change("2027-03", "traffic_organic", 100)]);
    const stale = 1; // the editor loaded an older version than what's saved now
    await expect(
      saveTargets(1, 2, [change("2027-02", "traffic_organic", 200), change("2027-03", "traffic_organic", 300, stale), change("2027-04", "traffic_organic", 400)]),
    ).rejects.toBeInstanceOf(KpiConflictError);
    expect(await readTargets(2, "2027-02", "2027-04")).toEqual({ "2027-03": { traffic_organic: { value: 100, updatedAt: expect.any(Number) } } });
  });

  it("reports a conflict when two editors fill the same blank month", async () => {
    await saveTargets(1, 2, [change("2027-05", "traffic_ai", 10)]);
    const err = await saveTargets(1, 2, [change("2027-05", "traffic_ai", 20)]).catch((e) => e);
    expect(err).toBeInstanceOf(KpiConflictError);
    expect((err as KpiConflictError).conflicts[0]).toMatchObject({ period: "2027-05", metric: "traffic_ai", current: { value: 10 } });
    expect((await targetsForMonth(2, "2027-05")).traffic_ai).toBe(10);
  });

  it("validates every cell and lists the bad ones", () => {
    const err = (() => {
      try {
        validateChanges([
          { period: "2027-13", metric: "traffic_organic", value: 1 },
          { period: "2027-01", metric: "revenue", value: 1 },
          { period: "2027-01", metric: "traffic_organic", value: -5 },
          { period: "2027-02", metric: "traffic_organic", value: 1.5 },
          { period: "2027-03", metric: "traffic_organic", value: "abc" },
          { period: "2027-04", metric: "traffic_organic", value: 1 },
          { period: "2027-04", metric: "traffic_organic", value: 2 },
        ]);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(KpiInputError);
    expect((err as KpiInputError).cells.map((c) => c.message)).toEqual([
      "Not a valid month (YYYY-MM).",
      "Unknown KPI.",
      "Targets can't be negative.",
      "Use a whole number.",
      "Enter a number, or leave it blank for no target.",
      "This month and KPI appear twice in one save.",
    ]);
    expect(validateChanges([{ period: "2027-06", metric: "lead_organic", value: "1,200", expectedUpdatedAt: null }])[0].value).toBe(1200);
    expect(validateChanges([{ period: "2027-06", metric: "lead_organic", value: "" }])[0].value).toBeNull();
  });
});

describe("dashboard and Weekly report read the same targets", () => {
  it("configFor returns KPI Planning targets for a project's property, blank and zero apart", async () => {
    await pg.exec("DELETE FROM kpi_targets WHERE project_id = 1 AND period = '2027-02'");
    await saveTargets(1, 1, [change("2027-02", "traffic_organic", 7000), change("2027-02", "lead_organic", 0)]);
    const cfg = await configFor(1, "111", "2027-02");
    expect(cfg.targetsSource).toBe("kpi-planning");
    expect(cfg.targets).toEqual({ traffic_organic: 7000, traffic_ai: null, lead_organic: 0, lead_ai: null });
    expect(cfg.trafficOrganicTarget).toBe(7000);
  });

  it("a Weekly report save no longer changes a project's targets", async () => {
    await saveConfig(1, "111", { yearMonth: "2027-02", trafficOrganicTarget: 1, trafficAiTarget: 1, leadOrganicTarget: 1, leadAiTarget: 1, leadEvents: ["generate_lead"], asanaProjectGid: "", asanaStatusTitle: "" }, { keepTargets: true });
    expect((await configFor(1, "111", "2027-02")).targets).toMatchObject({ traffic_organic: 7000, lead_organic: 0 });
  });

  it("a property with no project keeps its own Weekly report targets", async () => {
    const cfg = await configFor(1, "222", "2026-10");
    expect(cfg.targetsSource).toBe("weekly-report");
    expect(cfg.targets).toEqual({ traffic_organic: 900, traffic_ai: null, lead_organic: null, lead_ai: null });
  });
});
