# MCP Server

> **Last updated:** 2026-07-25 · **Status:** current

Proyekto ships a **first-party MCP (Model Context Protocol) server** so MCP hosts
(Claude Code, Codex, the hosted Claude surfaces, the MCP Inspector) can read
**and** write a user's Proyekto data over a standard JSON-RPC endpoint. It lives
in the `mcp` backend module ([`backend/src/modules/mcp/`](../../backend/src/modules/mcp/))
and reuses the existing project / roadmap / chat / knowledge / task domain
services **in-process**, so every tool re-checks live authorization on each call
— a scope on the token is necessary but never sufficient. **Phases 1–3 are
current.** Two independent flags gate it: `MCP_ENABLED` covers the whole surface
(while unset `/mcp` returns **503** and the PAT routes deny), and
`MCP_OAUTH_ENABLED` is a **second** gate over the Phase-3 OAuth 2.1 authorization
server, which ships dark on top of an already-live MCP.

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
([`mcp-auth.guard.ts`](../../backend/src/modules/mcp/mcp-auth.guard.ts)).
Identity is **always** derived from the token, never from tool inputs.

| Path | Credential | Scopes granted |
| --- | --- | --- |
| **Kill switch** | — | `MCP_ENABLED !== 'true'` ⇒ **503** for the whole surface |
| **PAT** | `Bearer pk_…`, resolved by sha256 hash to its owner + stored scopes | exactly the scopes on the token |
| **OAuth access token** | a stateless HS256 JWT this server minted, audience-bound to the MCP resource | exactly the scopes in the `scope` claim |
| **Session JWT** (fallback) | a live Supabase HS256 access token (local verify, mirrors `SupabaseAuthGuard`) | **all** read scopes — a dev/Inspector convenience |

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
([`mcp-scopes.ts`](../../backend/src/modules/mcp/mcp-scopes.ts)) — seven of them,
carried either on a PAT or in an OAuth access token. PAT issuance rejects any
unknown scope string and the OAuth server drops any it doesn't recognize, so a
credential can't carry a grant no tool honors. Every tool requires **both** its
scope **and** the live Proyekto project/roadmap permission.

| Scope | Kind | Covers |
| --- | --- | --- |
| `projects:read` | read | project list/detail, members |
| `roadmaps:read` | read | roadmap graph, nodes, tasks |
| `knowledge:read` | read | RAG search over project knowledge |
| `chat:read` | read | chat rooms + messages |
| `roadmaps:write` | write | structural roadmap operations (preview / commit / revert) |
| `tasks:write` | write | create/update tasks, add task comments |
| `tasks:assign` | write | set a task's assignee set (notifies newly-assigned) |

The OAuth server advertises those seven **plus `offline_access`**
(`OAUTH_SUPPORTED_SCOPES` in
[`oauth-config.service.ts`](../../backend/src/modules/mcp/oauth/oauth-config.service.ts)).
`offline_access` is the standard OAuth signal *"give me a refresh token"*, **not**
a Proyekto permission: it is honoured by minting a refresh token and then
filtered out of the access token's MCP scope set, so it grants no tool access.

`chat:write` is reserved for a later phase and deliberately kept out of the known
set until a tool honors it.

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
`move_node`, `delete_node`, `mark_status`, `shift_dates`. Phases 2–3 added no new
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

## OAuth 2.1 authorization server

Phase 3, in [`oauth/`](../../backend/src/modules/mcp/oauth/). Proyekto is its own
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
([`well-known.controller.ts`](../../backend/src/modules/mcp/oauth/well-known.controller.ts),
[`oauth.controller.ts`](../../backend/src/modules/mcp/oauth/oauth.controller.ts)).
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
([`oauth-grants.controller.ts`](../../backend/src/modules/mcp/oauth/oauth-grants.controller.ts)).
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
[`oauth-client.service.ts`](../../backend/src/modules/mcp/oauth/oauth-client.service.ts)).
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
  [`OAuthExceptionFilter`](../../backend/src/modules/mcp/oauth/oauth-exception.filter.ts):
  `@RawResponse()` is read by `ResponseInterceptor` and so only affects
  **success** responses, which an exception bypasses entirely.
- **No class-validator DTOs on the protocol endpoints.** The request shapes in
  [`dto/oauth.types.ts`](../../backend/src/modules/mcp/oauth/dto/oauth.types.ts)
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

> **⚠️ Cloud Run deploys full-replace the secret list**, so a new secret must be
> added unconditionally to the workflow's `SECRETS` assembly — see
> [Infra & deploy](../10-infra-deploy/README.md).

## Roadmap

- **Phase 1 (current)** — read-only tools/resources/prompts, PATs, ships dark.
- **Phase 2 (current)** — opt-in writes behind the `roadmaps:write` /
  `tasks:write` / `tasks:assign` scopes: structural roadmap preview → commit →
  revert and the direct-path task tools. Reuses `MCP_ENABLED` (no separate flag);
  the per-credential write scopes are the gate.
- **Phase 3 (current)** — the OAuth 2.1 authorization server: discovery, CIMD +
  DCR client identity, PKCE authorization-code flow, a first-party consent
  screen, rotating refresh tokens, and "Connected apps". Gated by
  `MCP_OAUTH_ENABLED` on top of `MCP_ENABLED`; **activation is a separate step**
  (create the secret, then set the repo var — whether it is set today is not
  visible from source).
- **Phase 4 (next)** — chat writes (`chat:write`), `ai-sessions:read`, and
  durable roadmap change history.
