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

## Proposed v2 addresses

Project identity in the address uses the immutable project id (spec §2). A readable name may follow the id for humans but is ignored when resolving.

| v2 address | Replaces |
|---|---|
| `/portfolio` | — (All projects) |
| `/p/<id>/dashboard` | — |
| `/p/<id>/search-console/performance` | `/<slug>/performance` |
| `/p/<id>/search-console/opportunities/<kind>` | `/<slug>/opportunities/<kind>` |
| `/p/<id>/analytics/<view>` | `/<slug>/analytics/<sub>` |
| `/p/<id>/reports/weekly/<sub>` | `/<slug>/weekly-report/<sub>` |
| `/p/<id>/reports/monthly` | — (Demo) |
| `/p/<id>/technical-seo/indexing` | `/<slug>/indexing` |
| `/p/<id>/technical-seo/pagespeed` | `/<slug>/pagespeed` |
| `/p/<id>/technical-seo/site-audit` | — |
| `/p/<id>/local-seo/reviews` | `/<slug>/reviews` |
| `/p/<id>/local-seo/business-profile` | — |
| `/p/<id>/organic-serp/se-ranking/<tab>` | — |
| `/p/<id>/organic-serp/<engine>` (`google`, `bing`, `yandex`, `naver`) | — |
| `/p/<id>/keyword-research/...`, `/competitive-research/...`, `/link-building/...`, `/content/...` | — (Demo) |
| `/p/<id>/ai-area/<view>` | — |
| `/p/<id>/automation`, `/docs`, `/p/<id>/settings/<section>` | Settings panel / Project manager modals |

## Compatibility behaviour
1. Keep `app/[[...path]]/page.tsx` as the compatibility entry. Paths that start with a known v2 prefix (`p`, `portfolio`, `docs`) are handled by the new shell; anything else is treated as a legacy address. A project whose legacy slug is exactly `p`, `portfolio` or `docs` is reachable only through its v2 address.
2. A legacy `/<slug>/<tab>[/<sub>]` resolves the slug against the signed-in user's projects (same rule as today) and **replaces** the history entry with the v2 address, so bookmarks keep working and Back does not bounce.
3. `/` and `/<tab>` keep using the last-used project.
4. An unknown slug or a project the user can't access lands on `/portfolio` with a notice, never on another project's data.
5. While the new shell is behind a feature flag, the legacy Dashboard keeps serving legacy addresses unchanged.
6. API routes stay where they are; new module APIs are added under their own prefixes. No API route is renamed in phase 1.
