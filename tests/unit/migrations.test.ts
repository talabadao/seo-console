import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "@/db/migrations";
import { checksumOf, describeTarget, planMigrations, type Migration } from "@/lib/migrations";
import { BASELINE_COLUMNS, BASELINE_DDL, BASELINE_STATEMENTS } from "@/lib/schema";

const m = (id: string, ...statements: string[]): Migration => ({ id, description: id, statements });

describe("planMigrations", () => {
  const a = m("0001_a", "SELECT 1");
  const b = m("0002_b", "SELECT 2");

  it("lists unapplied migrations in order", () => {
    expect(planMigrations([a, b], []).pending.map((x) => x.id)).toEqual(["0001_a", "0002_b"]);
    expect(
      planMigrations([a, b], [{ id: "0001_a", checksum: checksumOf(a) }]).pending.map((x) => x.id),
    ).toEqual(["0002_b"]);
  });

  it("detects an applied migration that was edited afterwards", () => {
    const plan = planMigrations([m("0001_a", "SELECT 99")], [{ id: "0001_a", checksum: checksumOf(a) }]);
    expect(plan.changed).toEqual(["0001_a"]);
  });

  it("detects history the code doesn't know about", () => {
    expect(planMigrations([a], [{ id: "0009_future", checksum: "x" }]).unknown).toEqual(["0009_future"]);
  });

  it("rejects duplicate ids and out-of-order lists", () => {
    expect(() => planMigrations([a, a], [])).toThrow(/Duplicate/);
    expect(() => planMigrations([b, a], [])).toThrow(/order/);
  });
});

describe("registered migrations", () => {
  it("registers every migration file under db/migrations, in order", async () => {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync("db/migrations")
      .filter((f) => /^d{4}_.+.ts$/.test(f))
      .map((f) => f.replace(/.ts$/, ""))
      .sort();
    expect(MIGRATIONS.map((m) => m.id)).toEqual(files);
  });
});

describe("baseline migration", () => {
  it("is the first migration and uses the app's own schema statements", () => {
    expect(MIGRATIONS[0].id).toBe("0001_baseline");
    expect(MIGRATIONS[0].statements).toBe(BASELINE_STATEMENTS);
  });

  it("is idempotent: every CREATE and ADD COLUMN is guarded", () => {
    const creates = BASELINE_DDL.match(/CREATE (TABLE|INDEX)\b[^(;]*/g) ?? [];
    expect(creates.length).toBeGreaterThan(10);
    for (const c of creates) expect(c).toMatch(/IF NOT EXISTS/);
    for (const s of BASELINE_STATEMENTS.slice(1, 1 + BASELINE_COLUMNS.length)) {
      expect(s).toMatch(/^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS /);
    }
  });

  it("has a stable sha-256 checksum", () => {
    expect(checksumOf(MIGRATIONS[0])).toBe(checksumOf({ ...MIGRATIONS[0] }));
    expect(checksumOf(MIGRATIONS[0])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("describeTarget", () => {
  it("never includes credentials", () => {
    const d = describeTarget("postgres://user:s3cret@ep-x.neon.tech/neondb?sslmode=require");
    expect(d).toBe("ep-x.neon.tech/neondb");
    expect(d).not.toMatch(/s3cret|user/);
  });
});
