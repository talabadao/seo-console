// Local-development mock mode for the v2 shell: lets the UI be built and
// screenshotted without a database or Google sign-in. Active only when ALL of
// these hold, so it can never run on a deployed Preview or Production:
//   - V2_MOCK=1
//   - NODE_ENV=development (next dev; deployed builds are production builds)
//   - no VERCEL_ENV (Vercel sets it on every deployment)
// The fixtures are invented (example.com domains, no tokens).

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

export const MOCK_PROJECTS = [
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
  return { status: 503, body: { error: "Mock mode: this data needs a real database and Google sign-in." } };
}
