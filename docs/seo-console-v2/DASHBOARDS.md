# Project and portfolio dashboards: data rules

The v2 project dashboard (`/p/<id>/dashboard/overview`), All projects (`/portfolio`) and Project settings (`/p/<id>/settings/project/<section>`). Shown only with `V2_SHELL=1`.

## Where the numbers come from
One endpoint per project: `GET /api/v2/summary/<id>?preset=&compare=&parts=&detail=`. It only reads. The project must belong to the signed-in account (404 otherwise).

| Section | Source | Adapter | Notes |
|---|---|---|---|
| Search Console insights | Search Console API, live | `gscSection` + `insights.ts` | Clicks and impressions with change and a sparkline; CTR and position as one line. "Your content" and "Queries leading to your site" with Top / Trending up / Trending down: the top 1,000 pages and queries of each period by clicks; trending = largest change in clicks. A row missing from a comparison list that was cut off at 1,000 rows has unknown previous clicks and is kept out of the trends; a previous value of 0 shows "New". This is SEO Console's own summary, not Google's Insights product: queries are shown individually because no reliable grouping of query variants exists in the code (the existing grouping clusters queries by top page, which is different) |
| Search performance (portfolio) | Search Console API, live | `lib/v2/summary/live.ts` `gscSection` | Totals come from one request without dimensions, so CTR and position are Google's own period values, never averaged daily values. A daily series is used for the chart and the "data through" date. Stale when the latest data is more than 4 days old |
| Traffic (GA4) | GA4 Data API, live | `ga4Section` | Four headline metrics: **Organic sessions** (Organic Search channel, AI sources excluded), **AI sessions** (session source on the account's AI search sources list — Settings, default list in `lib/ga4.ts` `DEFAULT_AI_DOMAINS`; the same `classifyTraffic` rule as the Weekly Report and LLMs Traffic), **Revenue** and **Key events** (both from Organic Search sessions; key events = GA4's `keyEvents`, every key event, not only the selected lead events). Totals come from a query without a date dimension, so sessions crossing midnight aren't counted twice. Revenue appears only when the property records it, with its own currency, and is never summed across currencies |
| Monthly KPIs | Targets in `weekly_kpi_config` + GA4; lead events from the project setting | `kpiSection` + `kpi.ts` | **Attainment** = month-to-date actual vs the full-month target: "Target achieved", "In progress" (month running, not reached yet), "Below target" / "Above target" (final, after the month ends; "above" for lower-is-better metrics), "No target set", "Data unavailable". **Projection** = last 30 days' daily rate × days in month vs the target ("Projected to achieve target" / "Projected below target"). Neither uses "on track / off track", which describe project delivery status (Asana). A lead target without chosen lead events is reported, not counted as 0 |
| Keyword rankings | SE Ranking Project API (`SERANKING_API_KEY`), live | `rankingsSection` + `lib/seranking/rankings.ts` | The SE Ranking project chosen in Project settings, or matched by website. One context: the search engine with the most tracked keywords (engine, region, language, and device when the API reports it), all keyword groups. **Top 3 / 5 / 10 are cumulative** (positions 1–3, 1–5, 1–10). Position 0, missing checks and positions over 100 mean "not ranking" — never position 0. **Average position** follows SE Ranking's definition: every keyword checked at that date, with keywords outside the top 100 counted as 100 (verified against SE Ranking's own summary for WeWine on 2026-10-15: 27.4 here, 27 in SE Ranking; Top 5 = 89 and Top 10 = 169 matched exactly). Keywords without a check are left out. The mean of ranked keywords only is shown alongside. It is separate from the Search Console average position. Comparison = the latest check on or before (latest check − the period length), same engine and keywords |
| Asana work | Asana API, read-only | `tasksSection` → `summarizeTasks` | Tasks completed this month are counted by completion date. "Due this month" counts by due date, done or not. Overdue means open and past due. The month is the UTC calendar month and is stated on screen |
| Content progress | none yet | `demoContent` | Always labelled Demo until a content workflow exists |
| Needs attention | the sections above | `lib/v2/summary/alerts.ts` | Only from real section data: drops of 20% or more on a base of at least 50, off-track KPIs, overdue tasks, provider errors, failed syncs. Alerts from demo sections carry a Demo label |
| Sync health | stored history only | `healthSection` | Last stored Search Console sync, PageSpeed errors in the last 7 days, last reviews fetch error. No provider calls |

Section states:
- **live**: real data.
- **demo**: invented data, always labelled.
- **not connected**: the project lacks the link.
- **unavailable**: linked, but nothing to show, e.g. no targets or missing permission.
- **error**: the provider failed; the message is shown and no numbers are substituted.

Missing values are `null` and shown as "—", never 0.

## Load and cost control
- **Server:** results are cached for 15 minutes per instance, keyed by user, project, period and parts. At most 4 provider calls run at once per instance. Refresh skips the cache.
- **Browser:** at most 3 summary requests at once. Results are cached for 10 minutes in sessionStorage.
- **All projects:** loads summaries only for the 25 rows on the current page. "Load all N" fetches the rest on request, still 3 at a time. Opening the portfolio never fetches all 65–80 projects.
- **Portfolio cards:** they count projects; they never add metrics across projects, so a property linked to two projects isn't counted twice. Overdue tasks are de-duplicated by Asana project, and a Search Console property linked to more than one project is marked "shared".

## Demo data
- **Demo projects:** their website is on the reserved `.example` domain (RFC 2606). They show demo data for every section and never call a provider.
- **Preview:** an approved, signed-in user can add three demo projects to their own account ("Add demo projects" on an empty All projects page, PR #5 `POST /api/preview/demo-projects`).
- **Local mock mode** (`V2_MOCK=1`, `next dev` only): every number is demo, with 30 fixture projects. A few fixtures show the not connected, stale and error states.

## Lead events (one project setting)
Which GA4 events count as leads is chosen once per project in **Project settings → Analytics / Key events** (table `project_settings`, migration `0002`). The dashboard, GA4 reports and the Weekly Report all read it (`lib/projectSettings.ts`; the Weekly Report's `configFor` returns it). Until a project saves its own list, the most recent Weekly Report selection for its GA4 property is used, so nothing is reset. On a database that hasn't run `0002` (Production until its migration), reads and writes use the Weekly Report's per-month storage exactly as before. The Weekly Report shows the list with a link to Project settings (or an inline editor in the classic view).

## Migrations
`0002_project_settings` adds `project_settings`. Preview and local development apply pending versioned migrations automatically at startup (isolated, disposable databases). Production never migrates itself: run `npm run migrate -- --apply --confirm=<host/db>` there when releasing; until then, features needing the table say so.

## Settings
- **Sections:**
  - General
  - Integrations (the connection list and property mappings that used to be on the overview)
  - KPI targets (saves through the existing `/api/weekly-report/config`)
  - Tracking (opens the existing settings panel)
  - Budgets and limits
  - Sync and history
- Switching projects keeps the Settings section.
- Database URLs, OAuth client secrets and `SESSION_SECRET` stay in server environment variables and aren't editable here.

## Not done yet
- Editable per-project budgets.
- A persistent summary cache shared across server instances (needs a migration).
- A real content workflow.
- Notifications history.
