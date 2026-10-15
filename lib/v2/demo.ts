// Demo fixtures for modules that have no live integration yet. Everything
// here is invented and deterministic (no randomness, no network): one
// fictional resort on a reserved .example domain, so drill-downs agree with
// each other. Never mixed with live project data; every screen and export
// that uses it is labelled Demo.

export const DEMO_PROJECT = {
  name: "Lumen Coast Resort (demo)",
  domain: "lumencoast.example",
};

export type Intent = "Informational" | "Commercial" | "Transactional" | "Navigational";

export interface DemoKeyword {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  intent: Intent;
  position: number | null;
  cluster: string;
}

const KW: [string, number, number, number, Intent, number | null, string][] = [
  ["lumen coast resort", 2900, 12, 0.8, "Navigational", 1, "Brand"],
  ["lumen coast resort reviews", 590, 9, 0.6, "Commercial", 2, "Brand"],
  ["beach resort danang", 8100, 54, 1.9, "Commercial", 14, "Beach resorts"],
  ["best beach resort in danang", 3600, 48, 2.1, "Commercial", 9, "Beach resorts"],
  ["danang resort with private beach", 1300, 41, 2.4, "Commercial", 6, "Beach resorts"],
  ["family resort danang", 1900, 38, 1.7, "Commercial", 11, "Family stays"],
  ["kids club resort vietnam", 720, 33, 1.2, "Commercial", 18, "Family stays"],
  ["resort with water park danang", 880, 36, 1.5, "Commercial", null, "Family stays"],
  ["danang honeymoon resort", 1000, 35, 2.6, "Commercial", 7, "Couples"],
  ["romantic hotel danang", 1600, 40, 1.9, "Commercial", 15, "Couples"],
  ["book lumen coast resort", 320, 5, 1.1, "Transactional", 1, "Brand"],
  ["danang resort deals", 2400, 44, 2.8, "Transactional", 21, "Offers"],
  ["danang all inclusive resort", 1900, 46, 3.1, "Transactional", 13, "Offers"],
  ["spa resort danang", 1300, 37, 1.4, "Commercial", 8, "Wellness"],
  ["danang yoga retreat", 590, 28, 1.0, "Commercial", null, "Wellness"],
  ["what to do in danang", 12100, 62, 0.4, "Informational", 34, "Destination guides"],
  ["danang weather in july", 2900, 21, 0.2, "Informational", 27, "Destination guides"],
  ["best time to visit danang", 4400, 39, 0.3, "Informational", 19, "Destination guides"],
  ["my khe beach guide", 1600, 26, 0.3, "Informational", 12, "Destination guides"],
  ["danang airport to beach", 1300, 18, 0.5, "Informational", null, "Destination guides"],
  ["ba na hills from danang", 3600, 33, 0.6, "Informational", 41, "Destination guides"],
  ["danang seafood restaurant", 2400, 31, 0.7, "Informational", null, "Dining"],
  ["resort restaurant danang", 480, 24, 0.9, "Commercial", 10, "Dining"],
  ["danang wedding venue beach", 720, 30, 2.2, "Commercial", 16, "Events"],
  ["corporate retreat vietnam", 880, 42, 3.4, "Commercial", null, "Events"],
];

export const DEMO_KEYWORDS: DemoKeyword[] = KW.map(([keyword, volume, difficulty, cpc, intent, position, cluster]) => ({
  keyword,
  volume,
  difficulty,
  cpc,
  intent,
  position,
  cluster,
}));

export interface DemoCompetitor {
  domain: string;
  estTraffic: number;
  keywords: number;
  sharedKeywords: number;
  gapKeywords: number;
}

export const DEMO_COMPETITORS: DemoCompetitor[] = [
  { domain: "lumencoast.example", estTraffic: 18400, keywords: 1240, sharedKeywords: 0, gapKeywords: 0 },
  { domain: "azure-bay.example", estTraffic: 31200, keywords: 2110, sharedKeywords: 640, gapKeywords: 410 },
  { domain: "sandpiper-villas.example", estTraffic: 22700, keywords: 1530, sharedKeywords: 520, gapKeywords: 260 },
  { domain: "coral-cove.example", estTraffic: 14900, keywords: 990, sharedKeywords: 380, gapKeywords: 150 },
  { domain: "harbor-lights.example", estTraffic: 9800, keywords: 760, sharedKeywords: 290, gapKeywords: 95 },
];

export interface DemoReferringDomain {
  domain: string;
  authority: number;
  links: number;
  firstSeen: string;
  status: "new" | "lost" | "stable";
  anchor: string;
}

export const DEMO_REFERRING_DOMAINS: DemoReferringDomain[] = [
  { domain: "travel-notes.example", authority: 64, links: 12, firstSeen: "2026-03-02", status: "stable", anchor: "Lumen Coast Resort" },
  { domain: "vietnam-guide.example", authority: 58, links: 4, firstSeen: "2026-09-21", status: "new", anchor: "beach resort in Danang" },
  { domain: "family-trips.example", authority: 47, links: 7, firstSeen: "2025-11-10", status: "stable", anchor: "kids club" },
  { domain: "honeymoon-ideas.example", authority: 52, links: 2, firstSeen: "2026-09-30", status: "new", anchor: "romantic resorts" },
  { domain: "old-directory.example", authority: 21, links: 1, firstSeen: "2024-06-18", status: "lost", anchor: "lumencoast.example" },
  { domain: "spa-weekly.example", authority: 39, links: 3, firstSeen: "2026-01-14", status: "stable", anchor: "spa resort" },
  { domain: "asia-hotels.example", authority: 61, links: 9, firstSeen: "2025-08-05", status: "stable", anchor: "Lumen Coast" },
  { domain: "events-venues.example", authority: 33, links: 1, firstSeen: "2026-10-03", status: "new", anchor: "beach wedding venue" },
];

export type ContentStage = "Brief" | "Draft" | "Internal review" | "Client review" | "Approved" | "Published";
export const CONTENT_STAGES: ContentStage[] = ["Brief", "Draft", "Internal review", "Client review", "Approved", "Published"];

export interface DemoArticle {
  title: string;
  stage: ContentStage;
  keyword: string;
  owner: string;
  due: string;
}

export const DEMO_ARTICLES: DemoArticle[] = [
  { title: "The best time to visit Danang, month by month", stage: "Published", keyword: "best time to visit danang", owner: "Writer A", due: "2026-09-12" },
  { title: "A family guide to Danang's beaches", stage: "Client review", keyword: "family resort danang", owner: "Writer B", due: "2026-10-20" },
  { title: "Honeymoon in Danang: 3-day itinerary", stage: "Internal review", keyword: "danang honeymoon resort", owner: "Writer A", due: "2026-10-24" },
  { title: "Spa and wellness at Lumen Coast", stage: "Draft", keyword: "spa resort danang", owner: "Writer C", due: "2026-10-28" },
  { title: "Getting from Danang airport to the beach", stage: "Brief", keyword: "danang airport to beach", owner: "Writer B", due: "2026-11-04" },
  { title: "Seafood near My Khe beach", stage: "Brief", keyword: "danang seafood restaurant", owner: "Writer C", due: "2026-11-08" },
  { title: "Planning a beach wedding in Danang", stage: "Approved", keyword: "danang wedding venue beach", owner: "Writer A", due: "2026-10-18" },
];

export const DEMO_MONTHLY = {
  month: "September 2026",
  kpis: [
    { label: "Organic sessions", value: 18420, target: 20000, previous: 16980 },
    { label: "AI-referral sessions", value: 640, target: 600, previous: 410 },
    { label: "Organic leads", value: 212, target: 240, previous: 198 },
    { label: "Keywords in top 10", value: 96, target: 110, previous: 88 },
  ],
  highlights: [
    "Organic sessions grew 8.5% month on month, led by destination guides.",
    "Three new referring domains, including vietnam-guide.example.",
    "The family-stays cluster gained four top-10 positions after the kids-club page update.",
  ],
  completed: ["Published the 'best time to visit' guide", "Fixed 14 redirect chains", "Added FAQ structured data to 6 pages"],
  next: ["Publish the family beach guide", "Refresh the spa landing page", "Start the wedding-venue cluster"],
};

export const DEMO_CSV_NOTE = "DEMO DATA: fictional project, not real measurements";
