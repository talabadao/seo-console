# Workspace members: personal Users, shared projects

Status: implemented on branch `feat/workspace-members`, Preview only. **Not merged; migration 0014 not applied to
Production.** Rolling it out needs a new owner authorization (section 11).

Still open from the previous release, unrelated to this feature: the Production incremental Search Console refresh
(migration 0012) has not been observed yet. It stays an open verification item.

## 1. Model

- **User**: one person. There are no global roles. A User has one or more verified Google logins
  (`user_identities`, keyed by issuer + subject), a profile (name, job title — information only), and personal data
  nobody else can read: API keys, budgets, usage, notification inbox and mutes, private saved GA4 reports, scheduled
  spending consent.
- **Workspace**: one team (`workspaces` id 1) with two brand labels, Artemis Digital and Heads on Pillows (`brands`).
  Brands are labels for filtering; they grant nothing.
- **Project**: belongs to the workspace. Every active User views every project. Its **management members**
  (`project_members`) edit, refresh, run, share, transfer and delete it; one of them is the **primary manager**.
- **Shared data connections**: Google accounts (`google_connections`) and Asana tokens (`asana_connections`) the
  workspace reads data through. The two analytics@ accounts are connections only, never logins.

## 2. Where it lives

| Area | Code |
| --- | --- |
| Admission rules | `lib/auth/eligibility.ts` |
| Sign-in, linking | `lib/auth/identities.ts`, `app/api/auth/google/*`, `lib/auth/messages.ts` |
| Merging two records | `lib/auth/merge.ts`, `app/api/account/identities/merge/[requestId]` |
| Session recheck | `lib/session.ts` (`currentUser`) |
| Access helpers for routes | `lib/access.ts` (`viewProject`, `manageProject`, `managementRequired`) |
| Projects and managers | `lib/projects.ts`, `app/api/projects/[id]/members`, `app/api/projects/[id]/spending` |
| Who pays | `lib/credentials/resolve.ts`, `lib/spending.ts`, `lib/providers/policy.ts` |
| Google connections | `lib/google/connections.ts`, `lib/google/discovery.ts`, `app/api/account/connections/*` |
| Asana | `lib/asanaConnections.ts`, `app/api/account/asana-identity` |
| Notifications | `lib/notifications/store.ts` (routing, mutes) |
| UI | `app/components/v2/Workspace.tsx`, `AccountWorkspace.tsx`, `ProjectSettings.tsx`, `ProjectManager.tsx`, `Shell.tsx` |
| Migration and tooling | `db/migrations/0014_workspace_members.ts`, `scripts/workspace/*`, `scripts/capacity/workspaceRehearsal.ts` |

## 3. Admission

Decided on Google's verified ID-token claims (signature, issuer, audience, expiry, nonce), never on a typed address.

- Company accounts at exactly `artemisdigital.com` or `headsonpillows.com`, with Google's hosted-domain claim (`hd`)
  equal to the same domain. Look-alikes, sub-domains and a missing or different `hd` are refused.
- One personal exception: `tinledoihoa@gmail.com`. No other Gmail address.
- `analytics@artemisdigital.com` and `analytics@headsonpillows.com` can never sign in; they can only be connected as
  data sources.
- Unverified addresses are refused.
- Every request rechecks the session: the User must be an active person in a workspace, and the session's own login
  must still belong to them and still qualify. Sessions from before this release count as signed out (one new sign-in).
- First sign-in: a known identity opens its User; otherwise an unclaimed legacy record with the exact same verified
  address is claimed; otherwise a new User is registered. A recorded address under a different Google account is
  never taken over by address alone.
- The operator can disable or re-enable a person (`scripts/workspace/setUserStatus.mts`); there is no role UI.

Sign-in errors are fixed codes (`?error=<code>`) mapped to text in `lib/auth/messages.ts`, so a link can't put
arbitrary words on the sign-in page.

## 4. Permission matrix

"Manager" = management member (the primary manager has the same powers plus paying for schedules).

| Action | Viewer (any active User) | Manager | Notes |
| --- | --- | --- | --- |
| See the project in All projects, open every page, read cached results | ✅ | ✅ | Viewing never launches paid work |
| Run free reporting (GA4 templates and custom runs, dashboards) | ✅ | ✅ | Served from the shared cache when identical |
| Force a refresh (Refresh buttons, `refresh=1`) | ❌ hidden; ignored by the server | ✅ | |
| Save private GA4 reports | ✅ (own only) | ✅ (own only) | Never visible to anyone else |
| Edit settings, mappings, KPI targets, lead events, AI domains, SE Ranking mapping | ❌ 403 | ✅ | 403 names the managers |
| Start paid runs (tracking, Brand Mentions, Maps reviews, review analysis, backlinks) | ❌ 403 | ✅ with **their own** key and budget | |
| URL inspection, index checks, Indexing API submissions | ❌ 403 | ✅ | |
| Post the weekly report to Asana | ❌ 403 | ✅ | Blocked on Preview |
| Share management, remove a manager | ❌ | ✅ | Last manager can't be removed |
| Transfer primary management | ❌ | ✅ | Cancels queued paid work billed to the old one |
| Delete (recoverable) | ❌ | ✅ | Cancels queued refreshes and paid runs |
| Remove a legacy SerpApi key stored on the project | ❌ | ✅ | Never used for runs |
| Create a project | ✅ becomes its first manager and primary manager | ✅ | |
| Another person's keys, budgets, usage, inbox, mutes, saved reports | ❌ | ❌ | Personal to each User |
| Another workspace's projects | ❌ 404 | ❌ 404 | |

Workspace-level, any active User: connect a shared Google account (the personal session is unchanged), refresh what a
connection can read, add an Asana connection. Only the person who connected a Google account (or Asana token) can
disconnect it; anyone able to sign in to that Google account can reconnect it.

## 5. Who pays

- **Manual paid runs**: the acting manager, with their own encrypted key and their own budgets. `resolveCredential`
  returns only the actor's credential: never a teammate's, a legacy key stored on a project, or a shared server key
  (`SERPAPI_API_KEY` / `LEGACY_SERVER_CREDENTIAL_ACCOUNTS` are no longer used).
- **Scheduled paid work**: the primary manager, only while they allow scheduled spending for that provider in their
  own settings (`scheduled_spending`, a personal consent). Each queued job records the payer, the key fingerprint
  and an authorization version (project spending version + consent version); everything is rechecked right before it
  runs. A changed primary manager, key or consent, an inactive payer, a payer who is no longer a manager or a deleted
  project stops the job with a reason (the runner then tells the payer and the managers through
  `notifySpendingFailure`) — it is never rebilled to someone else.
  Transferring primary management cancels queued jobs billed to the previous primary manager.
- No paid feature runs on a schedule in this release; the rules are implemented and tested with a simulated job.
- Per-project budgets are personal: their counters are keyed per person and project
  (`serpapi-month:user:<u>:project:<p>:<month>`), so one manager's use never consumes another's limit. 0014 carries
  this month's counters to the legacy owner's new key.
- Preview rules are unchanged: paid model calls off; SerpApi only for the smoke-test project within the one
  cumulative 5-request allowance (never reset or refilled).

## 6. Shared connections

- Google connections use a separate OAuth purpose (`connect-google`, offline access, consent) from personal sign-in
  (`login`) and linking (`link`). The callback completes only the flow the same session started, with the same User
  still signed in, and never changes the session for a connection.
- A connection is identified by the verified Google identity. Refresh and access tokens are encrypted with
  AES-256-GCM bound to the connection (`google-connection:<id>:refresh|access`); migrated connections adopt their
  legacy refresh token into encrypted storage on first use (the legacy column is left untouched). A deliberately
  disconnected connection is never revived from the legacy column.
- Health is shown in Account → Data connections (healthy / needs reconnect / disconnected) and pages using a broken
  connection show a reconnect state instead of stale data.
- Mappings name their connection: a project maps a property **through** a connection that lists it; the server
  refuses a property no workspace connection lists, a connection that doesn't list it, or an ambiguous choice.

## 7. Cache

Cache identity is the workspace scope (`ws:<id>`) plus the project, the connection/resource and the normalised query
and configuration (`projectConfigVersion` includes the connection ids). Identical requests by different viewers share
one result; a cache hit makes no provider call. Forced refresh needs management. A job whose project was deleted or
left the workspace fails and clears its data.

## 8. Notifications and Asana

- One inbox per User. Project alerts (performance, rankings, content progress) go to the project's managers; being
  added as a manager subscribes, being removed unsubscribes. Task alerts (due soon, overdue) go to the task's Asana
  assignee, matched by the User's one verified Asana user (`users.asana_user_gid`, unique among active people of a
  workspace), in any
  project. Mutes (per project and category, or all projects) are personal.
- The Asana reporting connection a project maps reads tasks and posts weekly status updates; it never decides who
  receives task alerts.

## 9. Docs publishing

Unchanged policy: `DOCS_ADMIN_EMAILS` lists the publishers. A User publishes when one of their verified, linked logins
is listed and they are an active person in the workspace — so Tin publishes from his linked profile with either login.

## 10. Migration 0014

Additive and idempotent: new tables, nullable or defaulted columns, guarded backfills, no row deleted, no legacy
column changed, existing ids kept (encrypted credentials keep their `userId:provider` binding; nothing encrypted is
rewritten). `projects.user_id` stays the legacy owner.

Mapping rules:

| Legacy record | Becomes |
| --- | --- |
| Company-domain address or the Gmail exception | person in workspace 1 (identity linked on first sign-in by exact verified address) |
| analytics@ accounts | `shared-connection` records (never people), each with a Google connection |
| Any other address | stays outside the workspace; their projects are hidden for review |
| Google grant / discovered sites and properties | one connection per eligible legacy login; sites and properties point at it |
| Asana token | an Asana connection |
| Project of a person | workspace project; that person is member + primary manager; brand from their domain |
| Project of an analytics account | workspace project with brand, **no manager**: needs a verified human mapping |
| Project of an outside address | hidden (no workspace) until the owner decides |
| Per-login AI domains | project settings of that login's projects |
| Legacy project SerpApi key | left in place, never used for runs; protected claim path (section 12) |

Rehearsal on a real backup (taken before 0013; isolated embedded Postgres, nothing connected to Production):

- Restore proven identical to the backup; runner applied 0013 + 0014 in 0.6 s; applying again changed nothing;
  re-running the 0014 statements directly changed nothing; every original row still present; no invariant violation.
- 6 person records (1 in the workspace before anyone signs in) and 2 shared-connection records; 3 Google connections,
  2 Asana connections.
- 22 projects: 20 in the workspace, 2 hidden for review (owned by an address outside both domains).
- 2 projects already have a human manager; **18 need one** (7 Heads on Pillows, 11 Artemis Digital).
- 2 projects still store a legacy SerpApi key; no account credentials or budgets exist yet; no duplicate hosts.

The full report (people, project names, proposed mappings) is kept outside the repository, in the owner-only folder
(`%USERPROFILE%\.seo-console\workspace-report-rehearsal.json`), because this repository is public. Regenerate it with:

```bash
npx tsx scripts/capacity/workspaceRehearsal.ts <backup directory> <report.json>
```

Compatibility evidence: the previous release's full test suite (main, 360 tests) passes with 0014 added to its
migration list, i.e. the current Production code keeps working on a database that already has 0014. That is what
makes "migrate first, deploy second" and redeploy-only rollback safe.

## 11. Production rollout (not done; needs authorization)

1. Owner confirms the decisions in section 12 (manager mapping, the two hidden projects, the two legacy keys).
2. Fresh recoverable backup of Production (`scripts/workspace/backup.mts`, owner-only folder), restore-verified.
3. Rehearsal on that backup (`workspaceRehearsal.ts`); compare its report with this one.
4. Apply 0014 with the runner (`npm run migrate -- --apply --confirm=<host/db>`). The current release keeps running.
5. Merge the PR (deploys the new code). Owner signs in with `tinledoihoa@gmail.com` (claims the existing record),
   links `tin@artemisdigital.com` / `tin@headsonpillows.com` in Account → Linked logins (verified; merge preview if one
   already has a record), reconnects the two analytics accounts once in Account → Data connections.
6. Operator applies the confirmed manager mapping (`scripts/workspace/assignManagers.mts`, dry run first) after the
   named people have signed in once.
7. Legacy keys: owner decides per key (`scripts/workspace/claimLegacyKey.mts`, dry run first) or removes them.
8. Smoke check (section 13 subset) on Production.

## 12. Decisions the owner still has to make

- A human primary manager (and optional extra managers) for each of the 18 projects moved from the analytics
  accounts. They are not assigned to Tin automatically.
- Whether the 2 hidden projects (owned by an address outside both company domains) belong to the team; if so, who
  manages them.
- Whose key each of the 2 legacy project SerpApi keys is (or remove them).
- Tin links his three logins himself (proof required); nothing is linked by address.

## 13. Recovery and rollback

- **Rollback = redeploy the previous Production deployment** (Vercel "Promote" of the prior deployment, or redeploy
  the previous commit). Never drop the 0014 tables or columns, and never delete migration history: the previous code
  ignores them.
- What the previous code shows after a rollback: projects by legacy owner only (as before); projects soft-deleted in
  the new release reappear for their legacy owner; projects created in the new release appear for their creator;
  memberships, connections and identities are kept and come back when the new release is redeployed.
- Data recovery: the pre-rollout backup restores any table (`scripts/capacity/backupRestore.ts`), proven by the
  rehearsal before use. Soft-deleted projects are restored by clearing `deleted_at`.
- A wrong merge is not undone by code: the merge request, choices and moved counts are in `merge_requests` and
  `identity_audit`; the merged record is kept (`status = 'merged'`, `merged_into`), so the operator can restore it from
  the backup if needed. Merges need an explicit choice for every difference and expire after 30 minutes.

## 14. Tests

`npx vitest run` (34 files, 441 tests), `npx tsc --noEmit`, `npx eslint app lib scripts tests` (0 errors) and
`npx next build` pass. Essential areas:

| Area | Where |
| --- | --- |
| Admission (domains, hd, Gmail exception, analytics accounts, look-alikes) | `tests/unit/eligibility.test.ts`, `workspaceMembers.test.ts` |
| Identities, linking, merge preview and explicit choices, replay/expiry | `workspaceMembers.test.ts` |
| All-projects visibility; viewer refusal for forged ids on every mutation route | `isolation.test.ts`, `workspaceMembers.test.ts` |
| Shared managers' full powers; last-manager and primary-manager invariants | `workspaceMembers.test.ts` |
| Privacy of keys, budgets, saved reports, inbox; cross-workspace isolation | `isolation.test.ts`, `ga4Reports.test.ts`, `notifications.test.ts` |
| Connections keep the session; resource validation; encrypted tokens | `workspaceMembers.test.ts` |
| Encrypted keys usable after migration and merge; allowances added, not duplicated | `workspaceMembers.test.ts`, `credentials.test.ts`, `workspaceMigration.test.ts` |
| Manual vs scheduled billing; transfer cancels; recheck at execution | `workspaceMembers.test.ts`, `credentials.test.ts`, `budgets.test.ts` |
| Coalescing: cache hits make no paid or provider calls, also for a teammate | `syncCache.test.ts`, `ga4Reports.test.ts`, `moduleUpdate.test.ts` |
| Sharing subscribes, personal mutes, Asana assignee routing | `notifications.test.ts` |
| GA4, Organic SERP, KPI, Docs, sync and cron still working | existing suites (all passing) |
| Migration mapping, no plaintext copied, idempotency, report | `workspaceMigration.test.ts` |
