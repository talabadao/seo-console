# STATUS

_Last updated: 2026-10-15 — Milestone 01b in review; integration Preview built; waiting on owner setup. Nothing merged or deployed to production; no production migrations run._

## Pull requests
| PR | Branch | Base | Content | Checks |
|---|---|---|---|---|
| #2 | `docs/v2-repository-audit` | `main` | Audit, plan, owner decisions, route map, roadmap, this file | Vercel ✓ |
| #3 | `chore/v2-foundations` | `main` | **01a**: README, Vitest + tests, CSV formula fix, migration tooling (not run) | Vercel ✓ |
| #4 | `feat/login-allowlist` | #3 | Two-account sign-in allowlist; impact query and smoke test (`SMOKE-TEST.md`) | Vercel ✓ |
| #5 | `chore/preview-isolation` | #3 | Preview-only database; no writes or schedules in Preview; **session key fails closed**; setup checklist (`PREVIEW-SETUP.md`) | Vercel ✓ |
| #6 | `fix/indexing-eligibility` | #3 | Indexing API only for JobPosting / livestream pages | Vercel ✓ |
| #7 | `feat/v2-shell` | #3 | **01b**: new shell behind `V2_SHELL=1`, demo screens, screenshots | Vercel ✓ |

**Merge order:** #2, then #3. Once #3 is merged, retarget #4–#7 to `main` (`gh pr edit <n> --base main` if GitHub doesn't do it), then re-check each diff and its checks before merging.

**Known overlaps** (already resolved once on the `preview` branch):
- #4 and #5 both add an import to `lib/session.ts`; keep both.
- #4 and #7 both edit `app/[[...path]]/page.tsx`; keep the allowlist error handling and the shell routing.

**Integration Preview:** branch `preview` = #3 + #4 + #5 + #6 + #7.
- Deployment `seo-console-bshxbvuoi-zoro-hoang.vercel.app` is READY.
- Its `/api/preview-status` reports *no isolated database*, with external writes and schedules off. That's the expected fail-closed state until the owner setup below.
- Stable address after setup: https://seo-console-preview.vercel.app

## Checks (run locally, 2026-10-15)
| Branch | typecheck | lint | tests | build |
|---|---|---|---|---|
| #3 | ✓ | 0 errors / 18 warnings | 47/47 | ✓ |
| #4 | ✓ | 0 / 18 | 51/51 | ✓ |
| #5 | ✓ | 0 / 18 | 54/54 | ✓ |
| #6 | ✓ | 0 / 18 | 55/55 | ✓ |
| #7 | ✓ | 0 / 19 (+1: sidebar collapse state) | 57/57 | ✓ |
| `preview` (all) | ✓ | 0 / 19 | 76/76 | ✓ |

01b browser checks, in local mock mode:
- no page-level horizontal scroll at 1440 / 1280 / 1024 / 390, checked on six pages at 390
- mobile drawer works
- project switcher keeps the page and remounts it
- Back/Forward restore the previous project

## Verified facts this round
- `CRON_SECRET` is not set in any Vercel environment (checked in the project's variables). Both cron routes return 401 without it, so the scheduled jobs have not been running. Fix: `PREVIEW-SETUP.md`, last section.
- In Preview, `SESSION_SECRET` and the Google OAuth variables are unset; only the Neon database variables reach Preview. The missing session key used to fall back to a built-in value; #5 now makes deployments refuse it.
- The OAuth callback path, from the code, is `/api/auth/google/callback`, sent to Google from `GOOGLE_REDIRECT_URI`.
- `PAGESPEED_API_KEY` is stored as a non-sensitive variable (Vercel flags it "readable-secret"). Optional: re-add it marked Sensitive.
- The repository is **public**: committed screenshots use fixture data only, and the two allowlisted addresses are visible in the code.

## Owner actions needed
1. **Preview setup**: `docs/seo-console-v2/PREVIEW-SETUP.md` steps A–F.
   - separate Neon project
   - domain `seo-console-preview.vercel.app` on branch `preview`
   - new Google OAuth client with redirect URI `https://seo-console-preview.vercel.app/api/auth/google/callback`
   - Preview-only variables: `PREVIEW_DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `V2_SHELL=1`
   - three terminal commands
   - check `/api/preview-status`
2. **Allowlist impact**: run the read-only query in `SMOKE-TEST.md` §1 in Neon's SQL Editor and send me the counts. Don't ship #4 until that's reviewed.
3. **Sign-in smoke test**: `SMOKE-TEST.md` §3 on the Preview, both approved accounts plus one refused account.
4. **`CRON_SECRET`** for Production (`PREVIEW-SETUP.md`, last section), then redeploy production.

## Blockers
- Migration tests, Milestone 02a and live checks of the shell's existing views all wait on owner action 1.
- Shipping #4 waits on owner action 2.

## Next smallest task
After Preview is verified: run the shell's live views against the Preview database (smoke test on the stable Preview address). Then **Milestone 01d**: legacy `/<slug>/<tab>` addresses redirect to `/p/<id>/…` when the flag is on.
