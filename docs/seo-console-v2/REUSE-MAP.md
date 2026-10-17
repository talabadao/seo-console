# Reuse map

**Keep** = host code stays, moved into the new shell. **Adapt** = take donor (or host) code but replace storage, auth, scheduling and project lookup. **Rebuild** = new code; existing code is reference only. **Demo** = deterministic fixtures, clearly labelled. **Deferred** = phase 2 or blocked on access.

| Feature | Decision | From | Notes and target boundary |
|---|---|---|---|
| App shell, sidebar, project switcher | Rebuild | — | New `components/shell`. Host `ProjectPicker`/`ProjectManager` are reused inside it |
| Project identity | Adapt (host) | `lib/projects.ts` | Add workspace scope and a stable route key (id), keep existing rows |
| Google sign-in / OAuth | Keep | `lib/google/oauth.ts`, `lib/session.ts` | Add company allowlist only after the login-policy decision (AUDIT Q1) |
| GSC Performance + Opportunities | Keep | `lib/gscLive.ts`, `lib/opportunities.ts`, `/api/performance`, `/api/opportunities` | Wrap in shell; add freshness/coverage envelope (Milestone 04) |
| GA4 Analytics | Keep → extend | `lib/ga4.ts`, `lib/gaChannels.ts` | Templates + bounded builder (Milestone 05); AI-referral domains move from user to project/workspace |
| Weekly Report / Asana | Keep | `lib/weeklyReport.ts`, `lib/asana.ts`, `insights.ts` | KPI targets re-keyed by project (AUDIT 4.6) |
| Indexing | Keep, correct | `lib/indexer.ts`, `lib/google/indexingApi.ts` | Durable queue; eligibility-gate Indexing API (AUDIT 4.4); IndexNow separate (Milestone 09A) |
| Page Speed | Keep | `lib/pagespeed.ts`, `lib/pagespeedParse.ts` | Move cron into durable jobs; add CrUX adapter boundary (09B) |
| Reviews — Google Maps | Adapt (both) | Host `lib/serpapi.ts` + `lib/reviews.ts`; donor `src/lib/reviews/*` | Host keeps Postgres storage and credit estimates; take donor's Tripadvisor parser, coverage/stats logic and UI patterns. One review store, source-aware |
| Reviews — Tripadvisor | Adapt (donor) | `src/lib/reviews/serpapi.ts` | Into host review store with `source` column. Code only; donor review history is not imported in this phase |
| GBP public profile analysis | Rebuild | — | SerpApi listing data; evidence-based checklist (Milestone 08) |
| SE Ranking (6 tabs) | Adapt (donor) | `src/lib/seranking/{client,sync,types,competition,backlinks}.ts`, `src/components/seranking/*` | Drop `mock.ts` from live paths, drop `rateSlot` (process-local), drop header-less auth. Postgres snapshots per project; explicit project↔site mapping (Milestone 06) |
| SERP tracking (Google) | Adapt (donor) | `src/lib/tracking/{serpapi,run,analytics,visibility,types}.ts`, `src/components/tracking/*` | Do **not** import `serpKeyPool.ts` key rotation. Postgres contexts/observations; nullable positions (Milestone 07) |
| SERP tracking (Bing, Yandex, Naver) | Rebuild | — | Engine-specific SerpApi mappings, one engine per PR |
| AI Area | Adapt UI only | `src/components/brand/*`, `src/lib/brand/{dashboard,stats}` presentation | Data from Searchable (Milestone 10). Donor direct-model runs (`brand/providers.ts`, `brand/run.ts`) stay disabled/experimental |
| Articles editor | Adapt selectively (Demo) | `src/components/articles/*`, `src/lib/articles/seo.ts` | Editor + SEO checklist for the Content demo; no live Docs/WordPress publishing (Milestone 12) |
| Google Docs/Sheets helpers | Deferred | `src/lib/google/{docs,content,oauth}.ts` | Needed for future Content workflow and GBP Post Auto audit |
| WordPress publishing | Deferred | `src/lib/wordpress/*` | Previews only in phase 1; donor secrets not carried over |
| Images (generate/search/Instagram) | Deferred | `src/lib/images/*` | Not in the spec's navigation; leave in donor |
| Keyword Research, Competitive Research, Link Building | Demo | — | Fixtures for one fictional project (Milestone 12) |
| Content, Monthly Report | Demo | donor editor patterns | Milestone 12 |
| Automation (GBP Post Auto) | Rebuild (status card) | — | Linked workflow card until the Sheet/Apps Script contract is audited (Milestone 13) |
| Docs | Rebuild | — | Catalogue of existing Drive links (Milestone 13) |
| Bing Webmaster data | Deferred | host `lib/providers` | Key stored today, no data shown; not in the phase 1 spec |
| Storage layer | Rebuild | host `lib/db.ts` | Versioned migrations table; donor Blob JSON is import-only |
| Jobs, rate limits, budgets | Rebuild | — | One durable job path (Milestone 03); replaces browser-chained loops and in-request crons |
| Secrets | Rebuild | — | Encrypted columns with key version; masked reads (Milestone 02) |

## Donor code explicitly **not** imported
- `src/lib/serpKeyPool.ts` — rotates SerpApi keys on failure, including quota exhaustion.
- `src/lib/seranking/mock.ts`, `src/lib/tracking/mock.ts`, `src/lib/mock.ts` on live paths — may seed Demo fixtures only.
- `isAuthorized()` patterns that allow requests without credentials.
- `src/lib/blobJson.ts` as a primary store.
