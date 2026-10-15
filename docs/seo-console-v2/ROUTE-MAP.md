# Route map

## Existing host addresses (production `05f0c1d`)

All UI addresses are served by `app/[[...path]]/page.tsx`; `Dashboard.tsx` keeps the address in sync with `history.pushState`.

| Address | View |
|---|---|
| `/` | Last-used project (localStorage), default tab Performance |
| `/<project-slug>/performance` | GSC Performance |
| `/<project-slug>/opportunities[/<kind>]` | kinds: `cannibalization`, `keyword-topics`, `low-hanging`, `underperforming`, `branding-keywords` |
| `/<project-slug>/analytics[/<sub>]` | subs: `source-medium`, `key-events`, `landing-pages`, `geo` |
| `/<project-slug>/weekly-report[/<sub>]` | subs: `overview`, `insights` |
| `/<project-slug>/indexing` | Indexing |
| `/<project-slug>/pagespeed` | Page Speed |
| `/<project-slug>/reviews` | Google Maps reviews |
| `/<tab>` | Tab with the last-used project |

`<project-slug>` = slugified project name, with `-<id>` appended only when two projects share a name. It changes when the project is renamed.

## v2 addresses (implemented in Milestone 01b, PR #7, behind `V2_SHELL=1`)

Project identity in the address is the immutable project id (spec §2), never the name. Defined in `lib/v2/nav.ts`; every address below is reachable from the sidebar.

| v2 address | Status in 01b | Replaces |
|---|---|---|
| `/portfolio` | Live: the account's own projects | — (All projects) |
| `/portfolio/<group>/<item>` | Live: choose a project for a project-only page | — |
| `/p/<id>/dashboard/overview` | Live: project dashboard (PR #8) | — |
| `/p/<id>/search-console/performance` | Live (existing view) | `/<slug>/performance` |
| `/p/<id>/search-console/opportunities[/<kind>]` | Live (existing view) | `/<slug>/opportunities/<kind>` |
| `/p/<id>/analytics/overview[/<sub>]` | Live (existing view) | `/<slug>/analytics/<sub>` |
| `/p/<id>/reports/weekly[/<sub>]` | Live (existing view) | `/<slug>/weekly-report/<sub>` |
| `/p/<id>/reports/monthly` | Demo | — |
| `/p/<id>/technical-seo/pagespeed` | Live (existing view) | `/<slug>/pagespeed` |
| `/p/<id>/technical-seo/indexing` | Live (existing view) | `/<slug>/indexing` |
| `/p/<id>/technical-seo/site-audit` | Planned (09c) | — |
| `/p/<id>/technical-seo/structured-data` | **Planned (09d): Structured Data / Schema placeholder** | — |
| `/p/<id>/local-seo/reviews` | Live (existing view) | `/<slug>/reviews` |
| `/p/<id>/local-seo/business-profile` | Planned (08) | — |
| `/p/<id>/organic-serp/se-ranking` | Planned (06) | — |
| `/p/<id>/organic-serp/<engine>` (`google`, `bing`, `yandex`, `naver`) | Planned (07) | — |
| `/p/<id>/keyword-research/explorer` | Demo | — |
| `/p/<id>/competitive-research/overview` | Demo | — |
| `/p/<id>/link-building/backlinks` | Demo | — |
| `/p/<id>/content/board` | Demo | — |
| `/p/<id>/ai-area/overview` | Planned (10) | — |
| `/p/<id>/automation/workflows` | Planned (13) | — |
| `/p/<id>/settings/project[/<section>]` | Live: sections general, integrations, kpi, tracking, budgets, sync (PR #8) | Settings panel / project manager |
| `/docs` | Planned (13) | — |

## Compatibility behaviour
1. Keep `app/[[...path]]/page.tsx` as the compatibility entry. Paths that start with a known v2 prefix (`p`, `portfolio`, `docs`) are handled by the new shell; anything else is treated as a legacy address. A project whose legacy slug is exactly `p`, `portfolio` or `docs` is reachable only through its v2 address.
2. *(Milestone 01d, not yet built.)* A legacy `/<slug>/<tab>[/<sub>]` resolves the slug against the signed-in user's projects (same rule as today) and **replaces** the history entry with the v2 address, so bookmarks keep working and Back does not bounce.
3. `/` and `/<tab>` keep using the last-used project.
4. An unknown slug or a project the user can't access lands on `/portfolio` with a notice, never on another project's data.
5. While the new shell is behind a feature flag, the legacy Dashboard keeps serving legacy addresses unchanged (implemented in 01b; with the flag on it links to the new console).
6. API routes stay where they are; new module APIs are added under their own prefixes. No API route is renamed in phase 1.
