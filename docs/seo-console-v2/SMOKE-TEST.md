# Sign-in allowlist (PR #4): impact check and smoke test

## 1. Impact on existing accounts — run before shipping PR #4
The allowlist admits exactly five addresses, the same list for Preview and Production (`lib/auth/allowlist.ts`):

- `analytics@headsonpillows.com`
- `analytics@artemisdigital.com`
- `tinledoihoa@gmail.com`
- `tin@headsonpillows.com`
- `tin@artemisdigital.com`

Only these exact addresses; other addresses at the same domains are refused. Each account sees only the projects it created itself: being on the list grants nothing in another account's projects. Nothing is transferred, merged or deleted: projects of other accounts stay in the database, but nobody can sign in to see them, and scheduled jobs skip them.

I can't read the production database, so this needs you. In the **Neon console → production project → SQL Editor**, run this **read-only** query:

```sql
-- Read-only: counts what each account owns and whether it can still sign in.
SELECT
  CASE WHEN lower(u.email) IN ('analytics@headsonpillows.com', 'analytics@artemisdigital.com',
                            'tinledoihoa@gmail.com', 'tin@headsonpillows.com',
                            'tin@artemisdigital.com')
       THEN 'allowed' ELSE 'NOT allowed' END                                   AS after_pr4,
  u.email,
  to_timestamp(u.updated_at / 1000)::date                                      AS last_sign_in_or_refresh,
  (SELECT count(*) FROM projects p WHERE p.user_id = u.id)                     AS projects,
  (SELECT count(*) FROM sites s WHERE s.user_id = u.id AND s.source = 'google'
                                    AND s.auto_index_enabled)                  AS daily_indexing_sites,
  (SELECT count(*) FROM psi_pages g JOIN projects p ON p.id = g.project_id
    WHERE p.user_id = u.id)                                                    AS page_speed_pages,
  (SELECT count(*) FROM gbp_reviews r JOIN projects p ON p.id = r.project_id
    WHERE p.user_id = u.id)                                                    AS saved_reviews,
  (SELECT count(DISTINCT k.property_id) FROM weekly_kpi_config k
    WHERE k.user_id = u.id)                                                    AS ga4_properties_with_kpis
FROM users u
ORDER BY after_pr4, u.email;
```

How to read it:
- **`NOT allowed` rows with `projects > 0`:** those projects become invisible once #4 ships. If any are still in use, add that address to `ALLOWED_EMAILS` (`lib/auth/allowlist.ts`) before merging, or recreate the projects under an approved account. Both are your decision; nothing happens automatically.
- **`daily_indexing_sites` / `page_speed_pages` on `NOT allowed` rows:** those scheduled jobs stop for these accounts. Today they aren't running for anyone anyway, because `CRON_SECRET` is missing (see PREVIEW-SETUP.md).
- **`allowed` rows:** nothing changes. Each approved account keeps exactly its own projects.

Send me the `after_pr4`, `projects`, `daily_indexing_sites` and `page_speed_pages` columns (addresses optional) and I'll record the impact in STATUS.md.

## 2. Automated tests (already run, no action needed)
`npm test` → `tests/unit/allowlist.test.ts`:
- exactly the five addresses are on the list, and each is accepted
- letter case and surrounding whitespace are ignored
- other addresses at the same domains, look-alike domains, plus-addresses, dotted Gmail variants and other Gmail accounts are refused
- an unverified email is refused even when the address matches

These test the rules, not a real Google sign-in.

## 3. Manual sign-in smoke test (needs you)
Run it on the Preview first (https://seo-console-git-preview-zoro-hoang.vercel.app, after PREVIEW-SETUP.md is done; pass Vercel's login screen as the Vercel account `tinledoihoa@gmail.com` first), then again on production right after #4 is deployed. Use a private browser window per account so sessions don't mix.

| # | Step | Expected |
|---|---|---|
| 1 | Open the site signed out | Sign-in page with "Continue with Google" |
| 2 | Sign in as `analytics@headsonpillows.com` | Lands in the console. The project picker lists **only this account's projects** (on Preview: none at first) |
| 3 | Open a project, switch tabs, reload the page | Same project and tab after reload; no other account's projects appear anywhere |
| 4 | Sign out | Back to the sign-in page |
| 5 | Repeat 2–4 as each of the other four approved accounts: `analytics@artemisdigital.com`, `tinledoihoa@gmail.com`, `tin@headsonpillows.com`, `tin@artemisdigital.com` | Each signs in and sees only its own projects (a new account: none); never another account's |
| 6 | Sign in with any Google account not on the list (e.g. another personal Gmail) | Back on the sign-in page with "This Google account isn't allowed to use SEO Console…". No session; reloading stays signed out |
| 7 | (Production only) A browser already signed in as a non-approved account | After the deploy, the next page load shows the sign-in page. A browser signed in as an approved account stays signed in |
| 8 | (Preview only) Open `/api/preview-status` | `"database"` is the Preview host, `"externalWrites": false`, `"schedules": false` |

Report any step whose result differs, with the step number and a screenshot.
