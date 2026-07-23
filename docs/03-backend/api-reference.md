# API Reference

> **Last updated:** 2026-07-23 · **Status:** current

Every HTTP route the backend exposes, grouped by module. All paths carry the global
`/api` prefix — the sole exception is `POST /mcp` (see [mcp](#mcp--mcp--apimcptokens)),
served off the `/api` tree for MCP hosts. Unless a row says otherwise, the route
requires a Supabase JWT
(`SupabaseAuthGuard`) and returns the `{ data }` envelope
([architecture.md](./architecture.md#response-envelope)).

## Conventions

- **Base URL:** `https://api.proyekto.tech/api` (prod) · `http://localhost:3001/api` (dev).
- **Auth column:** `Supabase` = JWT required · `Public` = `@Public()` (no auth) ·
  `+AdminGuard` / `+ConsultantOnly` / `+CronSecret` / `+OtaPublish` / `+Throttler` =
  an extra guard stacked on top. See [auth-and-guards.md](./auth-and-guards.md).
- Routes marked **410** are intentionally retired (`GoneException`).

## auth · `auth`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | /api/auth/email-verification/request | Public | Request email verification code |
| POST | /api/auth/email-verification/confirm | Public | Confirm email verification |
| POST | /api/auth/password-reset/request | Public | Request password reset |
| POST | /api/auth/password-reset/confirm | Public | Confirm password reset |
| GET | /api/auth/profile | Supabase | Current user's profile |
| POST | /api/auth/onboarding | Supabase | Submit onboarding data |
| PATCH | /api/auth/onboarding/complete | Supabase | Mark onboarding complete |
| PATCH | /api/auth/persona | Supabase | Switch active persona |
| PATCH | /api/auth/profile | Supabase | Update profile |

## users · `users`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /api/users/me | Supabase | Own user record |
| PATCH | /api/users/me | Supabase | Update own user |
| GET | /api/users/:id | Supabase | A user's public profile |

## profile · `profile`

All `Supabase`. Metadata: `GET /meta/skills`, `GET /meta/languages`. Profile:
`GET /:id`, `PATCH /` (basic fields), `PUT /skills` (replace set),
`PUT /rate-settings`. Each sub-entity has add/update/delete:
`languages`, `educations`, `certifications`, `experiences`, `portfolios`,
`licenses`, `specializations` (`POST /x`, `PATCH /x/:id`, `DELETE /x/:id`), and
`identity_documents` (`POST`, `DELETE /:id`).

## projects · `projects`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /api/projects | Supabase | List user's projects |
| GET | /api/projects/dashboard[/summary] | Supabase | Dashboard projects / summary |
| GET | /api/projects/roadmap-link-candidates | Supabase | Linkable roadmaps |
| POST | /api/projects | Supabase | Create project |
| POST | /api/projects/from-roadmap | Supabase | Create from roadmap (blocks guests) |
| GET·PATCH·DELETE | /api/projects/:id | Supabase | Get / update / delete |
| POST | /api/projects/:id/transfer-owner | Supabase | Transfer ownership |
| POST | /api/projects/:id/reassign-consultant | Supabase | Reassign consultant |
| POST | /api/projects/:id/assign-consultant | +AdminGuard | Admin-assign consultant |
| * | /api/projects/:id/resources/{folders,links}… | Supabase | Resource folders/links CRUD + reorder |
| POST | /api/projects/:id/members · /invites | Supabase | Add member / invite by email |
| GET | /api/projects/me/invites | Supabase | My project invites |
| PATCH | /api/projects/invites/:inviteId/respond | Supabase | Respond to invite |
| GET·DELETE | /api/projects/:id/invites[/:inviteId] | Supabase | List / cancel invites |
| GET·PATCH | /api/projects/:id/permissions/role | Supabase | Role permissions |
| * | /api/projects/:id/members/:memberId… | Supabase | Member update / permissions / position / remove |
| GET | /api/projects/:id/my-permissions | Supabase | My permissions |
| POST | /api/projects/:id/members/leave | Supabase | Leave project |

## roadmaps · `roadmaps` / `epics` / `features` / `tasks` / `milestones`

**`roadmaps`** — list/preview/by-user/by-project/templates; `POST /migrate` (blocks
guests); `GET /:id`, `GET /:id/full`; `POST /`; `PATCH /:id`; template settings +
clone; `DELETE /:id`; AI-suggest metadata/intake. `GET /templates/public` is `Public`.
`GET /user/:userId` returns only the caller's own roadmaps — the sole cross-user case
is reading a **guest** profile's roadmaps during migration preview.

**`roadmap-patch`** (base `roadmaps`) — `POST /roadmaps/full` (create tree),
`PATCH /roadmaps/:id/json-patch`.

**`milestones`** (base `roadmaps`) — `GET/POST /roadmaps/:roadmapId/milestones`,
`GET/PATCH/DELETE /roadmaps/milestones/:id`, `PATCH …/reorder`.

**`epics`** — `GET /epics/roadmap/:roadmapId`, `GET /epics/:id`, `POST /epics`,
`PATCH /epics/reorder`, `PATCH/DELETE /epics/:id`, and epic comments CRUD.

**`features`** — by-epic / by-roadmap / by-id, create, `PATCH /features/reorder`,
`POST /features/link-milestone` + `DELETE /features/unlink-milestone`, update/delete,
comments CRUD. `POST /features/:id/assign` and `DELETE /:id/unassign` are **410**.

**`tasks`** (two controllers on base `tasks`) — by-feature / by-roadmap / by-id,
`GET /tasks/:id/history`, create, `POST /tasks/quick-create`, `PATCH /tasks/reorder`,
update/delete; `:id/assign` + `:id/unassign` are **410**. `task-extras`: comments,
attachments, and dependencies CRUD under `/tasks/:taskId/…`.

> **Authorization:** reads of roadmap children (epics/features/tasks/milestones and
> their comments/attachments, task dependencies, task history) require **view** access
> to the owning roadmap and return **404** on denial; writes require **edit** — with
> `PATCH /tasks/:id` additionally requiring `roadmap.assign` when it touches
> `assignee_id`/`assignee_ids`. See
> [auth-and-guards.md](./auth-and-guards.md#roadmap-resource-authorization).

### roadmaps AI · `roadmaps/:id/ai` and `roadmaps/:id/ai-sessions`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | /api/roadmaps/:id/ai/preview | Supabase | Generate an AI edit preview |
| GET | /api/roadmaps/:id/ai/previews/:previewId | Supabase | Fetch a preview |
| POST | /api/roadmaps/:id/ai/commit · /discard · /rollback | Supabase | Commit / discard / rollback |
| GET | /api/roadmaps/:id/ai/context/{summary,actor,members,resolve,search,features,tasks,nodes/…} | Supabase | Context reads (called by the agent) |
| GET·POST·DELETE | /api/roadmaps/:id/ai/memories[/:memoryId] | Supabase | Durable roadmap memories |
| GET·POST | /api/roadmaps/:id/ai-sessions | Supabase | List / create AI sessions |
| GET·PATCH·DELETE | /api/roadmaps/:id/ai-sessions/:sessionId | Supabase | Get / update / delete session |
| PUT | /api/roadmaps/:id/ai-sessions/:sessionId/agent-state | Supabase | Persist agent state snapshot |
| GET·POST | /api/roadmaps/:id/ai-sessions/:sessionId/messages | Supabase | List / append messages |

> **Authorization & contract:** context reads require **view** access
> (`assertCanViewRoadmap`); preview / commit / discard / rollback require **edit**
> (`assertCanEditRoadmap`). Commit is idempotent per `idempotency_key`, scoped to the
> caller and the `sha256` of its operations: an exact retry replays the first result,
> but reusing a key with different operations returns **409 `IDEMPOTENCY_KEY_REUSED`**
> (a stale `revision_token` still returns **409 `STALE_REVISION`**). Commit and
> rollback of a **project-linked** roadmap append a `roadmap.committed` /
> `roadmap.rolled_back` row to `project_activity_log` (personal roadmaps are skipped).
> A context node reports a milestone's date as `target_date` and a task's as `due_date`.

## roadmap-shares · `roadmap-shares`

`POST/GET/DELETE /roadmap-shares/:id` (manage a roadmap's share),
`GET /roadmap-shares/shared-with-me`, comment on shared epic/feature. `GET
/roadmap-shares/token/:shareToken` is **Public** (the shared-view entry point).

## teams · `teams` / `projects/:projectId/teams` / `…/rates`

**`teams`** — list/create, `GET /teams/me/invites` + respond, workspace defaults,
`GET/PATCH/DELETE /teams/:id`, members list/update/remove, `POST/GET/DELETE
/teams/:id/invites`. **`project-teams`** (base `projects/:projectId/teams`) — attach/
detach a team, curated + available members. **`team-member-rates`** (base
`teams/:teamId/members/:userId/rates`) — list/active/create/update/delete rates.

## team-time · `team-time`

Log lifecycle (`POST /logs/start`, `/logs/manual`, `/logs/:logId/stop`,
`/logs/:logId/review`, `/logs/review-bulk`), log CRUD + comments, `GET
/logs/me/running`, and team rollups (`GET /teams/:teamId/{my,my/summary,logs,
logs/summary,projects,members}` and per-project rate/tasks). All `Supabase`.

## consultants · `consultants` (Public)

`GET /consultants`, `GET /consultants/:id` — both **Public** (no class guard).

## applications · `applications`

`GET /applications/me`, `POST /applications` (upsert), `POST /applications/submit`.

## marketplace · `marketplace`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /api/marketplace/freelancers | +ConsultantOnly | Browse freelancer pool |
| POST | /api/marketplace/go-live | Supabase | Go live in the marketplace |
| POST | /api/marketplace/invite | +ConsultantOnly | Invite a freelancer |
| GET·PATCH | /api/marketplace/invites[/me,/:id/respond] | Supabase | List / respond to invites |

## guests · `guests`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | /api/guests/create | Public +Throttler (5/60s) | Create guest user |
| GET | /api/guests/by-session/:sessionId | Public +Throttler (30/60s) | Find guest by session |
| GET | /api/guests/pending/:sessionId | Public | Check pending guest data |
| POST | /api/guests/cleanup | Supabase | Clean up old guests |

## admin · `admin` (all `+AdminGuard` except `/me`)

`GET /admin/me` (Supabase only), applications list/detail/approve/reject, admins
list/grant/revoke, `GET /admin/match-candidates` + `POST /admin/match-assign`,
`GET /admin/projects`, `GET /admin/users`.

## payments · `payments`

Project checkpoints (`GET /payments/project/:projectId`, `POST /payments`,
`PATCH /payments/:id/complete`), escrow (`:id/fund`, `/release`, `/refund`), wallet
(`GET /payments/wallet[/transactions]`), and `POST /payments/wallet/admin/deposit`
(`+AdminGuard`).

> **⚠️** The checkpoint/escrow routes query the **dropped** `payment_checkpoints` /
> `transactions` tables and are effectively dead. Live money flows through
> [`payouts`](#payouts--payout-methods--payouts) and [`invoices`](#invoices--invoices).
> See [Data → schema overview](../07-data-and-db/schema-overview.md).

## payouts · `payout-methods` / `payouts`

Payout methods CRUD + set-default under `/payout-methods`; payouts under `/payouts`
(create, `GET /payouts/teams/:teamId`, `GET /payouts/:payoutId[/proof-url]`,
`POST /payouts/:payoutId/void`), plus a payer view of a member's methods.

## invoices · `invoices`

`GET /invoices/project/:projectId`, `POST /invoices`, `GET/PATCH /invoices/:id`,
`POST /invoices/:id/issue`, `POST /invoices/:id/generate-pdf`.

## meetings · `meetings`

`POST /meetings`, `GET /meetings[/project/:projectId]`, `GET /meetings/:id`,
`PATCH /meetings/:id[/details]`, `POST /meetings/:id/cancel`, `POST /meetings/:id/respond`.
`POST /meetings/cron/reminders` is **Public +CronSecret** (the scheduler). Full docs:
[Feature Domains → Meetings](../11-domains/README.md).

## chat · `projects/:projectId/chat` / `chat` / `chat/dm` / `projects/:projectId/activity`

**`chat`** — project rooms/members, channel CRUD + members, room messages, send/
react/unsend, mark-read. **`chat-rooms`** (base `chat`) — room-agnostic messages,
search, library, star, edit/react/unsend. **`chat-dm`** (base `chat/dm`) — DM rooms,
eligible members, resolve, messages, send/react/unsend. **`activity`** —
`GET /projects/:projectId/activity`.

## notifications · `notifications`

`GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/read-all`,
`PATCH /notifications/:id/read`, `DELETE /notifications/:id`.

## push · `push/tokens`

`POST /push/tokens` (register), `DELETE /push/tokens` (unregister).

## mobile-updates · `mobile-updates`

`POST /mobile-updates/check` + `/stats` are **Public** and return **raw** (Capgo
contract). `POST /mobile-updates/bundles/presign` + `/bundles` are **+OtaPublish**
(CI only).

## uploads · `uploads`

`POST /uploads/file` (25 MB multipart), `POST /uploads/confirm-avatar` /
`/confirm-banner` / `/confirm-project-banner`, `DELETE /uploads/avatar`. Backed by R2.

## realtime · `realtime`

`POST /realtime/authorize` — called by the Cloudflare Worker to authorize a room join.

## audit

No HTTP routes — `AuditService` is consumed internally (e.g. by chat/activity).

## mcp · `/mcp` · `/api/mcp/tokens`

The first-party MCP server (read + write since Phase 2). `POST /mcp` is served
**outside** the `/api` prefix and gated by `McpAuthGuard` (a Proyekto PAT or a
Supabase session JWT); the whole surface is **503** unless
`MCP_ENABLED === 'true'`. Writes require an opt-in `*:write` scope on the PAT plus
the live Proyekto permission. PAT-management routes use `SupabaseAuthGuard` and
are owner-scoped. Full page: [MCP Server](./mcp.md).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | /mcp | McpAuth (PAT or JWT) | Stateless Streamable-HTTP JSON-RPC (tools/resources/prompts) |
| GET | /mcp | McpAuth | **405** — stateless mode has no SSE channel |
| POST | /api/mcp/tokens | Supabase | Issue a PAT — returns the raw `pk_` token once |
| GET | /api/mcp/tokens | Supabase | List own token metadata (never the hash) |
| DELETE | /api/mcp/tokens/:id | Supabase | Revoke a PAT (204) |
