// Local-development mock mode for the v2 shell: lets the UI be built and
// screenshotted without a database or Google sign-in. Active only when ALL of
// these hold, so it can never run on a deployed Preview or Production:
//   - V2_MOCK=1
//   - NODE_ENV=development (next dev; deployed builds are production builds)
//   - no VERCEL_ENV (Vercel sets it on every deployment)
// The fixtures are invented (example.com domains, no tokens).

import { demoSummary } from "./summary/demo";
import { DEFAULT_COMPARE, DEFAULT_PRESET, isCompare, isPreset, resolvePeriod, type CompareMode, type RangePreset } from "./summary/period";
import { ALL_PARTS, type SummaryPart } from "./summary/types";

export function devMockEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.V2_MOCK === "1" && env.NODE_ENV === "development" && !env.VERCEL_ENV;
}

export const MOCK_USER = { email: "mock-user@example.invalid", name: "Mock user", picture: null };

const base = {
  faviconUrl: "",
  gbpLocation: null,
  gbpLocationTitle: null,
  asanaProjectGid: "",
  asanaProjectName: "",
};

const FIXTURE_PROJECTS = [
  {
    ...base,
    id: 1,
    name: "Example Hotel",
    websiteUrl: "https://example.com",
    gscProperty: "sc-domain:example.com",
    gaPropertyId: "100001",
    mapsUrl: "https://maps.app.goo.gl/example",
    hasSerpKey: true,
    asanaProjectGid: "1200000000000001",
    asanaProjectName: "Example Hotel SEO",
  },
  {
    ...base,
    id: 2,
    name: "Sample Spa",
    websiteUrl: "https://spa.example.org",
    gscProperty: "https://spa.example.org/",
    gaPropertyId: null,
    mapsUrl: "",
    hasSerpKey: false,
  },
  {
    ...base,
    id: 3,
    name: "Demo Restaurant Group",
    websiteUrl: "https://dining.example.net",
    gscProperty: null,
    gaPropertyId: null,
    mapsUrl: "",
    hasSerpKey: false,
  },
];

// More invented projects, so paging and lazy loading can be reviewed at a realistic size.
const NAMES = [
  "Harbor View Hotel", "Cedar Lane Spa", "Blue Fern Bistro", "Summit Ridge Lodge", "Old Town Bakery", "Riverside Dental",
  "Lantern Bay Resort", "Maple Court Apartments", "Coral Reef Divers", "Northwind Travel", "Golden Gate Florist",
  "Pine Hollow Camp", "Saffron Kitchen", "Willow Creek Clinic", "Seabreeze Villas", "Granite Peak Gym", "Copper Kettle Café",
  "Silverline Tours", "Meadowbrook School", "Ironwood Furniture", "Starlight Cinema", "Brightside Pediatrics",
  "Aurora Wellness", "Driftwood Inn", "Evergreen Realty", "Quayside Market", "Hilltop Winery",
];
const generated = NAMES.map((name, i) => {
  const id = 4 + i;
  const slug = name.toLowerCase().replace(/[^a-z]+/g, "");
  return {
    ...base,
    id,
    name,
    websiteUrl: `https://${slug}.example.com`,
    gscProperty: i % 6 === 5 ? null : `sc-domain:${slug}.example.com`,
    gaPropertyId: i % 4 === 3 ? null : String(200000 + id),
    mapsUrl: "",
    hasSerpKey: false,
    asanaProjectGid: i % 3 === 2 ? "" : String(1300000000000000 + id),
    asanaProjectName: i % 3 === 2 ? "" : `${name} SEO`,
  };
});

export const MOCK_PROJECTS = [...FIXTURE_PROJECTS, ...generated];

/** Responses for the API calls the shell makes on its own; anything else gets a clear mock error. */
export function mockApi(url: string): { status: number; body: unknown } {
  const path = url.split("?")[0];
  if (path === "/api/projects") return { status: 200, body: { projects: MOCK_PROJECTS } };
  if (path === "/api/sites") {
    return {
      status: 200,
      body: {
        sites: [
          { id: 1, source: "google", property: "sc-domain:example.com", lastSync: null },
          { id: 2, source: "google", property: "https://spa.example.org/", lastSync: null },
        ],
      },
    };
  }
  if (path === "/api/ga/properties") return { status: 200, body: { properties: [] } };
  if (path === "/api/pagespeed") return { status: 200, body: { pages: [], maxPages: 15 } };
  const summary = path.match(/^\/api\/v2\/summary\/(\d+)$/);
  if (summary) {
    const project = MOCK_PROJECTS.find((p) => p.id === Number(summary[1]));
    if (!project) return { status: 404, body: { error: "unknown project" } };
    const q = new URLSearchParams(url.split("?")[1] ?? "");
    const preset = isPreset(q.get("preset")) ? (q.get("preset") as RangePreset) : DEFAULT_PRESET;
    const compare = isCompare(q.get("compare")) ? (q.get("compare") as CompareMode) : DEFAULT_COMPARE;
    const parts = (q.get("parts") ?? "").split(",").filter((p): p is SummaryPart => (ALL_PARTS as string[]).includes(p));
    // Every number is demo data; connections are respected so "Not connected" shows too.
    const s = demoSummary(project, resolvePeriod(preset, compare), parts.length ? parts : ALL_PARTS, { respectConnections: true });
    // One fixture shows what a failed provider request looks like.
    if (project.id === 6 && s.ga4) s.ga4 = { state: "error", source: "Google Analytics 4", message: "Mock mode: a failed request, shown as an error rather than numbers." };
    return { status: 200, body: s };
  }
  if (path === "/api/weekly-report/config") {
    const ym = new URLSearchParams(url.split("?")[1] ?? "").get("yearMonth") ?? new Date().toISOString().slice(0, 7);
    return {
      status: 200,
      body: { yearMonth: ym, trafficOrganicTarget: 4000, trafficAiTarget: 0, leadOrganicTarget: 40, leadAiTarget: 0, leadEvents: ["generate_lead"], asanaProjectGid: "", asanaStatusTitle: "" },
    };
  }
  if (path === "/api/settings/indexing") return { status: 200, body: { autoIndexEnabled: true, autoIndexHour: 3, autoIndexCap: 100 } };
  return { status: 503, body: { error: "Mock mode: this data needs a real database and Google sign-in." } };
}
