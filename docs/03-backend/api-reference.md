# API Reference

> **Last updated:** 2026-08-28 · **Status:** current

Every HTTP route the backend exposes, grouped by module. All paths carry the global
`/api` prefix — the exceptions are `POST /mcp` and the OAuth surface (`/oauth/*`,
`/.well-known/*`), served off the `/api` tree because MCP hosts and OAuth clients
look for them at clean root paths (see [mcp](#mcp--mcp--oauth--apimcp)). Unless a
row says otherwise, the route requires a Supabase JWT
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
| PATCH | /api/auth/onboarding/complete | Supabase | Mark onboarding complete (empty body; legacy `lane`/`intent` accepted-but-ignored) |
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
| GET·PATCH·DELETE | /api/projects/:id | Supabase | Get / update / guarded delete (active finance records block) |
| POST | /api/projects/:id/transfer-owner | Supabase | Transfer ownership |
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

**`teams`** — list/create (create and update accept `tags: string[]`, normalized
server-side to at most 20 labels of 40 chars), `GET /teams/me/invites` + respond, workspace defaults,
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
| GET | /api/marketplace/talent | +ConsultantOnly | Browse talent pool |
| POST | /api/marketplace/go-live | Supabase | Go live in the marketplace |
| POST | /api/marketplace/invite | +ConsultantOnly | Invite a talent |
| GET·PATCH | /api/marketplace/invites[/me,/:id/respond] | Supabase | List / respond to invites |

## guests · `guests`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | /api/guests/create | Public +Throttler (5/60s) | Create guest user |
| GET | /api/guests/by-session/:sessionId | Public +Throttler (30/60s) | Find guest by session |
| GET | /api/guests/pending/:sessionId | Public | Check pending guest data |
| POST | /api/guests/cleanup | +AdminGuard | Clean up old guests |

## admin · `admin` (all `+AdminGuard` except `/me`)

`GET /admin/me` (Supabase only), applications list/detail/approve/reject, admins
list/grant/revoke, `GET /admin/match-candidates` + `POST /admin/match-assign`,
`GET /admin/projects`, `GET /admin/users`.

## payouts · `payout-methods` / `payouts`

Payout methods CRUD + set-default under `/payout-methods`; payouts under `/payouts`
(create, `GET /payouts/teams/:teamId`, `GET /payouts/:payoutId[/proof-url]`,
`POST /payouts/:payoutId/void`), plus a payer view of a member's methods.

## invoices · `invoices`

`GET /invoices/project/:projectId`, `POST /invoices`, `GET/PATCH /invoices/:id`,
`POST /invoices/:id/issue`, `POST /invoices/:id/generate-pdf`. Authenticated
invoice operations require verified consultant capability and a `project_access` row with
`role=owner`. Delivery to the recipient is by attached PDF; the in-app notification returns
them to the project overview.

**The payer's side** (2026-08-28): `GET /invoices/received` lists every non-draft invoice
whose `recipient_user_id` is the caller, with ledger-derived `amount_paid` / `balance_due` /
`is_overdue` (a `paid` invoice with no ledger rows counts as collected in full, the same
rule the portfolio holds); `GET /invoices/received/:id` returns the payer-shaped detail —
header, priced lines, payment history with notes and recorder redacted — and misses return
404, never 403. Both are declared before `:id` so the literal segment is not captured as an
id. `GET /invoices/:id/pdf-url` now also serves the recipient of a non-draft invoice;
every other caller still passes the project finance gate. Surfaced as "Invoices to pay" on
`/engagements/finance/me`.

## finance · `finance`

The consultant-only portfolio behind `/finance`:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /api/finance/portfolio | +ConsultantOnly | Project, revenue, cost, and margin rollups grouped by currency |
| GET | /api/finance/contracts | +ConsultantOnly | Filtered cross-project contract list |
| GET | /api/finance/invoices | +ConsultantOnly | Filtered cross-project invoice list |

All three endpoints return only projects where the caller has active consultant capability
and a `project_access` row with `role=owner`. Filters cover search,
project, project status, currency, date range, and the relevant contract or
invoice status. Totals are never converted across currencies.

## finance books · `finance-books` / `finance-invites` / `team-finance`

Books are the post-2026-08-27 finance surface: any execution user may create one, and a
contract unlocks **data**, not creation. Access is resolved by `FinanceBookAccessService`
over `finance_book_members`; a miss throws **NotFound, never Forbidden**. See
[Finance books](../11-domains/finance/finance-books.md).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /api/finance-books | Supabase | Books the caller can reach |
| GET | /api/finance-books/hub | Supabase | The unified hub payload |
| GET | /api/finance-books/engaged-projects | Supabase | Projects where the caller is contract-engaged |
| GET | /api/finance-books/personal/dashboard | Supabase | Personal (F1) dashboard |
| POST | /api/finance-books/personal | Supabase | Create the caller's personal book |
| POST | /api/finance-books/team | Supabase | Create a team book (team owner) |
| POST | /api/finance-books/:bookId/projects | Supabase | Create a project book under a team book |
| GET | /api/finance-books/:bookId | Supabase | Book detail |
| GET | /api/finance-books/:bookId/overview | Supabase | Book dashboard figures |
| GET/POST | /api/finance-books/:bookId/members | Supabase | List / add members |
| PATCH/DELETE | /api/finance-books/:bookId/members/:memberId | Supabase | Change role or remove |
| POST/GET | /api/finance-books/:bookId/invites | Supabase | Issue / list invites |
| DELETE | /api/finance-books/:bookId/invites/:inviteId | Supabase | Cancel an invite |
| GET | /api/finance-invites/:token | Supabase | Read an invite by token |
| POST | /api/finance-invites/:token/accept · /decline | Supabase | Respond |
| GET | /api/finance-books/:bookId/export | Supabase | `.csv` / `.xlsx` / `.pdf`; cost columns dropped without `view_costs` |
| GET | /api/team-finance/teams | Supabase | Teams the caller administers |
| GET | /api/team-finance/teams/:teamId/portfolio · /contracts · /invoices | Supabase | Team-scoped finance, revenue side only |

## finance imports · `finance-imports`

> **⚠️ Dark in production** — `20260826090000_finance_document_imports.sql` is not applied,
> so every route below fails on missing tables. See
> [Document imports](../11-domains/finance/document-imports.md).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST/GET | /api/finance-imports/documents | Supabase | Upload / list source documents |
| GET | /api/finance-imports/documents/:id | Supabase | Document detail |
| GET | /api/finance-imports/documents/:id/file | Supabase | Presigned fetch of the original |
| POST | /api/finance-imports/documents/:id/read | Supabase | Run text extraction |
| DELETE | /api/finance-imports/documents/:id | Supabase | Remove a document |
| POST | /api/finance-imports/invoices | Supabase | Commit an imported invoice (`origin='imported'`) |
| GET | /api/finance-imports/invoices/:invoiceId/snips | Supabase | Evidence regions behind one invoice |

## contracts · `contracts` / `projects/:projectId/economics`

Three controllers share the module: contract lifecycle, the tokenized signing link, and
project economics. Signing errors surface as 22 typed tokens translated by
`SIGNING_ERRORS` — see [Engagements → integration surface](../14-engagement/integration.md#error-codes).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /api/contracts/project/:projectId | Supabase | Contracts for a project |
| POST | /api/contracts/counterparties/resolve | Supabase | Resolve an existing account as counterparty by exact email |
| POST | /api/contracts | Supabase | Create a draft (two `contract_positions`) |
| GET | /api/contracts/:id | Supabase | Contract detail and rendered payload |
| PATCH | /api/contracts/:id | Supabase | Edit a `draft` or `sent` contract |
| DELETE | /api/contracts/:id | Supabase | Delete a draft |
| POST | /api/contracts/:id/sign | Supabase | Stamp a signature; the final one activates the engagement |
| POST | /api/contracts/:id/initials | Supabase | Save per-page initials |
| POST | /api/contracts/:id/unsign | Supabase | Withdraw a signature |
| PATCH | /api/contracts/:id/signature-placement | Supabase | Cosmetic signature reposition |
| POST | /api/contracts/:id/amend | Supabase | Create the next contract version |
| POST | /api/contracts/:id/provider | Supabase | Reseed the provider identity |
| GET/POST/DELETE | /api/contracts/:id/signature-link | Supabase | Manage the single-use client signing link |
| GET | /api/contracts/sign/:token | Public +Throttler | Read a contract by signing token (account-free) |
| POST | /api/contracts/sign/:token | Public +Throttler | Sign by token; runs the same checks as in-app signing |
| GET | /api/projects/:projectId/economics | Supabase | Project budget economics (finance settings + member allocations) |
| PUT | /api/projects/:projectId/economics | Supabase | Update project budget economics |

## engagements · `engagements`

The party-scoped read path over the activation-written commercial tables. Deliberately
**no** `ConsultantOnly` guard — access is decided by seat membership in the service, so
Clients and Talent can read their own agreements. A non-party fetch returns 404, not 403,
so engagement ids cannot be probed. See [Engagements](../14-engagement/README.md).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /api/engagements | Supabase | Engagements the caller holds a seat on (`kind`, `status`, `project_id` filters) |
| GET | /api/engagements/agreements | Supabase | Every contract the caller is a party to — declared before `:id` so it is not captured by the UUID pipe |
| GET | /api/engagements/:id | Supabase | One engagement — seats, counterparty, project links, effective settings and rates |

## meetings · `meetings`

`POST /meetings`, `GET /meetings[/project/:projectId]`, `GET /meetings/:id`,
`PATCH /meetings/:id[/details]`, `POST /meetings/:id/cancel`, `POST /meetings/:id/respond`.
`POST /meetings/cron/reminders` is **Public +CronSecret** (the scheduler). Full docs:
[Feature Domains → Meetings](../11-domains/README.md).

## chat · `projects/:projectId/chat` / `chat` / `chat/dm`

**`chat`** — project rooms/members, channel CRUD + members, room messages, send/
react/unsend, mark-read. **`chat-rooms`** (base `chat`) — room-agnostic messages,
search, library, star, edit/react/unsend. **`chat-dm`** (base `chat/dm`) — DM rooms,
eligible members, resolve, messages, send/react/unsend.

## activity · `projects/:projectId/activity`

`GET /projects/:projectId/activity` — the project activity timeline backing the
Logs page. Gated on `logs.view`; rows flagged `is_sensitive` (access grants,
share links, role changes) are filtered out unless the caller also holds
`logs.view_sensitive`, which the response reports as `can_view_sensitive`.

Keyset-paginated on `(created_at DESC, seq DESC)` — `created_at` is stamped at
event time, so it is chronological even when a slow flush lands a row late.
Returns `{ items, next_cursor, can_view_sensitive }`; pass `next_cursor` back as
`?cursor=`. **There is no `offset`** — sending one is a 400. Filters: `limit`
(1–100), `family`, `action`, `entity_type`, `actor_id`, `roadmap_id`,
`entity_id`, `from`, `to`.

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

No HTTP routes — `AuditService` is a pure writer, consumed internally by the
roadmap, projects, chat and MCP modules. Reads are served by the `activity`
module above.

## mcp · `/mcp` · `/oauth` · `/api/mcp`

The first-party MCP server (read + write since Phase 2). `POST /mcp` is served
**outside** the `/api` prefix and gated by `McpAuthGuard` (a Proyekto PAT, an
OAuth access token, or a Supabase session JWT); the whole surface is **503**
unless `MCP_ENABLED === 'true'`. Writes require an opt-in `*:write` scope on the
credential plus the live Proyekto permission. PAT-management and consent routes
use `SupabaseAuthGuard` and are owner-scoped. Full page:
[MCP Server](./mcp.md).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | /mcp | McpAuth (PAT, OAuth, or JWT) | Stateless Streamable-HTTP JSON-RPC (tools/resources/prompts) |
| GET | /mcp | McpAuth | **405** — stateless mode has no SSE channel |
| POST | /api/mcp/tokens | Supabase | Issue a PAT — returns the raw `pk_` token once |
| GET | /api/mcp/tokens | Supabase | List own token metadata (never the hash) |
| GET | /api/mcp/tokens/scopes | Supabase | `{ scopes }` — scopes a PAT may currently be issued for (dark scopes omitted) |
| DELETE | /api/mcp/tokens/:id | Supabase | Revoke a PAT (204) |

### OAuth 2.1 authorization server (Phase 3)

Served off the `/api` prefix, unauthenticated (public clients authenticated by
PKCE), and **404 / 503 unless `MCP_OAUTH_ENABLED === 'true'`** on top of
`MCP_ENABLED`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /.well-known/oauth-protected-resource | Public | RFC 9728 metadata (**404** while dark) |
| GET | /.well-known/oauth-protected-resource/mcp | Public | Same document, resource-qualified path |
| GET | /.well-known/oauth-authorization-server | Public | RFC 8414 metadata (**404** while dark) |
| GET | /.well-known/oauth-authorization-server/mcp | Public | Same document, resource-qualified path |
| GET | /oauth/authorize | Public | Validate + park the request, **302** to the web consent screen |
| POST | /oauth/token | Public +Throttler (30/min) | `authorization_code` + `refresh_token` grants (form-encoded) |
| POST | /oauth/register | Public +Throttler (10/min) | RFC 7591 Dynamic Client Registration — **201** |
| POST | /oauth/revoke | Public +Throttler (30/min) | RFC 7009 — always **200** |

Errors on these routes are **flat RFC 6749 bodies**
(`{ error, error_description }`), not the `{ data }` / `{ error: {…} }` envelope.

The first-party half keeps the `/api` prefix:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /api/mcp/oauth/consent?request_id= | Supabase | What the consent screen renders |
| POST | /api/mcp/oauth/consent | Supabase | Approve → `{ redirect_to }` with the authorization code |
| POST | /api/mcp/oauth/consent/deny | Supabase | Decline → `{ redirect_to }` with `error=access_denied` |
| GET | /api/mcp/oauth/grants | Supabase | "Connected apps" — the caller's live grants |
| DELETE | /api/mcp/oauth/grants/:id | Supabase | Disconnect an app (204) |
