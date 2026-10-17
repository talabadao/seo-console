// Migration 0014 (workspace model) on a database shaped like the previous release, PGlite: what it maps, what it
// leaves for a human decision, that it copies no secret in plain text and changes no legacy column, that a rerun
// changes nothing, and the dry-run mapping report (scripts/workspace/report.ts) on the result.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type postgres from "postgres";
import { BASELINE_STATEMENTS } from "@/lib/schema";
import { MIGRATIONS } from "@/db/migrations";
import { mappingReport } from "@/scripts/workspace/report";

const pg = new PGlite();
const W = MIGRATIONS.at(-1)!;
const rows = async (sql: string) => (await pg.query<Record<string, unknown>>(sql)).rows;
/** The report takes a postgres.js tag; it never interpolates values, so a plain adapter is enough. */
const sqlTag = (async (strings: TemplateStringsArray) => rows(strings.join(""))) as unknown as postgres.Sql;

const TABLES = ["users", "projects", "project_members", "google_connections", "asana_connections", "sites", "ga_properties", "project_settings", "provider_allowances", "workspaces", "brands"];
const snapshot = async () => {
  const out: Record<string, unknown> = {};
  for (const t of TABLES) out[t] = await rows(`SELECT * FROM ${t} ORDER BY 1, 2`);
  return JSON.stringify(out);
};

beforeAll(async () => {
  expect(W.id).toBe("0014_workspace_members");
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1, -1)) for (const s of m.statements) await pg.exec(s);
  // The previous release: one record per Google login, owning its projects, tokens in legacy plaintext columns.
  await pg.exec(`
    INSERT INTO users (id, email, google_refresh_token, google_scopes, ga_ai_domains, asana_api_token, created_at, updated_at) VALUES
      (1, 'tinledoihoa@gmail.com', 'rt-tin-plain', 'openid email', 'chatgpt.com', NULL, 0, 0),
      (2, 'analytics@artemisdigital.com', 'rt-ad-plain', 'openid email', NULL, 'asana-plain-token', 0, 0),
      (3, 'analytics@headsonpillows.com', NULL, NULL, NULL, NULL, 0, 0),
      (4, 'kin.mkt@kinhotel.com', 'rt-kin-plain', 'openid email', NULL, NULL, 0, 0),
      (5, 'Someone@ArtemisDigital.com', NULL, NULL, NULL, NULL, 0, 0);
    INSERT INTO sites (user_id, source, property, permission_level, created_at) VALUES
      (1, 'google', 'sc-domain:tin.example', 'siteOwner', 0), (2, 'google', 'sc-domain:ad.example', 'siteOwner', 0),
      (3, 'google', 'sc-domain:hop.example', 'siteOwner', 0), (4, 'google', 'sc-domain:kin.example', 'siteOwner', 0);
    INSERT INTO ga_properties (user_id, property_id, display_name, created_at) VALUES (1, '101', 'Tin', 0), (2, '201', 'AD', 0), (4, '401', 'Kin', 0);
    INSERT INTO projects (id, user_id, name, gsc_property, ga_property_id, serpapi_key, asana_project_gid, created_at, updated_at) VALUES
      (10, 1, 'Tin site', 'sc-domain:tin.example', '101', 'legacy-project-key', '', 0, 0),
      (20, 2, 'Artemis client', 'sc-domain:ad.example', '201', NULL, 'g-1', 0, 0),
      (30, 3, 'HoP client', 'sc-domain:hop.example', NULL, NULL, '', 0, 0),
      (40, 4, 'KiN Hotel', 'sc-domain:kin.example', '401', NULL, '', 0, 0);
    INSERT INTO provider_allowances (key, max_units, used_units, note, created_at, updated_at) VALUES ('serpapi-month:project:10:2026-10', 10, 4, 'x', 0, 0);
  `);
  for (const s of W.statements) await pg.exec(s);
});

describe("migration 0014", () => {
  it("makes company logins and the Gmail exception people of the workspace, the analytics accounts data connections", async () => {
    expect(await rows("SELECT id, kind, status, workspace_id FROM users ORDER BY id")).toEqual([
      { id: 1, kind: "person", status: "active", workspace_id: 1 },
      // Connection holders of the workspace, never people: they can't sign in or be given projects.
      { id: 2, kind: "shared-connection", status: "active", workspace_id: 1 },
      { id: 3, kind: "shared-connection", status: "active", workspace_id: 1 },
      { id: 4, kind: "person", status: "active", workspace_id: null }, // not an eligible domain: outside the workspace
      { id: 5, kind: "person", status: "active", workspace_id: 1 },
    ]);
    expect(await rows("SELECT name, email_domain FROM brands ORDER BY name")).toEqual([
      { name: "Artemis Digital", email_domain: "artemisdigital.com" },
      { name: "Heads on Pillows", email_domain: "headsonpillows.com" },
    ]);
  });

  it("creates one shared connection per eligible Google login, without copying any token", async () => {
    const conns = await rows("SELECT legacy_user_id, email, status, ciphertext, access_token FROM google_connections ORDER BY legacy_user_id");
    expect(conns.map((c) => [c.legacy_user_id, c.status])).toEqual([[1, "ok"], [2, "ok"], [3, "needs-reconnect"]]);
    expect(JSON.stringify(await rows("SELECT * FROM google_connections"))).not.toMatch(/plain/);
    expect(JSON.stringify(await rows("SELECT * FROM asana_connections"))).not.toMatch(/plain/);
    expect(await rows("SELECT s.property, c.legacy_user_id FROM sites s LEFT JOIN google_connections c ON c.id = s.connection_id ORDER BY s.property")).toEqual([
      { property: "sc-domain:ad.example", legacy_user_id: 2 },
      { property: "sc-domain:hop.example", legacy_user_id: 3 },
      { property: "sc-domain:kin.example", legacy_user_id: null },
      { property: "sc-domain:tin.example", legacy_user_id: 1 },
    ]);
  });

  it("maps projects: the person's own get them as manager; analytics-owned ones wait for a human manager; others stay hidden", async () => {
    const p = await rows(`SELECT p.id, p.workspace_id, b.name AS brand, p.primary_manager_id, p.created_by,
        (SELECT array_agg(user_id) FROM project_members m WHERE m.project_id = p.id) AS members,
        gc.legacy_user_id AS gsc_conn_of, ga.legacy_user_id AS ga_conn_of, p.asana_connection_id IS NOT NULL AS asana_mapped
      FROM projects p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN google_connections gc ON gc.id = p.gsc_connection_id
      LEFT JOIN google_connections ga ON ga.id = p.ga_connection_id ORDER BY p.id`);
    expect(p).toEqual([
      { id: 10, workspace_id: 1, brand: null, primary_manager_id: 1, created_by: 1, members: [1], gsc_conn_of: 1, ga_conn_of: 1, asana_mapped: false },
      { id: 20, workspace_id: 1, brand: "Artemis Digital", primary_manager_id: null, created_by: 2, members: null, gsc_conn_of: 2, ga_conn_of: 2, asana_mapped: true },
      { id: 30, workspace_id: 1, brand: "Heads on Pillows", primary_manager_id: null, created_by: 3, members: null, gsc_conn_of: 3, ga_conn_of: null, asana_mapped: false },
      { id: 40, workspace_id: null, brand: null, primary_manager_id: null, created_by: 4, members: null, gsc_conn_of: null, ga_conn_of: null, asana_mapped: false },
    ]);
    expect(await rows("SELECT project_id, ai_domains FROM project_settings WHERE ai_domains IS NOT NULL")).toEqual([{ project_id: 10, ai_domains: "chatgpt.com" }]);
  });

  it("carries the current per-project allowance to its legacy owner's personal counter and keeps the old row", async () => {
    expect(await rows("SELECT key, max_units, used_units FROM provider_allowances ORDER BY key")).toEqual([
      { key: "serpapi-month:project:10:2026-10", max_units: 10, used_units: 4 },
      { key: "serpapi-month:user:1:project:10:2026-10", max_units: 10, used_units: 4 },
    ]);
  });

  it("leaves every legacy column as it was, so the previous release still reads the data", async () => {
    expect(await rows("SELECT id, user_id, serpapi_key FROM projects ORDER BY id")).toEqual([
      { id: 10, user_id: 1, serpapi_key: "legacy-project-key" },
      { id: 20, user_id: 2, serpapi_key: null },
      { id: 30, user_id: 3, serpapi_key: null },
      { id: 40, user_id: 4, serpapi_key: null },
    ]);
    expect((await rows("SELECT google_refresh_token FROM users ORDER BY id")).map((r) => r.google_refresh_token)).toEqual(["rt-tin-plain", "rt-ad-plain", null, "rt-kin-plain", null]);
    expect((await rows("SELECT user_id FROM sites ORDER BY property")).map((r) => r.user_id)).toEqual([2, 3, 4, 1]);
  });

  it("is idempotent: running it again changes nothing", async () => {
    const before = await snapshot();
    for (const s of W.statements) await pg.exec(s);
    expect(await snapshot()).toBe(before);
  });

  it("reports what needs a human decision, with no invariant violations", async () => {
    const r = await mappingReport(sqlTag);
    expect(r.needsManager.map((x) => [x.id, x.brand])).toEqual([[20, "Artemis Digital"], [30, "Heads on Pillows"]]);
    expect(r.hidden.map((x) => x.id)).toEqual([40]);
    expect(r.legacyProjectKeys.map((x) => x.id)).toEqual([10]);
    expect(r.invariantViolations).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/plain|legacy-project-key/);
  });
});
