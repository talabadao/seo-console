# Routes added or changed in this release (#18–#24)

## Pages (v2 shell)
| Address | Page | Notes |
|---|---|---|
| `/account[/usage\|budgets\|notifications\|sync][?project=<id>]` | Account settings | Account-scoped. `?project` only pre-selects a filter. Open it from the avatar menu (bottom-left). |
| `/p/<id>/organic-serp/se-ranking` | Rank tracking → SE Ranking | Live (was Planned). |
| `/p/<id>/organic-serp/organic[/google\|bing\|yandex\|naver]` | Rank tracking → Organic SERP | The engine is the sub-path. |
| `/docs`, `/docs/<slug>` | Docs list and article | Moved to the header, next to the notification bell. |

## Redirects (old bookmarks keep working, same project)
| Old | New |
|---|---|
| `/p/<id>/settings/account[/…]`, `/portfolio/settings/account` | `/account?project=<id>` / `/account` |
| `/p/<id>/ai-area/usage`, `/portfolio/ai-area/usage` | `/account/usage?project=<id>` / `/account/usage` |
| `/p/<id>/organic-serp/google\|bing\|yandex\|naver[/<sub>]` | `/p/<id>/organic-serp/organic/<engine>` (old sub-path dropped) |
| `/portfolio/organic-serp/<engine>` | `/portfolio/organic-serp/organic/<engine>` (pick a project) |

AI Area → Google Search Tracking (`/p/<id>/ai-area/google-search-tracking`) is unchanged and separate from Organic SERP.

## API (all require a signed-in allowlisted account; project routes check ownership)
| Route | Methods | What it does |
|---|---|---|
| `/api/account/sync` | GET, POST | Sync & cache status. POST runs ≤10 of the account's due jobs (45 s) and the notification rules. |
| `/api/cron/sync` | GET | Production-only scheduled tick (CRON_SECRET). On Preview it returns `skipped`. |
| `/api/v2/seranking/<id>` | GET | SE Ranking report: `days`, `compare`, `engine`, `group`, `refresh`. Served from the shared cache. |
| `/api/v2/organic-serp/<id>` | GET, POST | GET is history, saved searches and tracked domain (DB only). POST is an explicit, metered run. |
| `/api/v2/organic-serp/<id>/quote` | GET | Expected usage and limit check before a run. Reads only. |
| `/api/v2/organic-serp/<id>/snapshots/<sid>` | GET | One saved snapshot, from the DB only. |
| `/api/v2/organic-serp/<id>/configs` | POST, DELETE | Saved searches. |
| `/api/notifications` | GET | The account's notifications (`project`, `limit`, `unread`). Runs the rules after responding (throttled). |
| `/api/notifications/read` | POST | Marks read or unread by ids or all, optionally per project. Own rows only. |
| `/api/notifications/settings` | GET, PUT | Thresholds and minimum volumes. |
| `/api/docs` | GET, POST | GET lists published articles (drafts too for Docs admins). POST creates or updates a draft (admins only). |
| `/api/docs/<slug>` | GET, POST | GET returns one article. POST publishes or unpublishes (admins only). |
| `/api/v2/thumbnails/<id>` | GET | Page thumbnails for URLs on the project's own site. |

## Migrations
| Id | Tables | Notes |
|---|---|---|
| 0008_sync_cache | report_cache, sync_jobs, provider_rate, provider_cooldown | Shared cache and durable jobs |
| 0009_organic_serp | serp_configs, serp_snapshots | Organic SERP |
| 0010_notifications_docs | notifications, notification_settings, doc_articles | Notifications and Docs |
| 0011_page_meta | page_meta | Content thumbnails |

All four are additive, with new tables only. Preview and development apply them automatically on first database access. Production never self-migrates: see PRODUCTION-PILOT.md.

## Environment variables introduced
| Name | Where | Purpose |
|---|---|---|
| `CRON_SECRET` | Production | Authorizes `/api/cron/sync`. Vercel sends it to crons. |
| `DOCS_ADMIN_EMAILS` | Any | Comma-separated Docs admins. Each must also be on the sign-in allowlist. When unset, nobody can publish. |
