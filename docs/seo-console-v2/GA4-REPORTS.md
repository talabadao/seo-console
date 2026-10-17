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
| Compatibility validation | `checkCompatibility` "lists dimensions and metrics that can be added to a report request" and "fails if the request’s dimensions and metrics are incompatible" | Check fields and every save send exactly the report’s dimensions, metrics and dimension filter. A successful response means the report is compatible; its candidate lists (other fields that could or couldn’t be added) are **not** errors and aren’t read. A 400 is shown with Google’s own reason. Permission, quota and network failures are reported as such, never as valid. | Yes |
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
- **Refresh policy.** GA4 reports are refreshed only when someone opens them: a result older than 2 hours is shown with its age while one background refresh runs. The 4-hourly scheduled sync does **not** refresh GA4 templates, custom reports or the field list, so viewing many reports never queues repeated GA4 requests.
- **Trends.** Each trend has one point per calendar day. GA4 leaves out days without data, so counts show 0 on those days and rates or averages show a gap. The comparison line pairs day N of the comparison period with day N of the current period.

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

## Acceptance checklist (owner, on Preview, about 10 minutes)
Use your normal signed-in browser. Base URL: https://seo-console-git-preview-zoro-hoang.vercel.app. Góc Săn Deal is project **4** on Preview.

1. **Database** (30 s). Open `/account/sync`. Expect **Database: Preview (its own database) · latest migration 0013_ga4_saved_reports**, and "Every migration this version knows about is applied."
2. **Templates** (3 min). Open `/p/4/analytics/reports`. Under Analytics (GA4), GA4 reports sits between Analytics and LLMs Traffic, and Analytics and LLMs Traffic are unchanged. Open all five tabs: Generate leads, Events, Landing pages, Traffic acquisition, User acquisition.
   - Each shows scorecards, a daily trend and a table. The footer gives the period, comparison, property time zone, source and fetch time.
   - The first open of a tab can take up to ~20 s ("Loading from GA4…"). Reopening it is instant.
3. **Period** (1 min). On Traffic acquisition, choose **Last 7 days vs previous period**. The footer dates change to 7 days, and the dashed comparison line has 7 points.
4. **Numbers vs GA4** (2–3 min). In GA4: same property, Reports → Acquisition → Traffic acquisition, same 7 dates. GA4 uses the property time zone, as the app does. Compare **Sessions** and **Engaged sessions** in total and for **Organic Search**. Expect equal values, or within 1–2% if GA4 is still processing the last 48 hours. On User acquisition, compare **Total users** and **New users** with GA4's User acquisition report. The app's total users comes from GA4 itself, so it is lower than the sum of the rows.
5. **Lead events** (1 min). On Generate leads:
   - With lead events set: each event is listed with its count and "Also a GA4 key event" or "Not a GA4 key event". The Lead events column differs from Key events (all).
   - With none set: "Choose lead events" opens Project settings → Analytics / Key events (`/p/4/settings/project/analytics`). Save one event, return, and lead counts appear.
6. **Custom report** (2 min). On the Custom reports tab, name it **Test – sessions by channel**. Keep the default fields and press **Run**: totals, a table and comparisons appear. Press **Save**, then **reload the page**. Open the saved report from the list: it runs once and shows the same numbers.
7. **Edit, copy, delete** (1 min). Change the chart to **Bar**, Save changes, then **Save as copy**. Use **Duplicate** in the list on either report. Try **Donut** with **Total users**: Save is refused, explaining that users can't be split into shares. **Delete** the test reports. The list returns to its earlier state.
8. **Project association** (30 s). Switch to another project that has GA4 and open GA4 reports → Custom reports. Góc Săn Deal's saved reports are not listed there. Switch back: they are listed again.

**If something fails, send:**
- the step number;
- the page address (path only);
- the visible message text;
- for numbers: the app value, the GA4 value, the dates and comparison you selected, and the GA4 report name.

Don't include screenshots that show credentials, cookies or browser developer tools.
