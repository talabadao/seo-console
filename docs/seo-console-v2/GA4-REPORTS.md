# GA4 reports: templates and saved custom reports (Preview, 17 Oct 2026)

These reports are under **Analytics (GA4) → GA4 reports**, next to Analytics and LLMs Traffic, in the same project shell. They use the project's linked GA4 property, the account's existing Google connection, the shared cache and the GA4 quota windows. **They are on Preview only.** They aren't merged to Production until the owner has reviewed them.

## Feasibility, checked against the official GA4 Data API documentation
Sources:
- API schema: developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- runReport, RunReportResponse and ResponseMetaData references
- getMetadata
- checkCompatibility
- Limits and quotas

| Need | API support (verified) | How it is used | Feasible |
|---|---|---|---|
| Landing page | `landingPage`: "page path of the first pageview in a session". `landingPagePlusQueryString` also exists. | Landing pages, Generate leads | Yes |
| Session channel / source / campaign | `sessionDefaultChannelGroup`, `sessionSourceMedium`, `sessionSource`, `sessionMedium`, `sessionCampaignName` | Traffic acquisition, Generate leads | Yes |
| First-user acquisition | `firstUserDefaultChannelGroup`, `firstUserSourceMedium`, `firstUserCampaignName` ("…that first acquired the user") | User acquisition | Yes |
| Events | `eventName`, `eventCount`, `eventCountPerUser`, `isKeyEvent` ("true" for a key event) | Events | Yes |
| Key events (all) | `keyEvents`: the count of key events | Every template, labelled "Key events (all)" | Yes |
| Project lead events, distinct from key events | No per-event count metric is documented in the schema. Only the rates `sessionKeyEventRate:event_name` and `userKeyEventRate:event_name` are, and they apply to key events only. | `eventCount` with an `inListFilter` on `eventName` (the project's lead events). It works whether or not GA4 marks them as key events. | Yes |
| Sessions, engagement | `sessions`, `engagedSessions`, `engagementRate` (engaged ÷ sessions), `averageSessionDuration`, `bounceRate` | Templates C, D, E | Yes |
| Users | `totalUsers`, `newUsers`, `activeUsers` (distinct counts) | Templates B, C, E | Yes. Totals come from their own query, never summed. |
| Comparison periods | Several `dateRanges` per request; rows carry the range index | Totals query (both ranges); table rows queried per range | Yes |
| Timezone and currency | ResponseMetaData `timeZone` and `currencyCode`; the property default is used when the request names none | Shown on every report; the period is anchored in the property's timezone | Yes |
| Thresholding, "(other)", sampling | `subjectToThresholding`, `dataLossFromOtherRow`, `samplingMetadatas` | Shown as notes under the report | Yes |
| Builder field list, including custom definitions | `getMetadata` for `properties/{id}` returns standard plus custom dimensions and metrics | Builder pickers; save and run validation | Yes |
| Compatibility validation | `checkCompatibility` returns COMPATIBLE or INCOMPATIBLE per dimension and metric | The builder's Check fields action and every save | Yes |
| Row limits | `limit` defaults to 10,000; at most 250,000 rows per request; `rowCount` ignores the limit | Tables show the top rows and say how many matched | Yes |
| Quota | Standard property: 200,000 tokens per day and 40,000 per hour per property, 14,000 per project per property per hour, 10 concurrent requests | Shared cache (2 h), at most 3 parallel requests per report, shared rate window per property | Yes |
| Explorations import, segments, funnels and paths | No Data API to read saved Explorations. Segments aren't in `runReport`. Funnels are a separate alpha method. | **Not built, and not claimed** | No |

## What each template shows
| Template | Breakdown | Columns | Scorecards | Trend |
|---|---|---|---|---|
| **Generate leads** | Session channel, landing page, or session source/medium | Sessions, Key events (all), Lead events | Lead events, Sessions, Key events (all) | Lead events per day, with the comparison |
| **Events** | Event name (marked when GA4 counts it as a key event) | Event count, Total users, Events per user | the same three, GA4 totals | Up to 5 chosen events per day (top 3 by default) |
| **Landing pages** | Landing page | Sessions, Total users, Engaged sessions, Engagement rate, Key events (all), Lead events | Sessions, Total users, Engagement rate, Key events | Sessions per day, for all pages or a chosen page |
| **Traffic acquisition** (session-scoped) | Session channel, source/medium, or campaign | Sessions, Engaged sessions, Engagement rate, Key events (all), Lead events | Sessions, Engaged sessions, Engagement rate, Key events | Sessions per day |
| **User acquisition** (first-user scoped) | First-user channel, source/medium, or campaign | Total users, New users, Engaged sessions, Engagement rate, Key events (all), Lead events | Total users, New users, Engagement rate, Key events | New users per day |

**Lead-events setup state (Generate leads).**
- When the project has no lead events, the template says so, links to Project settings → Analytics / Key events, and makes no lead queries.
- For each chosen lead event it shows:
  - the event count in the period, with the comparison;
  - whether GA4 also marks it as a key event;
  - "not recorded in this period", which suggests a name mismatch.

## Number rules
- **Totals** (scorecards, the builder's totals) come from a separate GA4 query without dimensions. Users are counted once, and rates and averages are computed by GA4. Rows are never added up, and row percentages are never averaged.
- **Comparison rows** come from their own query. The current period's row limit therefore doesn't drop them. A row missing from the comparison shows "—", not zero.
- **Lead-event counts** are additive event counts. Lead events per row and in total come from filtered queries.
- **Donut charts** accept only metrics that add up across rows: sessions, event counts, key events, revenue. A donut of users, rates or averages is refused when saving and when running, with the reason.
- **Revisions.** GA4 can revise the last 24–48 hours; every report says so. Results are cached for 2 hours, and Refresh asks GA4 again (5-minute cool-down).

## Saved custom reports
- **Configurable:**
  - name;
  - up to 3 dimensions and 6 metrics, from the property's metadata, including custom definitions;
  - relative date range and comparison (the same presets as the dashboard);
  - up to 5 dimension filters (exact, contains, begins with, regex, in list; include or exclude);
  - sort;
  - row limit (up to 1,000);
  - chart type: table, scorecard, line (needs `date`, optionally split by one dimension), bar, donut.
- **Actions:**
  - Run (explicit);
  - Check fields (metadata plus GA4 compatibility);
  - Save, Save as copy;
  - open (which runs it once);
  - duplicate, delete.
  - Nothing runs while editing.
- **Stored** in `ga4_saved_reports` (migration 0013) with the account, project and GA4 property. Every route checks the signed-in account owns the project, and every query repeats `user_id` and `project_id`. Another account's report ID returns 404, even through that account's own project; tests cover this.
- **Property change.** If the project's GA4 property changes, a saved report states which property it was made for and isn't run. Edits are refused (409) until the owner chooses **Check and use with the current property**, which validates it against the new property first.
- **Cache identity:** account scope, project, property, resolved period (property timezone), full definition, and the project's configuration version. Identical runs, from another tab or by reopening, reuse the stored result.

## API limitations to know
- **Thresholding.** Properties with Google signals or demographics may withhold low-count rows. Totals still include them, and the report notes it.
- **Users don't add up.** Users per row can sum to more than the total user count, because one user can appear in several rows. This is expected.
- **High-cardinality dimensions.** For example, a landing page with query strings may produce an "(other)" row. The report notes it.
- **Not available here:** segments, comparisons by audience, funnels, path analysis, cohort exploration, importing saved GA4 Explorations, and metric filters (`metricFilter`).
- **Event-scoped custom dimensions registered before October 2020** use the `customEvent:param[event]` form. They are accepted if the property's metadata lists them.

## Acceptance checklist (owner, on Preview)
Preview: https://seo-console-git-preview-zoro-hoang.vercel.app. On Preview, Góc Săn Deal is project 4.
1. Analytics (GA4) → **GA4 reports** appears between Analytics and LLMs Traffic. Analytics and LLMs Traffic are unchanged.
2. **Generate leads:**
   - with lead events set: the lead events, sessions and key events scorecards; a lead events trend; a per-event setup list with key-event status;
   - with none: a "Choose lead events" prompt.
3. **Events:** the key-event badge; Show/Hide adds events to the trend.
4. **Landing pages:** Show on a row limits the trend to that page.
5. **Traffic vs User acquisition:** the different wording (session vs first-user); switching the breakdown works.
6. Every report shows the period, comparison, property timezone, currency (when relevant), source and fetch time.
7. **Custom reports:**
   - build sessions by channel and Run;
   - save; reopen; edit and save; save as copy; duplicate; delete;
   - try a donut of Total users (refused with a reason);
   - Check fields on a valid report.
8. Change nothing in Production. GA4 is free, and no paid provider is called.
