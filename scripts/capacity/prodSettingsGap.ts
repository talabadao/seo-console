// Read-only: what Production projects of the allowlisted accounts still need for v2 (SE Ranking mapping, KPI
// targets, lead events, SerpApi key source). Prints project names and yes/no flags only — no keys or data values.
//   npx tsx --env-file=<protected file> scripts/capacity/prodSettingsGap.ts
import postgres from "postgres";
// The five accounts of the limited pilot (before the workspace model replaced the allowlist).
const ALLOWED_EMAILS = ["analytics@headsonpillows.com", "analytics@artemisdigital.com", "tinledoihoa@gmail.com", "tin@headsonpillows.com", "tin@artemisdigital.com"];

const sql = postgres(process.env.MIGRATE_DATABASE_URL!, { max: 1, onnotice: () => {} });
const rows = (await sql.begin("READ ONLY", (tx) =>
  tx.unsafe(
    `SELECT u.email, p.id, p.name, p.website_url <> '' AS website, p.gsc_property IS NOT NULL AND p.gsc_property <> '' AS gsc,
            p.ga_property_id IS NOT NULL AND p.ga_property_id <> '' AS ga4, p.asana_project_gid <> '' AS asana,
            p.maps_url <> '' AS maps, (p.serpapi_key IS NOT NULL AND p.serpapi_key <> '') AS project_serp_key,
            s.seranking_site_id IS NOT NULL AS seranking_mapped,
            (s.lead_events IS NOT NULL AND s.lead_events::text NOT IN ('', '[]', 'null')) AS lead_events,
            (SELECT COUNT(*)::int FROM kpi_targets k WHERE k.project_id = p.id) AS kpi_targets,
            EXISTS (SELECT 1 FROM account_credentials c WHERE c.user_id = u.id AND c.provider = 'serpapi') AS account_serp_key
       FROM projects p JOIN users u ON u.id = p.user_id LEFT JOIN project_settings s ON s.project_id = p.id
      ORDER BY u.email, p.id`,
  ),
)) as unknown as Array<Record<string, unknown>>;
await sql.end();
const allowed = new Set(ALLOWED_EMAILS.map((e) => e.toLowerCase()));
const yn = (v: unknown) => (v ? "yes" : "-");
let last = "";
for (const r of rows) {
  const email = String(r.email).toLowerCase();
  if (!allowed.has(email)) continue;
  if (email !== last) {
    console.log(`\n${email}  (account SerpApi key: ${yn(r.account_serp_key)})`);
    last = email;
  }
  console.log(
    `  #${r.id} ${r.name} | site ${yn(r.website)} | GSC ${yn(r.gsc)} | GA4 ${yn(r.ga4)} | Asana ${yn(r.asana)} | Maps ${yn(r.maps)} | project SerpApi key ${yn(r.project_serp_key)} | SE Ranking mapped ${yn(r.seranking_mapped)} | lead events ${yn(r.lead_events)} | KPI targets ${r.kpi_targets}`,
  );
}
console.log(`\n${rows.filter((r) => !allowed.has(String(r.email).toLowerCase())).length} project(s) belong to accounts that are not allowlisted (cannot sign in; not listed).`);
