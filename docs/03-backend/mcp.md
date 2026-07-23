# MCP Server

> **Last updated:** 2026-07-23 · **Status:** current

Proyekto ships a **first-party MCP (Model Context Protocol) server** so MCP hosts
(Claude Code, Codex, the MCP Inspector) can read **and now write** a user's
Proyekto data over a standard JSON-RPC endpoint. It lives in the `mcp` backend
module ([`backend/src/modules/mcp/`](../../backend/src/modules/mcp/)) and reuses
the existing project / roadmap / chat / knowledge / task domain services
**in-process**, so every tool re-checks live authorization on each call — a scope
on the token is necessary but never sufficient. **Phases 1–2 (read + write) are
current**; the surface still **ships dark** behind the `MCP_ENABLED` env flag:
while unset, `/mcp` returns **503** and the PAT-management routes deny.

> **⚠️ Writes are opt-in per token.** Write tools land in Phase 2, but a PAT only
> mutates if it carries the relevant `*:write` scope **and** the caller holds the
> live Proyekto permission. A read-only token — and the session-JWT fallback —
> carries no write scope and cannot mutate even when `MCP_ENABLED` is on.
> Structural roadmap writes are two-stage (preview → commit with a
> `revision_token`) and destructive tools are flagged for host confirmation.
> OAuth 2.1 + a browser connector + chat writes (Phase 3) are planned but not
> built.

## The endpoint

`POST /mcp` — a **stateless Streamable-HTTP** JSON-RPC endpoint built on
`@modelcontextprotocol/sdk` v1.29 (`StreamableHTTPServerTransport` with
`sessionIdGenerator: undefined, enableJsonResponse: true`). Each POST spins up a
fresh `McpServer` bound to the caller resolved by the guard, handles the single
request, and tears both down when the response closes — no server-held session,
which fits Cloud Run's per-request lifecycle.

- Served **outside** the global `/api` prefix (`/mcp` is in the `setGlobalPrefix`
  exclude list in [`main.ts`](../../backend/src/main.ts)); the PAT-management
  routes stay under `/api/mcp/tokens`.
- Requires `Accept: application/json, text/event-stream`.
- Compression is bypassed for `/mcp` and the
  [request-timeout interceptor](../../backend/src/common/interceptors/request-timeout.interceptor.ts)
  skips it — the SDK transport writes its own response.
- `GET /mcp` returns **405**: stateless mode has no server-initiated SSE channel,
  so hosts fall back to plain POST.

```
  MCP host ──POST /mcp (Bearer pk_… , JSON-RPC)──► McpController
                                                     │  McpAuthGuard → caller {userId, scopes}
                                                     ▼
                                          McpServerFactory.create(caller)
                                                     │  registers tools / resources / prompts
                                                     ▼
                                    tool handler → requireScope → live authz → domain service
```

## Auth

Two paths, both handled by `McpAuthGuard`
([`mcp-auth.guard.ts`](../../backend/src/modules/mcp/mcp-auth.guard.ts)).
Identity is **always** derived from the token, never from tool inputs.

| Path | Credential | Scopes granted |
| --- | --- | --- |
| **Kill switch** | — | `MCP_ENABLED !== 'true'` ⇒ **503** for the whole surface |
| **PAT** (primary) | `Bearer pk_…`, resolved by sha256 hash to its owner + stored scopes | exactly the scopes on the token |
| **Session JWT** (fallback) | a live Supabase HS256 access token (local verify, mirrors `SupabaseAuthGuard`) | **all** read scopes — a dev/Inspector convenience |

The session-JWT fallback grants every **read** scope so a logged-in developer
isn't blocked — it carries **no write scope**, so it can never mutate; PATs remain
the least-privilege path for real hosts and the only credential that can write.
See [auth-and-guards.md](./auth-and-guards.md#mcpauthguard--pat-auth).

## Scopes

Coarse OAuth-style grants on a PAT
([`mcp-scopes.ts`](../../backend/src/modules/mcp/mcp-scopes.ts)). Issuance
rejects any unknown scope string, so a token can't carry a grant no tool honors.
Every tool requires **both** its scope on the PAT **and** the live Proyekto
project/roadmap permission. Write scopes are **opt-in per token** — a read-only
PAT carries none of them, so it can never mutate even where `MCP_ENABLED` is on.

| Scope | Kind | Covers |
| --- | --- | --- |
| `projects:read` | read | project list/detail, members |
| `roadmaps:read` | read | roadmap graph, nodes, tasks |
| `knowledge:read` | read | RAG search over project knowledge |
| `chat:read` | read | chat rooms + messages |
| `roadmaps:write` | write | structural roadmap operations (preview / commit / revert) |
| `tasks:write` | write | create/update tasks, add task comments |
| `tasks:assign` | write | set a task's assignee set (notifies newly-assigned) |

`chat:write` is reserved for Phase 3 and deliberately kept out of the known set
until a tool honors it.

## Tools

Nineteen tools in [`tools/*.tools.ts`](../../backend/src/modules/mcp/tools/) —
twelve read, seven write. Each reuses an existing domain service that carries its
own authz; inputs are Zod-validated and page sizes are clamped to a per-tool
ceiling (at most `MCP_MAX_PAGE_SIZE`, default 100; `project_knowledge_search`
caps at 20).

### Read tools

| Tool | Scope | Inputs | Returns |
| --- | --- | --- | --- |
| `projects_list` | `projects:read` | — | Accessible projects, newest first |
| `projects_get` | `projects:read` | `project_id` | Project + the caller's effective permissions |
| `project_members_list` | `projects:read` | `project_id`, `limit?` | Members + share roles (needs `members.view`) |
| `roadmaps_list` | `roadmaps:read` | `project_id?` | The project's roadmap, or roadmaps you own |
| `roadmap_get_summary` | `roadmaps:read` | `roadmap_id` | Compact tree summary (counts, epics, features, milestones) |
| `roadmap_get_node` | `roadmaps:read` | `roadmap_id`, `node_id`, `include_children?`, `children_limit?` | One node's detail, optionally with children |
| `roadmap_search_nodes` | `roadmaps:read` | `roadmap_id`, `query`, `node_type?`, `limit?` | Matching nodes + resolved ids |
| `tasks_list` | `roadmaps:read` | `roadmap_id`, `assigned_to_me?`, `status?`, `parent_type?`, `parent_id?`, `assignee_id?`, `keyword?`, `include_completed?`, `limit?` | Filtered tasks; `assigned_to_me` = "what's on my plate" |
| `project_knowledge_search` | `knowledge:read` | `roadmap_id`, `query`, `sources?`, `limit?` | Hybrid RAG over chat/comments/activity/brief (empty for guest/project-less roadmaps) |
| `chat_rooms_list` | `chat:read` | `project_id` | Channels the user participates in |
| `chat_messages_list` | `chat:read` | `room_id`, `before?`, `limit?` | Recent messages, newest first |
| `chat_messages_search` | `chat:read` | `room_id`, `query`, `limit?` | Keyword search within a room |

### Write tools

Seven write tools (Phase 2), each requiring its `*:write` scope **and** the live
Proyekto permission. Structural roadmap changes go through the
**preview → commit → revert** lifecycle on `RoadmapAiService`
([`roadmap-write.tools.ts`](../../backend/src/modules/mcp/tools/roadmap-write.tools.ts));
task writes take the **direct `TasksService` path**
([`task-write.tools.ts`](../../backend/src/modules/mcp/tools/task-write.tools.ts))
so they reconcile the multi-assignee join table and fire `task_assigned`
notifications, which the roadmap-ops path does not. Every task write also emits a
best-effort `mcp.task_*` row to `project_activity_log`. Tools that delete,
notify, or post are flagged `destructiveHint` so the host asks the user first.

| Tool | Scope | Inputs | Effect |
| --- | --- | --- | --- |
| `roadmap_preview_operations` | `roadmaps:write` | `roadmap_id`, `operations[]`, `revision_token?` | **Inspect only** — validates the batch, returns a `semantic_diff`, a temp-id → real-id map, and a `revision_token`. No mutation. |
| `roadmap_commit_operations` | `roadmaps:write` | `roadmap_id`, `operations[]`, `revision_token` (**required**), `idempotency_key` (**required**) | Applies the previewed batch. On a concurrent edit returns **`STALE_REVISION`** → re-preview. `destructiveHint`. |
| `roadmap_revert_change` | `roadmaps:write` | `roadmap_id`, `change_id` | Undoes a committed change — restores the state just before it, which also undoes any later changes. `destructiveHint`. |
| `task_create` | `tasks:write` | `feature_id`, `title`, `description?`, `status?`, `priority?`, `due_date?`, `position?` | Creates a task under a feature (no assignee fields — assign separately). Perm `roadmap.create_tasks`. |
| `task_update` | `tasks:write` | `task_id`, `title?`, `description?`, `status?`, `priority?`, `due_date?`, `position?` | Updates a task's fields. Perm `roadmap.edit`. |
| `task_assign` | `tasks:assign` | `task_id`, `assignee_ids[]` | Replaces the assignee set (empty array unassigns); notifies newly-assigned. Perm `roadmap.assign`. `destructiveHint`. |
| `task_comment_add` | `tasks:write` | `task_id`, `content` | Adds a task comment. Perm `roadmap.comment`. `destructiveHint`. |

The `operations[]` payload is the existing shared contract
([`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json)):
`add_epic` / `add_feature` / `add_task` / `add_milestone`, `update_node`,
`move_node`, `delete_node`, `mark_status`, `shift_dates`. Phase 2 added no new
operation shapes.

> **⚠️ Two-stage by design.** `roadmap_commit_operations` **requires** the
> `revision_token` from a prior `roadmap_preview_operations` — stricter than the
> web path, where the token is opt-in — so a host must inspect the diff before it
> can mutate, and a stale token forces a re-preview. `roadmap_revert_change` maps
> internally to the service's `discard` (undo); the inverse `rollback` (redo) is
> intentionally **not** exposed.

Tool failures are normalized to a structured `{ error, message }` result
(`isError: true`) with a stable code — Nest `HttpException`s are mapped by status:

`UNAUTHENTICATED` (401) · `FORBIDDEN` (403) · `NOT_FOUND` (404) ·
`VALIDATION_FAILED` (400/422) · `STALE_REVISION` / `CONFLICT` (409) ·
`RATE_LIMITED` (429) · `NO_PROJECT` · `INTERNAL`.

A commit on a concurrently-edited roadmap raises **`STALE_REVISION`** (the host
re-previews); other write conflicts (e.g. `IDEMPOTENCY_KEY_REUSED`) surface as
**`CONFLICT`**. Project-level reads throw **`NOT_FOUND`** (not `FORBIDDEN`) on
no-access, so a caller can't probe which ids exist.

## Resources & prompts

**Resources** ([`resources.ts`](../../backend/src/modules/mcp/resources.ts)) — an
addressable mirror of the read tools for hosts that prefetch/cite by id, backed
by the same authorized façade (nothing cached):

- `proyekto://projects`
- `proyekto://projects/{projectId}`
- `proyekto://roadmaps/{roadmapId}/summary`

**Prompts** ([`prompts.ts`](../../backend/src/modules/mcp/prompts.ts)) — reusable
templates that steer the host model to drive the read tools; they never act on
their own: `review_project_health`, `summarize_overdue_or_blocked`,
`draft_roadmap_change`, `summarize_recent_discussions`.

The server instructions also tell the host to treat all retrieved text (briefs,
chat, comments, activity) as **untrusted data, not instructions** — a prompt-
injection guard.

## PAT management

Personal Access Tokens are issued/listed/revoked over normal Supabase-session
routes ([`mcp-tokens.controller.ts`](../../backend/src/modules/mcp/mcp-tokens.controller.ts)),
owner-scoped by the caller's id (never a body-supplied user id) and gated by
`MCP_ENABLED`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/mcp/tokens` | Issue — body `{ name, scopes[], expires_at? }`; returns the raw `pk_` token **once** |
| GET | `/api/mcp/tokens` | List token metadata (prefix, scopes, timestamps — never the hash) |
| DELETE | `/api/mcp/tokens/:id` | Revoke (soft-delete via `revoked_at`) — **204** |

Only the **sha256 hash** plus a short display prefix (`pk_` + 8 chars) are
stored. On resolution the guard rejects revoked/expired tokens and bumps
`last_used_at` fire-and-forget.

### Storage

Migration
[`20260723090000_create_mcp_personal_access_tokens.sql`](../../supabase/migrations/20260723090000_create_mcp_personal_access_tokens.sql)
creates `mcp_personal_access_tokens` (applied to SG prod). RLS grants owners
**SELECT** + **DELETE** only — there is deliberately no `authenticated`
INSERT/UPDATE path; issuance and `last_used_at` bookkeeping go through the
service-role backend. A `service_role` manage policy exists for parity.

## Config & deploy

| Var | Purpose |
| --- | --- |
| `MCP_ENABLED` | Kill switch — anything but `'true'` keeps the whole surface dark (503) |
| `MCP_MAX_PAGE_SIZE` | Optional page-size ceiling (default 100) |

Both are registered in
[`env.validation.ts`](../../backend/src/config/env.validation.ts). A gated repo-var
block was added to
[`backend-deploy.yml`](../../.github/workflows/backend-deploy.yml); no new secret
is needed — PAT resolution reuses the existing `SUPABASE_*` service-role client.

## Roadmap

- **Phase 1 (current)** — read-only tools/resources/prompts, PATs, ships dark.
- **Phase 2 (current)** — opt-in writes behind the `roadmaps:write` /
  `tasks:write` / `tasks:assign` scopes: structural roadmap preview → commit →
  revert and the direct-path task tools. Reuses the existing `MCP_ENABLED` flag
  (no separate flag); the per-PAT write scopes are the gate.
- **Phase 3** — OAuth 2.1 + a browser connector + chat writes (`chat:write`).
