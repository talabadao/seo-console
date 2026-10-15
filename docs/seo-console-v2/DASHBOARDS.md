# Project and portfolio dashboards: data rules

The v2 project dashboard (`/p/<id>/dashboard/overview`), All projects (`/portfolio`) and Project settings (`/p/<id>/settings/project/<section>`). Shown only with `V2_SHELL=1`.

## Where the numbers come from
One endpoint per project: `GET /api/v2/summary/<id>?preset=&compare=&parts=&detail=`. It only reads. The project must belong to the signed-in account (404 otherwise).

| Section | Source | Adapter | Notes |
|---|---|---|---|
| Search performance | Search Console API, live | `lib/v2/summary/live.ts` `gscSection` | Totals come from one request without dimensions, so CTR and position are Google's own period values, never averaged daily values. A daily series is used for the chart and the "data through" date. Stale when the latest data is more than 4 days old |
| Organic traffic | GA4 Data API, live | `ga4Section` | Organic Search channel. Sources on the account's AI list are excluded, the same rule as the Weekly Report. Totals come from a query without a date dimension, so sessions crossing midnight aren't counted twice. Revenue appears only when the property records it, with its own currency, and is never summed across currencies |
| Monthly KPIs | Targets in `weekly_kpi_config` + GA4 | `kpiSection` | Same targets and pace rule as the Weekly Report (`buildKpiCard`). Targets of 0 aren't shown. With no targets the section reads "Unavailable", not 0% |
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
