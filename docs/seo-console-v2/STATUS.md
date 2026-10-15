# STATUS

_Last updated: 2026-10-15 — Milestone 01a and the three separate fixes are in review. Nothing merged or deployed to production._

## Open pull requests (merge order)
| PR | Branch | Base | Content | State |
|---|---|---|---|---|
| #2 | `docs/v2-repository-audit` | `main` | Milestone 00 audit, plan, owner decisions, this file | Ready for review |
| #3 | `chore/v2-foundations` | `main` | **01a**: README rewrite, Vitest + 47 tests, CSV formula fix, versioned migration tooling (not run) | Ready for review; merge after #2 or independently |
| #4 | `feat/login-allowlist` | #3 | Sign-in allowlist (2 accounts, verified ID token, every request) | Stacked on #3 |
| #5 | `chore/preview-isolation` | #3 | Preview uses only `PREVIEW_DATABASE_URL`; external writes and schedules off in Preview; fixture seed; setup guide | Stacked on #3; **needs owner setup** |
| #6 | `fix/indexing-eligibility` | #3 | Indexing API only for JobPosting / livestream pages, from the page's structured data | Stacked on #3 |

Merge #3 first; GitHub then retargets #4–#6 to `main`. They don't depend on each other.

## Checks (run locally on each branch, 2026-10-15)
- `npm run typecheck` ✓ on all branches
- `npx eslint .` 0 errors; 18 warnings, the same as `main` (pre-existing `react-hooks/set-state-in-effect` and similar)
- `npm test`: #3 47/47, #4 51/51, #5 52/52, #6 55/55
- `npm run build` ✓ on all branches
- PR #2: Vercel and Vercel Preview Comments checks passed.

## Owner decisions applied (AUDIT §5)
Allowlist of two accounts, with no project merging; `seo-console-official` out of scope; AI Brand Mention used as a code reference only (no storage connection, no history import); Preview isolation before migration tests; Indexing API restricted to eligible pages; Vitest approved.

## Owner actions needed
1. **Preview database**: follow `docs/seo-console-v2/PREVIEW-SETUP.md` steps 1–3 (separate Neon project, `PREVIEW_DATABASE_URL` for Preview only, three terminal commands), then tell me so I can verify a preview through `/api/preview-status`.
2. **`CRON_SECRET`** for Production (same file, last section): scheduled indexing and Page Speed jobs most likely aren't running without it.
3. **Allowlist impact**: once #4 ships, `tinledoihoa@gmail.com` (and any account other than the two approved ones) can no longer sign in. Add addresses to `ALLOWED_EMAILS` in `lib/auth/allowlist.ts` first if anyone else needs access.
4. Review and merge the PRs when satisfied. Nothing is merged automatically.

## Blockers
- Migration tests and Milestone 02a (workspace identity): blocked on Preview isolation being verified (owner action 1).
- Signing in to a preview: Google OAuth can't use wildcard preview addresses. To be decided with the shell milestone (a fixed preview domain, or a Preview-only fixture sign-in).

## Known issues carried forward
- Secrets stored in plaintext columns (fix in 02b).
- Indexing runs and Reviews analysis continue only while the browser tab is open (fix in 03).
- Project addresses depend on the project name (fix in 01d).

## Next task
**01b — application shell** (`feat/v2-shell`), behind a feature flag: grouped sidebar with every spec destination, searchable project switcher with All projects, portfolio/project navigation, breadcrumbs and page header, clearly labelled Demo screens; existing tabs mounted unchanged. It can be built and checked locally with mocked data now. Preview checks wait on owner action 1.
