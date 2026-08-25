# MCP Server

> **Last updated:** 2026-08-25 · **Status:** current

Proyekto ships a **first-party MCP (Model Context Protocol) server** so MCP hosts
(Claude Code, Codex, the hosted Claude surfaces, the MCP Inspector) can read
**and** write a user's Proyekto data over a standard JSON-RPC endpoint. It lives
in the `mcp` backend module ([`backend/src/modules/shared/mcp/`](../../backend/src/modules/shared/mcp/))
and reuses the existing project / roadmap / chat / knowledge / task domain
services **in-process**, so every tool re-checks live authorization on each call
— a scope on the token is necessary but never sufficient. **Phases 1–5 are
current.** Three independent flags gate it: `MCP_ENABLED` covers the whole
surface (while unset `/mcp` returns **503** and the PAT routes deny),
`MCP_OAUTH_ENABLED` is a **second** gate over the Phase-3 OAuth 2.1
authorization server, and `MCP_CHAT_WRITE_ENABLED` is a **third**, narrower
gate over the Phase-4 `chat:write` scope and its three chat write tools. The
Phase-5 delivery scopes are deliberately **flagless** (owner decision,
2026-08-25): live wherever `MCP_ENABLED` is, gated per credential.

> **⚠️ Writes are opt-in per credential.** A token only mutates if it carries the
> relevant `*:write` scope **and** the caller holds the live Proyekto permission.
> A read-only PAT — and the session-JWT fallback — carries no write scope and
> cannot mutate even when `MCP_ENABLED` is on. Structural roadmap writes are
> two-stage (preview → commit with a `revision_token`) and destructive tools are
> flagged for host confirmation. On the OAuth path the consent screen leaves
> write scopes **unchecked** by default.

## The endpoint

`POST /mcp` — a **stateless Streamable-HTTP** JSON-RPC endpoint built on
`@modelcontextprotocol/sdk` v1.29 (`StreamableHTTPServerTransport` with
`sessionIdGenerator: undefined, enableJsonResponse: true`). Each POST spins up a
fresh `McpServer` bound to the caller resolved by the guard, handles the single
request, and tears both down when the response closes — no server-held session,
which fits Cloud Run's per-request lifecycle.

- Served **outside** the global `/api` prefix — `/mcp` is in the
  `setGlobalPrefix` exclude list in [`main.ts`](../../backend/src/main.ts),
  alongside the OAuth paths `.well-known/*splat` and `oauth/*splat`. The
  PAT-management routes stay under `/api/mcp/tokens`.
- Requires `Accept: application/json, text/event-stream`.
- Compression is bypassed for `/mcp` and the
  [request-timeout interceptor](../../backend/src/common/interceptors/request-timeout.interceptor.ts)
  skips it — the SDK transport writes its own response.
- `GET /mcp` returns **405**: stateless mode has no server-initiated SSE channel,
  so hosts fall back to plain POST.

```
  MCP host --POST /mcp (Bearer token, JSON-RPC)--> McpController
                                                     |  McpAuthGuard
                                                     |    -> caller {userId, scopes}
                                                     v
                                          McpServerFactory.create(caller)
                                                     |  registers tools /
                                                     |  resources / prompts
                                                     v
                            tool handler -> requireScope -> live authz -> domain service
```

> **⚠️ The `mcp` prefix exclusion is EXACT-match on purpose.** Widening it to a
> wildcard would silently move `/api/mcp/tokens` to `/mcp/tokens` and break the
> web settings page — which is also why the OAuth consent/grants controller,
> mounted at `mcp/oauth`, correctly stays under `/api`.

## Auth

Three credential paths plus a kill switch, all handled by `McpAuthGuard`
([`mcp-auth.guard.ts`](../../backend/src/modules/shared/mcp/mcp-auth.guard.ts)).
Identity is **always** derived from the token, never from tool inputs.

| Path | Credential | Scopes granted |
| --- | --- | --- |
| **Kill switch** | — | `MCP_ENABLED !== 'true'` ⇒ **503** for the whole surface |
| **PAT** | `Bearer pk_…`, resolved by sha256 hash to its owner + stored scopes | exactly the scopes on the token |
| **OAuth access token** | a stateless HS256 JWT this server minted, audience-bound to the MCP resource | exactly the scopes in the `scope` claim |
| **Session JWT** (fallback) | a live Supabase HS256 access token (local verify, mirrors `SupabaseAuthGuard`) | **all** read scopes — a dev/Inspector convenience |

The fallback's scope list is spread from `MCP_READ_SCOPES` rather than spelled
out, so a read scope added later can't silently miss that branch and — because
the constant holds only read scopes — no write scope can structurally leak into
it.

Order matters: a `pk_` prefix short-circuits to the PAT path, then the OAuth
verify runs (only while `MCP_OAUTH_ENABLED` is on), then the Supabase-session
fallback. The session fallback grants every **read** scope so a logged-in
developer isn't blocked — it carries **no write scope**, so it can never mutate;
PATs and OAuth tokens remain the least-privilege paths for real hosts.
See [auth-and-guards.md](./auth-and-guards.md#mcpauthguard--pat--oauth-auth).

**The 401 challenge.** Once OAuth is live, *every* 401 from the guard carries an
RFC 9728 `WWW-Authenticate` header naming the protected-resource metadata
document and the full scope set:

```
WWW-Authenticate: Bearer resource_metadata="https://api.proyekto.tech/.well-known/oauth-protected-resource/mcp", scope="…"
```

That header is the only way an OAuth client discovers the authorization server —
Claude does not honour it on a `200`. While `MCP_OAUTH_ENABLED` is unset the
challenge is **not** emitted, so an unauthenticated caller just gets a bare 401
exactly as in Phases 1–2.

## Scopes

Coarse OAuth-style grants
([`mcp-scopes.ts`](../../backend/src/modules/shared/mcp/mcp-scopes.ts)) — eleven of them,
six read and five write, carried either on a PAT or in an OAuth access token.
PAT issuance rejects any unknown scope string and the OAuth server drops any it
doesn't recognize, so a credential can't carry a grant no tool honors. Every tool
requires **both** its scope **and** the live Proyekto project/roadmap permission.

| Scope | Kind | Covers |
| --- | --- | --- |
| `projects:read` | read | project list/detail, members |
| `roadmaps:read` | read | roadmap graph, nodes, tasks, durable change history |
| `knowledge:read` | read | RAG search over project knowledge |
| `chat:read` | read | chat rooms + messages |
| `ai-sessions:read` | read | the caller's **own** roadmap AI planning threads (Phase 4) |
| `delivery:read` | read | the delivery registers: deliverables, change requests, risks & issues, decisions (Phase 5) |
| `roadmaps:write` | write | structural roadmap operations (preview / commit / revert) |
| `tasks:write` | write | create/update tasks, add task/epic/feature comments |
| `tasks:assign` | write | set a task's assignee set (notifies newly-assigned) |
| `chat:write` | write | send / edit / unsend **channel** messages (Phase 4) — dark unless `MCP_CHAT_WRITE_ENABLED` |
| `delivery:write` | write | register writes + lifecycle verbs (Phase 5) — flagless, live on deploy |

The OAuth server advertises the currently **enabled** scopes **plus
`offline_access`** (`supportedScopes()` in
[`oauth-config.service.ts`](../../backend/src/modules/shared/mcp/oauth/oauth-config.service.ts);
the `OAUTH_SUPPORTED_SCOPES` constant beside it is the *static* universe, kept
for validation and tests). `offline_access` is the standard OAuth signal *"give
me a refresh token"*, **not** a Proyekto permission: it is honoured by minting a
refresh token and then filtered out of the access token's MCP scope set, so it
grants no tool access.

### Dark scopes

`chat:write` **is** in the scope enum, but it is not necessarily live. Phases
1–3 needed no per-feature flag because `MCP_ENABLED` was still off in prod
while they landed; both `MCP_ENABLED` and `MCP_OAUTH_ENABLED` are on now, so
the moment a scope enters the enum it reaches discovery, the 401 challenge,
and the consent screen **on deploy, with no activation step**. For writes that
post text real people read, that breaks the staged-rollout rule. (Phase 5's
`delivery:write` deliberately took the flagless path instead — an explicit
owner decision at activation time, 2026-08-25.)

So the flag is resolved in exactly one place —
[`mcp-capabilities.service.ts`](../../backend/src/modules/shared/mcp/mcp-capabilities.service.ts)
— and read at four points; the first three are the enforcement, the fourth only
keeps the UI honest:

| Enforcement point | Effect while dark |
| --- | --- |
| Tool registration (`mcp-server.factory.ts`) | a dark scope's write tools are never registered, so they never appear in `tools/list` |
| Token issuance (`mcp-token.service.ts`) | minting a PAT carrying a dark scope **fails** (400) rather than silently dropping it |
| Scope advertisement (`OAuthConfigService.supportedScopes()`) | the scope is absent from discovery `scopes_supported`, the 401 challenge, and `/authorize` |
| Scope listing (`GET /api/mcp/tokens/scopes`) | the scope is absent from the response, so the web PAT picker never renders it |

Registering a dark tool and denying every call was rejected deliberately:
advertising a capability that can only fail invites the model to retry it. The
residual case is the safe one — a token minted while the flag was on keeps
passing `requireScope` after the flag flips off, but the tools aren't registered,
so the surface is closed anyway. `mcp-scopes.ts` stays a pure static enum (it is
the type source and is mirrored by hand in the web app), so runtime config never
leaks into it — which is why the web PAT picker has to **ask**: the settings page
([`mcp-tokens.tsx`](../../web/src/routes/settings/mcp-tokens.tsx)) queries
`listAvailableMcpScopes()` and filters both its read and write scope groups
against the answer, falling back to the full static set if the call fails (a blip
degrades to a checkbox that 400s, never to an empty picker). So a dark scope is
absent from the PAT picker as well as from OAuth discovery and consent.

## Tools

Fifty-one tools in [`tools/*.tools.ts`](../../backend/src/modules/shared/mcp/tools/) —
twenty-four read, twenty-seven write. The three chat writes register only while
`MCP_CHAT_WRITE_ENABLED` is on, so a server with that flag unset advertises
**forty-eight**. Each tool reuses an existing domain service that carries its own
authz; inputs are Zod-validated and page sizes are clamped to a per-tool ceiling
(at most `MCP_MAX_PAGE_SIZE`, default 100; `project_knowledge_search` caps at 20,
`roadmap_ai_sessions_list` at 100 and `roadmap_ai_session_messages` at 200 by the
service DTO).

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
| `roadmap_list_changes` | `roadmaps:read` | `roadmap_id`, `limit?`, `before?`, `include_operations?` | Committed changes newest-first from the durable log — who, when, what. `before` is a `committed_at` cursor; `include_operations` defaults **off** |
| `tasks_list` | `roadmaps:read` | `roadmap_id`, `assigned_to_me?`, `status?`, `parent_type?`, `parent_id?`, `assignee_id?`, `keyword?`, `include_completed?`, `limit?` | Filtered tasks; `assigned_to_me` = "what's on my plate" |
| `task_comments_list` | `roadmaps:read` | `task_id`, `limit?` | A task's comments oldest-first (newest `limit` of them, default 50, plus the true `total`); authors whitelisted to `id` + `display_name` |
| `project_knowledge_search` | `knowledge:read` | `roadmap_id`, `query`, `sources?`, `limit?` | Hybrid RAG over chat/comments/activity/brief (empty for guest/project-less roadmaps) |
| `chat_rooms_list` | `chat:read` | `project_id` | Channels the user participates in |
| `chat_messages_list` | `chat:read` | `room_id`, `before?`, `limit?` | Recent messages, newest first |
| `chat_messages_search` | `chat:read` | `room_id`, `query`, `limit?` | Keyword search within a room |
| `roadmap_ai_sessions_list` | `ai-sessions:read` | `roadmap_id`, `archived?`, `limit?` | **Your own** AI planning threads for a roadmap |
| `roadmap_ai_session_messages` | `ai-sessions:read` | `roadmap_id`, `session_id`, `before_seq?`, `after_seq?`, `limit?` | One thread's messages oldest-first, plus a `next_before_seq` cursor |
| `deliverables_list` | `delivery:read` | `project_id`, `status?`, `limit?` | The deliverables register with acceptance-criteria progress |
| `deliverable_get` | `delivery:read` | `project_id`, `deliverable_id` | One deliverable with criteria, reviewers, attachments, links |
| `change_requests_list` | `delivery:read` | `project_id`, `status?`, `view?`, `requested_by?`, `limit?` | The change-request register; `view` is the coarse grouping, ignored when `status` is given |
| `change_request_get` | `delivery:read` | `project_id`, `change_request_id` | One request with impact fields, links, and stamps |
| `risks_list` | `delivery:read` | `project_id`, `kind?`, `status?`, `limit?` | The risk & issue register, severity-first; `internal` rows filtered by `risks.view_internal` |
| `decisions_list` | `delivery:read` | `project_id`, `status?`, `category_id?`, `limit?` | The decision register, newest decided first; `internal` rows filtered |
| `decision_get` | `delivery:read` | `project_id`, `decision_id` | One decision with options, links, supersession chain |
| `decision_categories_list` | `delivery:read` | `project_id` | The project's decision categories |

#### AI-session reads

[`ai-sessions.tools.ts`](../../backend/src/modules/shared/mcp/tools/ai-sessions.tools.ts)
is **owner-only by construction**, at two layers: `RoadmapAiSessionsService`
checks roadmap view access *and* filters every query on `user_id = caller`. It is
therefore not a way to see what anyone else asked the planner.

Both tools project through explicit **whitelists**, built field by field — a
rest-spread blacklist would auto-leak the next column anyone adds, and the thing
withheld here is the most sensitive payload in the schema.

| Row | Kept | Dropped |
| --- | --- | --- |
| session | `id`, `roadmap_id`, `title`, `mode`, `is_archived`, `is_pinned`, `last_message_at`, `message_count`, `created_at`, `updated_at` | `metadata` (holds `agent_state`: pending plans, full per-node snapshots, staged-edit validation traces, rolled-up summaries), `user_id`, `archived_at` / `pinned_at` |
| message | `id`, `seq`, `role`, `content`, `intent_type`, `created_at` | `artifacts`, `activity_timeline`, `commit_lifecycle`, `metadata` (free-form jsonb the agent writes with **no** backend validator, including tool-call traces and operation payloads), `response_mode` / `parse_mode`, `tokens`, `session_id` |

### Write tools

Twenty-seven write tools — seven from Phase 2, the three Phase-4 chat writes,
the two epic/feature comment tools
([`comment-write.tools.ts`](../../backend/src/modules/shared/mcp/tools/comment-write.tools.ts)),
and the fifteen Phase-5 delivery-register writes
([`delivery-write.tools.ts`](../../backend/src/modules/shared/mcp/tools/delivery-write.tools.ts))
— each requiring its `*:write` scope **and** the live Proyekto permission. Structural
roadmap changes go through the
**preview → commit → revert** lifecycle on `RoadmapAiService`
([`roadmap-write.tools.ts`](../../backend/src/modules/shared/mcp/tools/roadmap-write.tools.ts));
task writes take the **direct `TasksService` path**
([`task-write.tools.ts`](../../backend/src/modules/shared/mcp/tools/task-write.tools.ts))
so they reconcile the multi-assignee join table and fire `task_assigned`
notifications, which the roadmap-ops path does not. Every task write also emits a
best-effort `mcp.task_*` row to `project_activity_log`. Tools that delete,
notify, or post are flagged `destructiveHint` so the host asks the user first.

| Tool | Scope | Inputs | Effect |
| --- | --- | --- | --- |
| `roadmap_preview_operations` | `roadmaps:write` | `roadmap_id`, `operations[]`, `revision_token?` | **Inspect only** — validates the batch, returns a `semantic_diff`, a temp-id → real-id map, and a `revision_token`. No mutation. |
| `roadmap_commit_operations` | `roadmaps:write` | `roadmap_id`, `operations[]`, `revision_token` (**required**), `idempotency_key` (**required**) | Applies the previewed batch. On a concurrent edit returns **`STALE_REVISION`** → re-preview. `destructiveHint`. |
| `roadmap_revert_change` | `roadmaps:write` | `roadmap_id`, `change_id` | Undoes a committed change — restores the state just before it, which also undoes any later changes. Only for changes **you** made in the **last 30 days**; anything else is `NOT_FOUND` even when `roadmap_list_changes` still shows it. `destructiveHint`. |
| `task_create` | `tasks:write` | `feature_id`, `title`, `description?`, `status?`, `priority?`, `due_date?`, `position?` | Creates a task under a feature (no assignee fields — assign separately). Perm `roadmap.create_tasks`. |
| `task_update` | `tasks:write` | `task_id`, `title?`, `description?`, `status?`, `priority?`, `due_date?`, `position?` | Updates a task's fields. Perm `roadmap.edit`. |
| `task_assign` | `tasks:assign` | `task_id`, `assignee_ids[]` | Replaces the assignee set (empty array unassigns); notifies newly-assigned. Perm `roadmap.assign`. `destructiveHint`. |
| `task_comment_add` | `tasks:write` | `task_id`, `content` | Adds a task comment (knowledge-indexed, so `project_knowledge_search` finds it later). Perm `roadmap.comment`. `destructiveHint`. |
| `epic_comment_add` | `tasks:write` | `epic_id`, `content` | Adds an epic comment. Perm `roadmap.comment`. **Not** knowledge-indexed. `destructiveHint`. |
| `feature_comment_add` | `tasks:write` | `feature_id`, `content` | Adds a feature comment. Perm `roadmap.comment`. **Not** knowledge-indexed. `destructiveHint`. |
| `chat_send_message` | `chat:write` | `project_id`, `room_id`, `content`, `reply_to_id?` | Posts to a channel. `destructiveHint`. |
| `chat_message_edit` | `chat:write` | `message_id`, `content` | Edits a message **you** sent; shows an "(edited)" marker. `destructiveHint`. |
| `chat_message_unsend` | `chat:write` | `message_id` | Deletes a message **you** sent. `destructiveHint`. |

The `operations[]` payload is the existing shared contract
([`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json)):
`add_epic` / `add_feature` / `add_task` / `add_milestone`, `update_node`,
`move_node`, `delete_node`, `mark_status`, `shift_dates`. Phases 2–4 added no new
operation shapes.

> **⚠️ Two-stage by design.** `roadmap_commit_operations` **requires** the
> `revision_token` from a prior `roadmap_preview_operations` — stricter than the
> web path, where the token is opt-in — so a host must inspect the diff before it
> can mutate, and a stale token forces a re-preview. `roadmap_revert_change` maps
> internally to the service's `discard` (undo); the inverse `rollback` (redo) is
> intentionally **not** exposed.

#### Chat writes

[`chat-write.tools.ts`](../../backend/src/modules/shared/mcp/tools/chat-write.tools.ts)
is **channel messages only**, and dark behind `MCP_CHAT_WRITE_ENABLED`.
`ChatService.sendChannelMessage` enforces the real capability
(`chat.send_messages`, commenter and above, with a consultant/client fallback for
people who hold the role without a `project_access` row), so a viewer holding a
`chat:write` token still gets `FORBIDDEN`.

Four things are deliberately **not** exposed:

| Not exposed | Why |
| --- | --- |
| **Direct messages** | `sendDmMessage` has *no* capability check at all — the only gate is "do these two people share any project", and `chat.send_dm` appears solely as an error string `getPermission` is never called on. An agent could DM anyone across every project the user touches, including a client on a consulting engagement. Worse, DM messages are created with `project_id` **null**, so they cannot be audited. DMs would need their own scope **and** a real service-layer gate first. |
| **Channel administration** (create/rename/archive, add/remove member) | already admin-gated, so an agent holding it acts as a project admin; and those methods self-audit inside `ChatService`, so an extra audit write would double-log |
| **Reactions** | `toggleMessageReaction` returns `{ok:true}` with no post-state, so the model can't tell an add from a remove and a retry after a transport timeout silently **undoes** the reaction |
| **Mentions and attachments** | the send payload is built as an explicit literal, never a spread of the tool args, so `mentions` / `attachments` cannot reach the service even if the input schema later grows |

Two implementation details worth knowing:

- `room_id` is **required**. `ChatService`'s no-`room_id` path calls
  `provisionDefaultChannels` — it *creates* rooms as a side effect of a send and
  falls back to `#general` when a slug misses. Requiring the id forces a
  `chat_rooms_list` first and removes both surprises.
- An edit re-reads the stored `mentions` before writing. `ChatService.editMessage`
  treats an absent `mentions` as *"clear them"*, not *"leave unchanged"*, so an
  edit that skipped the lookup would silently destroy the mention chips on a
  message the user originally posted from the web app. The same lookup (on
  `chat_room_messages`, **not** `chat_messages`) also resolves the owning project
  for the best-effort `mcp.chat_*` row in `project_activity_log` — skipped when
  `project_id` is null, i.e. a DM.

Message content is deliberately **never** put in the audit metadata: the message
row already holds it, and `AuditService.log` feeds the knowledge outbox, so
duplicating would embed the same text twice.

The server instructions carry a matching paragraph telling the host that chat
writes are seen by real people, cannot be recalled, and need explicit
confirmation of the exact text and target room — and that typing `"@name"` into
the body is not a workaround, because it looks like a ping to the reader without
ever notifying them.

#### Delivery-register writes

[`delivery-write.tools.ts`](../../backend/src/modules/shared/mcp/tools/delivery-write.tools.ts)
covers the four governance registers — flagless and live on deploy (owner
decision, 2026-08-25); the per-credential `delivery:write` opt-in is the gate.
Every call re-asserts the live permission inside the
[`DeliveryModule`](../../backend/src/modules/execution/delivery/delivery.module.ts)
services (`access.delivery` plus `deliverables.edit` / `deliverables.approve` /
`change_requests.create` / `change_requests.decide` / `risks.edit` /
`decisions.edit`), and those services self-audit through the global
`AuditService` — so unlike the task writes, these tools emit **no** audit rows
of their own: they would double-log.

| Tool | Effect |
| --- | --- |
| `deliverable_create` / `deliverable_update` | Register entry with inline `criteria[]`, `reviewer_ids[]`, `links[]`, owner, due date; update's `status` only accepts `not_started` / `in_progress` |
| `deliverable_submit` / `deliverable_review` | The review lifecycle — stamps submitter / reviewer. `destructiveHint` |
| `change_request_create` / `change_request_update` | Draft entry with inline `links[]` and impact fields; `submit: true` raises-and-submits in one step |
| `change_request_submit` / `change_request_withdraw` / `change_request_decide` | Submit **notifies every holder of `change_requests.decide`**; decide notifies the requester. `destructiveHint` |
| `change_request_mark_applied` | Records the `roadmap_change_history` id from a prior preview → commit — approval never writes the roadmap itself. `destructiveHint` |
| `risk_create` / `risk_update` | Kind, severity/likelihood, owner, mitigation, status ladder, visibility, inline `links[]` |
| `decision_create` / `decision_update` / `decision_finalize` | Inline `options[]` + `links[]` and supersession on create; finalize stamps `decided_by` / `decided_on`. Finalize is `destructiveHint` |

Three properties worth knowing:

- **Lifecycle verbs are separate tools on purpose**, mirroring the REST
  controller: the update DTOs cannot reach the reviewed/decided statuses, so
  the `submitted_by` / `reviewed_by` / `decided_by` stamps can never be
  skipped, and the tools inherit that for free.
- **Create accepts the whole entry inline** (criteria, reviewers, options,
  links), so transcribing a full register entry is one call, not a micro-CRUD
  round trip. Naming a deliverable owner or reviewer notifies **nobody** —
  only the change-request fan-out notifies.
- **Deliberately not exposed:** all deletes (registers are audit trails),
  attachments (the `file` kind needs the R2 upload flow), item-level
  criterion/option/reviewer/link editing, decision-category writes, and
  `risks.candidates` — the smallest surface that covers real use.

The server instructions carry a matching paragraph: register writes are shared
governance records, and the notifying/stamping verbs need user confirmation
first; drafting entries does not.

Tool failures are normalized to a structured `{ error, message }` result
(`isError: true`) with a stable code — Nest `HttpException`s are mapped by status:

`UNAUTHENTICATED` (401) · `FORBIDDEN` (403) · `NOT_FOUND` (404) ·
`VALIDATION_FAILED` (400/422) · `STALE_REVISION` / `CONFLICT` (409) ·
`RATE_LIMITED` (429) · `NO_PROJECT` · `INTERNAL`.

A commit on a concurrently-edited roadmap raises **`STALE_REVISION`** (the host
re-previews); other write conflicts (e.g. `IDEMPOTENCY_KEY_REUSED`) surface as
**`CONFLICT`**. Project-level reads throw **`NOT_FOUND`** (not `FORBIDDEN`) on
no-access, so a caller can't probe which ids exist.

## Change history vs the Redis timeline

Phase 4a split the roadmap change log in two. Understanding the split is what
explains the tool asymmetry: **`roadmap_list_changes` can show a change that
`roadmap_revert_change` refuses.**

```
  commit ---+--> REDIS   roadmap:ai:timeline:{roadmapId}:{userId}
            |              stateBefore + stateAfter (~320KB/commit)
            |              per USER, 250-entry cap, sliding 30-day TTL
            |              best-effort write   ==> powers UNDO / REDO
            |
            +--> POSTGRES public.roadmap_change_history
                           operations + semantic_diff, NO snapshots
                           per ROADMAP, durable, RLS member-read
                           fire-and-forget     ==> powers LISTING
```

Before this, a committed change existed **only** in Redis. Three consequences:
the key is per-user, so nobody could answer "who changed this roadmap"; an idle
roadmap lost its whole history at TTL; and a commit could succeed with no history
at all. Meanwhile `project_activity_log` keeps only an `operations_hash`, never
the operations, so the durable trail couldn't reconstruct what a change did.

`roadmap_change_history`
([`20260727090000_create_roadmap_change_history.sql`](../../supabase/migrations/20260727090000_create_roadmap_change_history.sql))
is the durable half: `change_id` (UNIQUE — it doubles as the revert lookup
index), `roadmap_id`, `project_id`, `actor_id`, `status`, the `operations` array,
`operations_count` / `operations_hash`, `semantic_diff` /
`semantic_change_count`, `temp_id_mapping`, the before/after revision tokens, and
`committed_at` / `discarded_at` / `discarded_by`.

- It deliberately does **not** store the two full roadmap snapshots. They run
  ~320KB per commit, and replaying a month-old snapshot would blind-clobber
  everyone's later work. Revert therefore stays Redis-bounded — **your own
  changes, last 30 days** — and the tool description says so.
- `project_id` is **nullable**, so personal (project-less) roadmaps finally get a
  durable record. Both `AuditService` call sites are wrapped in
  `if (current.project_id)`, which is why they had none before.
- **RLS mirrors `project_activity_log`:** a member-read `SELECT` policy over
  `can_view_roadmap(auth.uid(), roadmap_id)` as defense in depth, plus a
  `service_role` policy — and no `INSERT`/`UPDATE`/`DELETE` path for
  `authenticated`, so only the service-role backend writes. `can_view_roadmap`
  is the right predicate over `project_chat_is_member` precisely because
  `project_id` is nullable: it covers both the project-member case and the
  personal-roadmap owner via the `share_role` ladder. `can_view_roadmap` /
  `can_edit_roadmap` are defined in
  [`20260504000030_restore_roadmap_children_rls.sql`](../../supabase/migrations/20260504000030_restore_roadmap_children_rls.sql)
  and referenced only, never redefined. Per the migration's own note, the older
  `can_access_roadmap` helper that the `roadmap_ai_sessions` migration references
  **no longer exists in the Singapore database** — it was superseded by that pair
  and must not be reintroduced.
- The migration is reported as applied to SG prod (`byvbnkpiselvvulsvxgo`) —
  *unverified*, since migration application state isn't visible from the repo.
- **No backfill is possible** — Redis timelines are per-user and ephemeral, and
  the operations payload was never persisted anywhere. The table started empty
  and fills forward, so `markChangeHistoryStatus` is a no-op for any change that
  predates it.

On [`RoadmapAiService`](../../backend/src/modules/execution/roadmaps/services/roadmap-ai.service.ts):
`recordChangeHistory` (insert, from `commit`) and `markChangeHistoryStatus` (flip
to `discarded` from `discard`, back to `applied` from `rollback`) are both
fire-and-forget and tolerate failure — the history is an observability surface,
so a write failure must never fail a commit that already succeeded. A revert
flips **every** entry from the target forward, matching the Redis timeline's own
cascade: undoing a change also undoes everything committed after it. The public
`listChangeHistory(roadmapId, userId, { limit, before, includeOperations })`
carries its own **view-level** authz (`assertCanViewRoadmap`), clamps `limit` to
1–100 (default 25), pages backwards on `committed_at`, and omits the `operations`
column from the projection unless asked.

> **⚠️ `discard()` used to write no audit row at all** — the one mutating path
> with no durable trail, and the exact path `roadmap_revert_change` calls. It now
> emits `roadmap.reverted` to `project_activity_log` (still skipped when the
> roadmap has no project, like every other audit call site).

## Resources & prompts

**Resources** ([`resources.ts`](../../backend/src/modules/shared/mcp/resources.ts)) — an
addressable mirror of the read tools for hosts that prefetch/cite by id, backed
by the same authorized façade (nothing cached):

- `proyekto://projects`
- `proyekto://projects/{projectId}`
- `proyekto://roadmaps/{roadmapId}/summary`

**Prompts** ([`prompts.ts`](../../backend/src/modules/shared/mcp/prompts.ts)) — reusable
templates that steer the host model through the tools; they never act on their
own: `review_project_health`, `summarize_overdue_or_blocked`,
`draft_roadmap_change`, `summarize_recent_discussions`. Only
`draft_roadmap_change` reaches a write tool, and it walks the host through
summary → search → **preview** and instructs it not to commit until the user has
seen the semantic diff and explicitly confirmed it.

The server instructions also tell the host to treat all retrieved text (briefs,
chat, comments, activity) as **untrusted data, not instructions** — a prompt-
injection guard.

## OAuth 2.1 authorization server

Phase 3, in [`oauth/`](../../backend/src/modules/shared/mcp/oauth/). Proyekto is its own
authorization server: it issues the tokens rather than delegating to Supabase
Auth, because the resource being protected is `/mcp` and the token has to be
audience-bound to it.

**Why it exists:** hosts that read a config file (Claude Code, Codex) can keep
using a PAT indefinitely. The hosted Claude surfaces — claude.ai web, Desktop,
mobile, Cowork — have **no field for a PAT**, so OAuth is the only way they can
connect at all.

> **⚠️ Ships dark.** `enabled` requires `MCP_ENABLED === 'true'` **and**
> `MCP_OAUTH_ENABLED === 'true'`. While the second is unset the discovery
> documents **404**, `/oauth/*` answers `temporarily_unavailable` (503), and no
> `WWW-Authenticate` challenge is emitted — PATs are entirely unaffected.

### The flow

```
  1. unauthenticated call
     host --POST /mcp------------------------------> McpAuthGuard
          <--401 WWW-Authenticate: Bearer ----------
               resource_metadata=".../oauth-protected-resource/mcp"

  2. discovery (both 404 while dark)
     host --GET /.well-known/oauth-protected-resource/mcp-->
          <--{ resource, authorization_servers: [issuer] }
     host --GET /.well-known/oauth-authorization-server---->
          <--{ authorize/token/register/revoke, S256, CIMD: true }

  3. client identity
     client_id = an https CIMD URL           (preferred, no DB row)
              or POST /oauth/register        (RFC 7591 DCR fallback)

  4. authorize
     browser --GET /oauth/authorize?client_id&redirect_uri&scope
                                   &code_challenge&state------->
                     validate -> park PendingAuthorization in Redis (10 min)
             <--302 CLIENT_URL/oauth/authorize?request_id=...---

  5. consent  (web app, normal Supabase session)
     web --GET  /api/mcp/oauth/consent?request_id--> who is asking, for what
     web --POST /api/mcp/oauth/consent------------> granted scopes (a subset)
                     mint single-use code -> Redis (60 s)
         <--{ redirect_to: <redirect_uri>?code=...&state=... }--
     browser --> the client's redirect_uri

  6. token
     host --POST /oauth/token (code + code_verifier)-->
                     GETDEL the code, verify PKCE S256
          <--{ access_token (HS256 JWT, aud = resource),
               refresh_token?, expires_in, scope }--

  7. tools/call
     host --POST /mcp  Authorization: Bearer <JWT>-->
                     verify aud + iss -> requireScope -> live authz
                       -> domain service
```

### Endpoints

Protocol endpoints, served at the domain **root** because clients read their
locations from the discovery documents
([`well-known.controller.ts`](../../backend/src/modules/shared/mcp/oauth/well-known.controller.ts),
[`oauth.controller.ts`](../../backend/src/modules/shared/mcp/oauth/oauth.controller.ts)).
All are unauthenticated — a public client is authenticated by PKCE.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/.well-known/oauth-protected-resource` | RFC 9728 — names the `resource` and its authorization server |
| GET | `/.well-known/oauth-protected-resource/mcp` | The same document at the resource-qualified path Claude probes first |
| GET | `/.well-known/oauth-authorization-server` | RFC 8414 — endpoint URLs, `S256`, `client_id_metadata_document_supported` |
| GET | `/.well-known/oauth-authorization-server/mcp` | The same document, resource-qualified |
| GET | `/oauth/authorize` | Validates the request, parks it in Redis, **302** to the web consent screen |
| POST | `/oauth/token` | `authorization_code` + `refresh_token` grants (form-encoded) — 30/min |
| POST | `/oauth/register` | RFC 7591 Dynamic Client Registration (JSON) — **201**, 10/min |
| POST | `/oauth/revoke` | RFC 7009 — always **200**, even for an unknown token; 30/min |

`/oauth/authorize` carries no throttle of its own; it is bounded by the 10-minute
pending-request TTL and by CIMD caching.

First-party endpoints — our own API, so they keep the `/api` prefix and run under
`SupabaseAuthGuard`
([`oauth-grants.controller.ts`](../../backend/src/modules/shared/mcp/oauth/oauth-grants.controller.ts)).
The approving user is always the authenticated caller, never a body-supplied id.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/mcp/oauth/consent?request_id=` | What the consent screen renders: client name, source, requested scopes |
| POST | `/api/mcp/oauth/consent` | Approve — body `{ request_id, granted_scopes[] }`; returns `{ redirect_to }` |
| POST | `/api/mcp/oauth/consent/deny` | Decline — returns `{ redirect_to }` carrying `error=access_denied` |
| GET | `/api/mcp/oauth/grants` | "Connected apps" — live grants for the caller |
| DELETE | `/api/mcp/oauth/grants/:id` | Disconnect an app — **204** |

Listing and revoking grants deliberately do **not** call the enabled-check, so a
user can always disconnect an app even after the flag is turned back off.

### Client identity

| Mechanism | `client_id` | Storage |
| --- | --- | --- |
| **CIMD** (preferred) | an `https://` URL serving the client's metadata document | none — fetched, self-consistency-checked, SSRF-guarded, cached in Redis for 1 h |
| **DCR** (RFC 7591) | `mcp_<random>` issued by `POST /oauth/register` | one `mcp_oauth_clients` row |

CIMD keeps the client table from growing without bound: the document must claim
the very URL it was served from (`client_id === url`), the fetch is https-only
with `redirect: 'error'`, a 5 s timeout, a 64 KiB cap, and a DNS check that
rejects private/loopback/link-local/CGNAT destinations.

Claude only chooses CIMD when the AS metadata advertises **both**
`client_id_metadata_document_supported: true` **and** `"none"` in
`token_endpoint_auth_methods_supported` — it authenticates as a public client, so
both flags are load-bearing. Drop either and it silently falls back to DCR.

**Redirect URIs** match exactly, with one exception: for loopback hosts RFC 8252
§7.3 requires the **port to be ignored**, because a CLI binds an ephemeral port
per session (`redirectUriMatches` in
[`oauth-client.service.ts`](../../backend/src/modules/shared/mcp/oauth/oauth-client.service.ts)).
Protocol, host and path must still match. The values the specs exercise are
`https://claude.ai/api/mcp/auth_callback` for hosted Claude and the
`http://localhost/callback` + `http://127.0.0.1/callback` pair for Claude Code —
these come from Claude's own metadata document, not from Proyekto config.
Registration rejects any redirect URI that isn't https or http-on-loopback, and
any that carries a fragment.

### Consent

`/oauth/authorize` never renders anything itself — it parks a
`PendingAuthorization` in Redis and bounces the browser to
`CLIENT_URL/oauth/authorize?request_id=…`, a standalone chrome-free screen in the
web app ([`web/src/routes/oauth/authorize.tsx`](../../web/src/routes/oauth/authorize.tsx))
that redirects through login first, preserving the query string.

Consent can only **narrow**:

- The screen pre-checks read scopes and leaves write scopes **unchecked**;
  `offline_access` is pre-checked because unchecking it only makes the host
  re-prompt.
- `approve()` filters the granted list against `requested_scopes`, so the server
  can never issue a scope the client didn't ask for, whatever the browser posts.
- A later `refresh_token` may narrow again but never widen — except that
  `offline_access` is re-added if the grant had it, so narrowing scope doesn't
  cost the client its ability to keep refreshing.

The `/authorize` error path follows RFC 6749 §4.1.2.1: failures raised **before**
the `redirect_uri` is validated are rendered at our endpoint, and only those
raised after are delivered by redirecting back to the client — the distinction
`OAuthRedirectError` encodes.

### Tokens

| Token | Prefix | Lifetime | Where it lives |
| --- | --- | --- | --- |
| Pending authorization | — | 10 min | Redis `mcp:oauth:pending:<request_id>` |
| Authorization code | `mcpc_` | 60 s, single-use | Redis `mcp:oauth:code:<sha256>`, redeemed with atomic **GETDEL** |
| Access token | — | `MCP_OAUTH_ACCESS_TTL_SECONDS` (default 3600) | Nowhere — a stateless HS256 JWT |
| Refresh token | `mcpr_` | until revoked, **rotates on every use** | `mcp_oauth_grants.refresh_token_hash` (sha256) |
| CIMD document | — | 1 h | Redis `mcp:oauth:cimd:<sha256>` |

**Access tokens** are HS256 JWTs signed with `MCP_OAUTH_JWT_SECRET` —
deliberately *not* `SUPABASE_JWT_SECRET`, so an MCP token can never be mistaken
for a Supabase session or vice versa; a secret shorter than 32 chars fails closed
with a 503. Claims: `sub`, `scope` (space-separated, `offline_access` stripped),
`client_id`, `aud` = the MCP resource (RFC 8707), `iss`, `jti`, `exp`/`iat`.
Verification is in-process, so `/mcp` costs no DB round trip. Statelessness is
why they're short-lived: revoking a connection kills the refresh token
immediately, and the access token dies at expiry.

**Refresh-token rotation with reuse detection:** each refresh writes a new hash
and records the one it replaced in `rotated_from`. Presenting a rotated-out token
is therefore detectable theft — the whole grant chain is revoked and the caller
gets `invalid_grant` (which is the code Claude's re-authorization path expects; a
custom code breaks it).

Codes are single-use, and that is enforced by **GETDEL** rather than a get+delete
pair — with `--max-instances` above one, two concurrent redemptions of a
get-then-delete would both succeed.

### Errors, CORS, and logging

- **Flat RFC 6749 bodies.** `{"error":"invalid_grant","error_description":"…"}`,
  not the app's `{ error: { message, status, … } }` envelope. That needs a
  controller-scoped
  [`OAuthExceptionFilter`](../../backend/src/modules/shared/mcp/oauth/oauth-exception.filter.ts):
  `@RawResponse()` is read by `ResponseInterceptor` and so only affects
  **success** responses, which an exception bypasses entirely.
- **No class-validator DTOs on the protocol endpoints.** The request shapes in
  [`dto/oauth.types.ts`](../../backend/src/modules/shared/mcp/oauth/dto/oauth.types.ts)
  are plain interfaces, so the global `ValidationPipe` skips them — a class
  metatype under `forbidNonWhitelisted` would 400 the RFC 8707 `resource`
  parameter and any vendor extension. Validation is by hand in `OAuthService`.
  Our own consent endpoints use normal DTOs (`dto/consent.dto.ts`).
- **CORS is a per-request delegate** in [`main.ts`](../../backend/src/main.ts):
  `/oauth` and `/.well-known` get `origin: '*'` with `credentials: false` (they
  are fetched cross-origin by arbitrary clients and carry no cookies), which is
  incompatible with the credentialed allow-list policy the rest of the API uses
  and so cannot be expressed as one static policy. Both policies expose
  `WWW-Authenticate`. An unknown origin is now rejected by **omitting** the CORS
  headers (`callback(null, false)`) instead of passing an `Error`, which used to
  escape to Express and surface as a bare 500 with no envelope.
- **Query strings are redacted on `/oauth` paths** before logging —
  `redactUrl()` in
  [`request-logging.interceptor.ts`](../../backend/src/common/interceptors/request-logging.interceptor.ts),
  reused by the timeout interceptor — so `code`, `state`, and `code_challenge`
  never reach Cloud Logging.

## PAT management

Personal Access Tokens are issued/listed/revoked over normal Supabase-session
routes ([`mcp-tokens.controller.ts`](../../backend/src/modules/shared/mcp/mcp-tokens.controller.ts)),
owner-scoped by the caller's id (never a body-supplied user id) and gated by
`MCP_ENABLED`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/mcp/tokens` | Issue — body `{ name, scopes[], expires_at? }`; returns the raw `pk_` token **once** |
| GET | `/api/mcp/tokens` | List token metadata (prefix, scopes, timestamps — never the hash) |
| GET | `/api/mcp/tokens/scopes` | `{ scopes: [...] }` — the scopes a token may **currently** be issued for, from `McpCapabilitiesService.enabledScopes()`, so the picker never offers a dark scope |
| DELETE | `/api/mcp/tokens/:id` | Revoke (soft-delete via `revoked_at`) — **204** |

Only the **sha256 hash** plus a short display prefix (`pk_` + 8 chars) are
stored. On resolution the guard rejects revoked/expired tokens and bumps
`last_used_at` fire-and-forget.

Both credential types are managed from the same web page,
[`web/src/routes/settings/mcp-tokens.tsx`](../../web/src/routes/settings/mcp-tokens.tsx)
(titled **MCP Access**): a "Connected apps" section over
`/api/mcp/oauth/grants` above the token list.

### Storage

| Migration | Creates |
| --- | --- |
| [`20260723090000_create_mcp_personal_access_tokens.sql`](../../supabase/migrations/20260723090000_create_mcp_personal_access_tokens.sql) | `mcp_personal_access_tokens` |
| [`20260725090000_create_mcp_oauth.sql`](../../supabase/migrations/20260725090000_create_mcp_oauth.sql) | `mcp_oauth_clients`, `mcp_oauth_grants` |

Both are applied to SG prod (`byvbnkpiselvvulsvxgo`). The RLS posture is the same
across all three tables: owners get **SELECT** + **DELETE** on their own rows and
nothing else — there is deliberately no `authenticated` INSERT/UPDATE path, so
issuance, rotation, and `last_used_at` bookkeeping go through the service-role
backend. `mcp_oauth_clients` belongs to no user at all (it's written by an
unauthenticated DCR call), so it has **only** a `service_role` policy and RLS
denies `authenticated` by default.

`mcp_oauth_grants` is the durable one-row-per-(user, client) connection that
outlives any access token: it holds the granted `scopes`, the hashed
`refresh_token_hash` (UNIQUE), `rotated_from` for reuse detection, `last_used_at`,
and `revoked_at`. `client_name` is denormalized onto it so the settings UI can
name a CIMD app that has no `mcp_oauth_clients` row. Refresh tokens are **hashed,
never encrypted** — only equality on presentation is ever needed, and the AES-GCM
helper used for Google refresh tokens silently stores plaintext when its key is
absent or mis-sized.

## Config & deploy

| Var | Purpose |
| --- | --- |
| `MCP_ENABLED` | Kill switch — anything but `'true'` keeps the whole surface dark (503) |
| `MCP_MAX_PAGE_SIZE` | Optional page-size ceiling (default 100) |
| `MCP_OAUTH_ENABLED` | Second gate — anything but `'true'` keeps Phase 3 dark (discovery 404s, no challenge) |
| `MCP_OAUTH_JWT_SECRET` | HS256 signing secret for access tokens; **must not** be `SUPABASE_JWT_SECRET`; < 32 chars ⇒ 503 |
| `MCP_OAUTH_ISSUER` | Authorization-server issuer (falls back to `PUBLIC_API_URL`) |
| `MCP_OAUTH_RESOURCE` | Protected-resource id; must **byte-match** the URL users type into their host (defaults to `<issuer>/mcp`) |
| `MCP_OAUTH_ACCESS_TTL_SECONDS` | Access-token lifetime (default 3600) |
| `MCP_CHAT_WRITE_ENABLED` | Third gate — anything but `'true'` keeps the Phase-4 chat write tools unregistered, `chat:write` unmintable, and the scope out of discovery / the challenge / consent |

All are registered in
[`env.validation.ts`](../../backend/src/config/env.validation.ts) and all are
optional, so dev and CI boots are unaffected. The consent URL is derived from
`CLIENT_URL`.

In [`backend-deploy.yml`](../../.github/workflows/backend-deploy.yml) each flag
has its own gated block. `MCP_ENABLED` needs no secret (PATs reuse the existing
`SUPABASE_*` service-role client). `MCP_OAUTH_ENABLED` adds
`MCP_OAUTH_JWT_SECRET` to the Secret Manager list and derives
`MCP_OAUTH_ISSUER` / `MCP_OAUTH_RESOURCE` from `PUBLIC_API_URL`. To turn OAuth
on: create the `MCP_OAUTH_JWT_SECRET` secret (grant the runtime SA
`secretAccessor`), then set the `MCP_OAUTH_ENABLED` repo var.

`MCP_CHAT_WRITE_ENABLED` has its own block, and it is the simplest of the three:
**env var only, no secret** — when the repo var is set the block appends
`MCP_CHAT_WRITE_ENABLED=true` to `ENV_VARS`, otherwise it logs that chat writes
stay off. The flag *is* the whole switch, so activation is a one-step repo-var
flip with no Secret Manager work.

> **⚠️ Cloud Run deploys full-replace the secret list**, so a new secret must be
> added unconditionally to the workflow's `SECRETS` assembly — see
> [Infra & deploy](../10-infra-deploy/README.md).

## Roadmap

- **Phase 1 (current)** — read-only tools/resources/prompts, PATs; shipped dark
  behind `MCP_ENABLED`.
- **Phase 2 (current)** — opt-in writes behind the `roadmaps:write` /
  `tasks:write` / `tasks:assign` scopes: structural roadmap preview → commit →
  revert and the direct-path task tools. Reuses `MCP_ENABLED` (no separate flag);
  the per-credential write scopes are the gate.
- **Phase 3 (current)** — the OAuth 2.1 authorization server: discovery, CIMD +
  DCR client identity, PKCE authorization-code flow, a first-party consent
  screen, rotating refresh tokens, and "Connected apps". Gated by
  `MCP_OAUTH_ENABLED` on top of `MCP_ENABLED`; **activation was a separate step**
  (create the secret, then set the repo var). Per the doc comment on
  [`mcp-capabilities.service.ts`](../../backend/src/modules/shared/mcp/mcp-capabilities.service.ts),
  both `MCP_ENABLED` and `MCP_OAUTH_ENABLED` are now on in prod — which is
  exactly why Phase 4b needed a flag of its own.
- **Phase 4 (current)** — landed in two parts.
  - **4a — durable change history.** The `roadmap_change_history` table, the
    `recordChangeHistory` / `markChangeHistoryStatus` / `listChangeHistory`
    methods on `RoadmapAiService`, the `roadmap_list_changes` tool on the
    existing `roadmaps:read` scope, a corrected `roadmap_revert_change`
    description, and the `roadmap.reverted` audit row that `discard()` was
    missing. **No flag and no new scope** — nothing changes on the OAuth
    challenge, so this is live wherever `MCP_ENABLED` is.
  - **4b — chat writes + AI-session reads.** The `chat:write` and
    `ai-sessions:read` scopes, three channel-message write tools, and two
    owner-only AI-session read tools. `ai-sessions:read` is live on deploy;
    **chat-write activation is a separate step** — set the
    `MCP_CHAT_WRITE_ENABLED` repo var (no secret needed) and redeploy.
- **Comments expansion (current, 2026-07)** — `task_comments_list` on
  `roadmaps:read` plus `epic_comment_add` / `feature_comment_add` on the
  existing `tasks:write` scope (same risk class as `task_comment_add`, so no
  new scope). No flag — live wherever `MCP_ENABLED` is. Caveat: epic/feature
  comments are **not** knowledge-outbox indexed, so unlike task comments they
  never surface in `project_knowledge_search`.

- **Phase 5 (current, 2026-08)** — the delivery governance registers. The
  `delivery:read` / `delivery:write` scopes and all twenty-three tools, live
  on deploy wherever `MCP_ENABLED` is. **Flagless by owner decision at
  activation (2026-08-25)** — the write half briefly shipped behind
  `MCP_DELIVERY_WRITE_ENABLED`, which was removed the same day; the
  per-credential scope opt-in plus the delivery services' own permission gates
  (`deliverables.edit/approve`, `change_requests.create/decide`, `risks.edit`,
  `decisions.edit`) are the control surface. Existing credentials do **not**
  grow scopes: hosted-Claude users reconnect the connector and PAT users
  re-issue to pick up `delivery:*`, and the consent screen leaves
  `delivery:write` unchecked like every write scope.

Explicitly **not** exposed yet, and blocked on real work rather than scheduling:
direct messages, which would need their own scope **and** a service-layer
capability gate on `sendDmMessage` before they could be safe to automate.
