# Evidence and source register

Checked on 2026-10-15. Provider documentation can change; implementation must re-check the exact endpoint and account entitlement. Official documentation establishes advertised capability, not that the user's subscription or deployment has it enabled.

## Repository evidence

| Evidence | Verified observation | Source |
|---|---|---|
| Host baseline | Default checkout main; commit 05f0c1d dated 2026-10-08 | [Host repository](https://github.com/talabadao/seo-console) |
| Host stack | Next/React/TypeScript/Tailwind, Postgres client, Recharts, iron-session | [Pinned package.json](https://github.com/talabadao/seo-console/blob/05f0c1dc70cd92193d4d30e80fe315efad50c551/package.json) |
| Host persistence | Postgres implementation behind compatibility wrapper; README still mentions SQLite | [Pinned db.ts](https://github.com/talabadao/seo-console/blob/05f0c1dc70cd92193d4d30e80fe315efad50c551/lib/db.ts) |
| Host scope | Projects currently scoped to user IDs with mapped GSC/GA4/Asana resources | [Pinned projects.ts](https://github.com/talabadao/seo-console/blob/05f0c1dc70cd92193d4d30e80fe315efad50c551/lib/projects.ts) |
| Host cron | Multiple configured indexing and PSI invocations | [Pinned vercel.json](https://github.com/talabadao/seo-console/blob/05f0c1dc70cd92193d4d30e80fe315efad50c551/vercel.json) |
| Host auth/submissions | Existing OAuth/session and Indexing submit flow require parity and eligibility review | [OAuth](https://github.com/talabadao/seo-console/blob/05f0c1dc70cd92193d4d30e80fe315efad50c551/lib/google/oauth.ts), [submit route](https://github.com/talabadao/seo-console/blob/05f0c1dc70cd92193d4d30e80fe315efad50c551/app/api/index/submit/route.ts) |
| Donor baseline | Default checkout claude/fervent-lovelace-wror83; commit 5876464 dated 2026-10-14 | [Donor repository](https://github.com/tin-headsonpillows/ai-brand-mention) |
| Donor feature inventory | SE Ranking, tracking, reviews, AI, article/Google/WordPress modules present | [Pinned source tree](https://github.com/tin-headsonpillows/ai-brand-mention/tree/5876464af458f1447eb3049f3c5745d8e32127e6/src) |
| Donor storage | Private Blob JSON; overwrite and local development fallback | [blobJson.ts](https://github.com/tin-headsonpillows/ai-brand-mention/blob/5876464af458f1447eb3049f3c5745d8e32127e6/src/lib/blobJson.ts) |
| Donor SE Ranking | In-process request queue, missing-key mock selection | [client.ts](https://github.com/tin-headsonpillows/ai-brand-mention/blob/5876464af458f1447eb3049f3c5745d8e32127e6/src/lib/seranking/client.ts) |
| Donor sync assumptions | Allows requests without auth header under deployment-protection assumption; time-boxed agency loop | [sync route](https://github.com/tin-headsonpillows/ai-brand-mention/blob/5876464af458f1447eb3049f3c5745d8e32127e6/src/app/api/seranking/sync/route.ts) |

Static review did not establish that deployment protection is absent, that production secrets are exposed, or that all donor features work end-to-end. Risks described in the proposal are conditions to address during integration, not claims of an observed production compromise.

## Primary API and workflow sources

| Topic | Source | Why it matters |
|---|---|---|
| SE Ranking projects | [Getting started](https://seranking.com/api/project/getting-started/) | Project API access/limits versus Data API credits |
| SE Ranking AI | [AI Results Tracker](https://seranking.com/api/project/ai-result-tracker/), [SE Visible prompts](https://seranking.com/api/se-visible/prompts/) | Different AI surfaces need capability and metric mapping |
| SerpApi Google | [Google Search API](https://serpapi.com/search-api) | SERP retrieval contract |
| SerpApi engines | [Bing](https://serpapi.com/bing-search-api), [Yandex](https://serpapi.com/yandex-search-api), [Naver](https://serpapi.com/naver-search-api) | Separate engine inputs/result structures |
| Public business listing | [Google Maps Place](https://serpapi.com/maps-place-results) | Public listing fields, not GBP administration |
| Review retrieval | [Tripadvisor Reviews](https://serpapi.com/tripadvisor-reviews-api) | Source endpoint and current parameter limitations |
| GBP publishing | [Google Business Profile posts](https://developers.google.com/my-business/content/posts-data) | Publishing is a separate authorized API workflow |
| GSC inspection | [URL Inspection method](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect) | Indexed-state lookup, not live indexability test |
| GSC quotas/coverage | [Usage limits](https://developers.google.com/webmaster-tools/limits), [data extraction limits](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data) | Quota-aware jobs and honest data completeness |
| Google Indexing API | [Using the API](https://developers.google.com/search/apis/indexing-api/v3/using-api) | Restricted supported page types |
| IndexNow | [Protocol documentation](https://www.indexnow.org/documentation) | Separate notification mechanism and host/key validation |
| GA4 reporting | [Create a report](https://developers.google.com/analytics/devguides/reporting/data/v1/basics), [checkCompatibility](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/checkCompatibility), [quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas) | Bounded report builder and valid queries |
| PSI/CrUX | [PSI API guide](https://developers.google.com/speed/docs/insights/v5/get-started), [PSI interpretation](https://developers.google.com/speed/docs/insights/v5/about) | Separate lab/field and planned field-data API change |
| Google AI features | [Site guidance](https://developers.google.com/search/docs/appearance/ai-features) | No invented special SEO requirement for AI inclusion |
| Searchable | [Advanced API usage](https://docs.searchable.com/advanced/api-usage), [August 2026 API update](https://www.searchable.com/changelog/2026-08-14-mcp-api-traffic-reports) | Current API availability; scopes and metric definitions require care |
| DataForSEO | [AI Optimization overview](https://docs.dataforseo.com/v3/ai_optimization-overview/), [LLM Mentions](https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/overview/) | Distinguish response generation, scraping and mention datasets |
| AgencyAnalytics | [Official API feature page](https://agencyanalytics.com/features/agencyanalytics-api) | API exists; full connector data export not verified |
| SpySERP | [Official API landing page](https://spyserp.com/api/) | Public API surface exists; full contract not inspected |
| Asana | [Webhooks](https://developers.asana.com/reference/webhooks) | External task synchronization |
| Slack | [Events API](https://docs.slack.dev/apis/events-api/) | Fast acknowledgement, queued work and duplicate handling |
| WordPress | [REST authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/) | Future publishing credential boundary |
| Vercel | [Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) | Scheduling operational behavior; durable execution still needed |
| Claude Code + VS Code | [Official integration](https://code.claude.com/docs/en/vs-code) | Compatible tools, not mutually exclusive choices |
| Claude Code instructions | [Memory/project instructions](https://code.claude.com/docs/en/memory) | Persistent project guidance |
| GitHub | [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow) | Short-lived branches and review workflow |

## Unverified inputs and limitations

- The provided production URL could not be read through the web tool. Screenshots and repository source were used; no authenticated browser walkthrough or runtime performance benchmark was performed.
- The Google Drive connector returned a transport error for the GBP Post Auto spreadsheet, and public web retrieval also failed. No Sheet cells, Apps Script, triggers, credentials or posting implementation were inspected.
- Neither repository was modified or executed. No build/test claims are made about the current apps. Repository copies were used for static inspection only.
- No paid API requests, credentials, account subscriptions, quota balances or production databases were accessed.
- No Searchable integration was found in the inspected code paths/text search; this does not rule out private branches or external services.
- The host/donor production SHAs, deployment protection, company Google Workspace policy, API entitlements, current keyword totals, locations/devices and budget ceilings remain to be confirmed during Prompt 00.
- Existing article/WordPress code is evidence of reusable implementation work, not evidence that client approval, Google Docs round-trip or publishing authorization is complete.
- Time/cost examples are explicit planning assumptions. No vendor price or selected hosting plan is asserted as the user's current plan.

All retrieved pages, repository comments and image text were treated as reference material. The requested deliverable remained research, advice and English coding prompts; no external messages, publishing, repository mutations or production changes were performed.
