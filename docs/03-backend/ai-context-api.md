# AI Context API

> **Last updated:** 2026-09-06 · **Status:** current

The user-scoped read surface the Python agent uses when a session is in **workspace
scope**: what the caller can reach across every roadmap, project, team and workspace,
plus the two write-side additions that make a multi-roadmap agent run auditable —
workspace-scoped AI threads and run attribution on commits. The roadmap-keyed
`roadmaps/:id/ai/context/*` family (see [api-reference.md](./api-reference.md)) stays
for the in-roadmap assistant; this family never replaces it. Source:
[`backend/src/modules/execution/ai-context/`](../../backend/src/modules/execution/ai-context/)
(`AiContextModule`, wired in `app.module.ts` next to `RoadmapsModule`).

> **The rule in one line:** every read starts from a set the backend has already
> authorized *as the caller*, and **every denial is a 404** — the family never
> confirms that something exists.

## Shape of the surface

```
web composer (@-mentions) --> agent (workspace-scope session)
                                |  bearer + x-trace-id forwarded per request
                                v
                     NestJS  /api/ai/context/*   (AiContextModule, SupabaseAuthGuard)
                                |
        +-----------------------+---------------------------+
        v                       v                           v
 listAccessibleRoadmapsLight  filterViewableRoadmapIds    getAccessibleProjectIds
 (owner UNION project_access) (batched, fail-closed)      (owner UNION project_access)
        |                       |                           |
        v                       v                           v
 ai_context_roadmap_counts / ai_context_search_nodes / ai_context_list_tasks
        (uuid[] RPCs, SECURITY INVOKER, EXECUTE for service_role only)
 search_knowledge_chunks_projects (uuid[] RPC)
 roadmap_change_history (actor_id = caller, filtered by run_id | session_id)
```

Common to every route:

| Concern | Behaviour |
| --- | --- |
| Guard | class-level `SupabaseAuthGuard`; the actor is always `@CurrentUser()`, never a body-supplied id |
| Envelope | `{ data }` on success, `{ error: { message, status, … } }` on failure (global interceptor/filter) |
| Tracing | the `x-trace-id` request header is echoed into every `event=ai_context_*_timing` log line |
| Validation | the global `ValidationPipe` runs `whitelist + forbidNonWhitelisted + enableImplicitConversion`, so an unknown query param is a **400**. Booleans and CSV lists carry explicit `@Transform`s because implicit conversion would turn `'false'` into `true` and leave a CSV as one string |
| Denial | `NotFoundException` (404), never 403 — non-member workspace, unviewable roadmap, foreign project, foreign team |
| Primary consumer | the agent, via the user-scoped section of [`agent/app/core/nest_client.py`](../../agent/app/core/nest_client.py) (`resolve_refs`, `ai_context_actor`, `ai_context_overview`, …, `ai_context_changes`); the web kit sends `refs` to the agent, which hydrates them here |

## Lanes

Items are **laned**, never dropped: the workspace is a discovery boundary, not an
authorization one (`classifyAiContextLane` in
[`ai-context.service.ts`](../../backend/src/modules/execution/ai-context/services/ai-context.service.ts)).

| Lane | Meaning |
| --- | --- |
| `current` | in the requested `workspace_id` — or, with no workspace requested, in any workspace the caller belongs to |
| `other_workspace` | in another workspace the caller belongs to |
| `shared` | unhomed (`workspace_id` null) or in a workspace the caller is **not** a member of — reachable only through `project_access` |

## Routes

All paths are under `/api`. Query params are listed with their DTO limits
([`dto/ai-context.dto.ts`](../../backend/src/modules/execution/ai-context/dto/ai-context.dto.ts)).

| Method | Path | Query / body | Returns |
| --- | --- | --- | --- |
| GET | `/ai/context/actor` | — | `{ actor_id, display_name, locale: null, timezone: null }` |
| GET | `/ai/context/overview` | `workspace_id?` | `{ workspace, projects[], roadmaps[], teams[], counts_truncated, generated_at }` |
| GET | `/ai/context/roadmaps` | `workspace_id?`, `project_id?`, `cursor?` (≤200 chars), `limit?` 1–100 (default 50) | `{ items[], next_cursor }` |
| GET | `/ai/context/search` | `q` (≤160), `kinds?` CSV of `roadmap,project,epic,feature,task`, `workspace_id?`, `project_id?`, `roadmap_ids?` CSV (≤50 uuids), `limit?` 1–50 (default 20) | `{ matches[] }` |
| GET | `/ai/context/tasks` | `assigned_to_me?`, `status?`, `due_before?` / `due_after?` (ISO 8601), `overdue?`, `workspace_id?`, `project_id?`, `roadmap_ids?` (≤50), `limit?` 1–200 (default 50) | `{ tasks[] }` |
| GET | `/ai/context/knowledge-search` | `q` (≤500), `project_ids?` CSV (≤50), `workspace_id?`, `sources?` CSV, `limit?` 1–20 | `{ project_ids[], query, results[] }` |
| POST | `/ai/context/resolve-refs` | body `{ refs: [{ kind, id, label? }] }`, 1–25 refs | **200** `{ refs: ResolvedRef[] }` |
| GET | `/ai/context/projects/:projectId` | — | the project context pack (same shape as `roadmaps/:id/ai/context/project`) |
| GET | `/ai/context/projects/:projectId/brief` | — | latest brief |
| GET | `/ai/context/projects/:projectId/resources` | — | resource summary |
| GET | `/ai/context/projects/:projectId/meetings` | `window?` ∈ `upcoming, recent, all`, `limit?` 1–50 | meeting summary |
| GET | `/ai/context/projects/:projectId/members` | — | `{ project_id, members[] }` — owner first, then `project_access` |
| GET | `/ai/context/projects/:projectId/members/:memberId` | — | member details |
| GET | `/ai/context/changes` | **exactly one** of `run_id` / `session_id` (uuid), `limit?` 1–100 (default 50) | `{ changes[] }` |

`:projectId` and `:memberId` go through `ParseUUIDPipe` (a malformed id is a 400,
an unknown one a 404).

### `overview`

Everything the caller can reach, laned against `workspace_id`.

- **Membership before cache.** A `workspace_id` the caller is not a member of
  (`WorkspacesService.isMember`) is a 404 *before* the cache is touched, so a
  non-member never warms, let alone reads, a cached payload.
- **Cache.** Redis key `cache:v1:ai:context:overview:user:{uid}:ws:{wsId|none}`,
  TTL `REDIS_CACHE_DASHBOARD_TTL_SECONDS` (default **15 s**). Every variant is
  recorded in the per-user index key `cache:v1:index:ai:context:overview:user:{uid}`,
  which `RedisCacheInvalidationService`'s dashboard invalidation deletes, so a
  project/roadmap change drops all of a user's variants without enumerating
  workspaces.
- **Loader.** `ProjectsService.listDashboardProjects`,
  `IRoadmapsRepository.listAccessibleRoadmapsLight` (owner union `project_access`,
  the `findAll` predicate), `TeamsService.listMyTeams`, and
  `WorkspacesService.listMyWorkspaces` (skipped for guests — they have no
  `auth.users` row, hence no membership; `workspace` is `null` for them).
- **Counts.** `ai_context_roadmap_counts` runs over the first **300** roadmap ids
  (`AI_CONTEXT_OVERVIEW_COUNTS_CAP`); beyond that, roadmaps carry zero counts and
  `counts_truncated: true`. Per roadmap: `epics`, `features`, `tasks`, `open_tasks`
  (status ≠ `done`, a NULL status counting as `todo`), `overdue_tasks` (open and
  `due_date < now`).
- **Shapes.** Project: `id, title, status, workspace_id, owner_id, my_role` (the
  caller's `project_access` role, or `owner` for an owner without a row),
  `member_count, lane, roadmap_id` (derived from the roadmap list — a project has at
  most one linked roadmap). Roadmap: `id, name, status, owner_id, project_id,
  project_title, workspace_id, lane, updated_at, counts`. Team: `id, name,
  workspace_id, my_role, status, lane`. Workspace (when requested): `id, name, slug,
  my_role`.

### `roadmaps`

The light accessible list filtered in-process by `workspace_id` / `project_id`,
then keyset-paged on `(updated_at desc nulls last, id asc)`. The cursor is
`base64url("{updated_at}|{id}")` of the last item; an undecodable cursor is a 400.
Items: `id, name, description` (truncated to 280 chars), `status, owner_id,
updated_at, project: { id, title, workspace_id } | null`.

### `search`

- The needle is sanitized like `sanitizeLookupQuery` — lowercase, `%`/`_` become
  spaces, whitespace collapses, ≤160 chars. An empty needle returns `{ matches: [] }`
  without touching the database.
- `kinds` defaults to `epic, feature, task`. Those three go through
  `ai_context_search_nodes` over the accessible roadmap ids; `roadmap` and `project`
  are matched **in-process** on name/title and description.
- **Rank**: `0` exact title, `1` prefix, `2` substring, `3` description-only; tasks
  are title-only (their descriptions are long). Sort is rank, then `updated_at`
  desc, then id. `limit` applies after the merge.
- `roadmap_ids` **intersects** the accessible set and can never widen it; with it,
  project matches are limited to those roadmaps' projects.
- Attribution (`roadmap_name`, `project_id`, `project_title`, `workspace_id`) is
  joined from the accessible map, so a row the service cannot attribute is dropped,
  not leaked. Match shape: `id, kind, title, status, rank, roadmap_id, roadmap_name,
  project_id, project_title, workspace_id, epic_id?, feature_id?, parent_title?,
  updated_at`. This is its own DTO on purpose — the in-roadmap
  `RoadmapAiContextSearchMatchDto` is compared against the shared schema by
  `scripts/check_roadmap_ai_schema.mjs` and must not change shape.

### `tasks`

`ai_context_list_tasks` over the accessible (or narrowed) roadmap ids.

| Filter | Semantics |
| --- | --- |
| `status` absent or `open` | `todo, in_progress, in_review, blocked` |
| `status=all` | no status filter |
| `status=<one>` | that status; a NULL status counts as `todo`, so it lands in `open` but never in `blocked` |
| `assigned_to_me=true` | `roadmap_task_assignees` **or** the legacy `roadmap_tasks.assignee_id`. The in-roadmap `tasks-assigned-to-me` matches the join-derived `assignee_ids` set too since the multi-assignee change (2026-09-06; before it, only the legacy column) |
| `overdue=true` | `due_date < now` and not `done` |
| `due_after` / `due_before` | inclusive bounds on `due_date` |

Order: due-dated tasks first (ascending), then `updated_at` desc. Task shape:
`id, title, status, priority, due_date, updated_at, assignee_ids[], feature_id,
feature_title, epic_id, epic_title, roadmap_id, roadmap_name, project_id,
project_title, workspace_id`.

### `knowledge-search`

The cross-project twin of `roadmaps/:id/ai/context/knowledge-search` — a separate
DTO because this family spells the query param `q` while the roadmap-keyed one keeps
`query`. Candidates are `project_ids` (or every accessible project), intersected
with `getAccessibleProjectIds` in one bulk read, then narrowed by `workspace_id`
through `projects.workspace_id`. An empty intersection is a stable empty result
that never reaches the search pipeline. Otherwise
`KnowledgeSearchService.searchAcrossProjects` calls the RPC
`search_knowledge_chunks_projects` once over the union, passing the chat rooms the
caller participates in across those projects as `p_room_ids` (guests: none), so
`chat_message` chunks stay room-scoped. `sources` ∈ `chat_message, task_comment,
activity_log, brief, file_chunk`. Each result carries its `project_id`.

### `resolve-refs`

Hydrates the composer's @-mentions **once per run**
([`ai-context-refs.service.ts`](../../backend/src/modules/execution/ai-context/services/ai-context-refs.service.ts)).
`kind` ∈ `project, roadmap, epic, feature, task, milestone, team`; `label` is
accepted for the wire shape and not used by the backend. Refs are deduped on
`(kind, id)`, then: one batch `.in()` load per kind present (tasks embed
`feature → epic`, since a task row carries no roadmap id), **one**
`filterViewableRoadmapIds` over the union of every roadmap those rows hang off, one
`getAccessibleProjectIds` if any project is involved, one `team_members` probe.

| Kind | Accessible when |
| --- | --- |
| `task`, `feature`, `epic`, `milestone`, `roadmap` | the (parent) roadmap is viewable: owner, or a `project_access` row on its project |
| `project` | owner, or in `getAccessibleProjectIds` |
| `team` | owner or member (mirrors `TeamsService.resolveViewerRole`) |

Resolved shape: `kind, id, accessible, title?, status?, roadmap_id?, project_id?,
workspace_id?, parent_chain?, error_code?`. `parent_chain` is **nearest-first**:
task → feature → epic → roadmap → project → workspace; a roadmap ref's chain starts
at its project; project and team chains hold only the workspace. Failure modes:

| Situation | Result |
| --- | --- |
| Row missing, or its parent roadmap not viewable, or project/team not accessible | `{ accessible: false, error_code: 'NOT_FOUND' }` — **no title**, so a denied id never leaks whether it exists |
| A query error while loading or authorizing a kind | every ref of that kind → `LOOKUP_FAILED` (fail-closed per kind) |
| A failed project/workspace *title* lookup | the chain is shortened; the ref stays accessible (titles are decoration on an already-authorized ref) |

The route never throws for an individual ref; the agent treats a transport-level
failure of the whole call as every ref inaccessible.

### `projects/:projectId/*`

Thin delegates to `RoadmapAiProjectContextService`'s project-keyed entry points
(`getProjectContextForProject`, `getProjectBriefForProject`, …), whose roadmap-keyed
twins serve the in-roadmap assistant with byte-identical payloads. Authorization is
`ProjectAuthorizationService.resolvePermissions` — owner or any `project_access`
row, else 404. `members` returns the same compact rows the context pack carries
(`id, display_name, role`).

### `changes`

The verify phase's "did every planned batch land" check across N roadmaps, and the
authoritative guard on resume. Exactly one of `run_id` / `session_id` is required
(both or neither → 400). The repository reads `roadmap_change_history` with
`actor_id = caller` plus the run/session filter, ascending `committed_at`; the
service then runs `filterViewableRoadmapIds` and **drops** rows on roadmaps the
caller can no longer view (fail closed, not an error). Row shape: `change_id,
roadmap_id, project_id, status, operations_count, semantic_change_count,
revision_token_after, committed_at, run_id, session_id`.

## Commit attribution

`POST /api/roadmaps/:id/ai/commit` (`RoadmapAiService.commit`,
[`roadmap-ai.service.ts`](../../backend/src/modules/execution/roadmaps/services/roadmap-ai.service.ts))
gained two optional uuid fields on `RoadmapAiCommitDto`
([`roadmap-ai.dto.ts`](../../backend/src/modules/execution/roadmaps/dto/roadmap-ai.dto.ts)):

| Field | Meaning |
| --- | --- |
| `session_id?` | the `roadmap_ai_sessions` row the commit came from. Resolved **after** authorization to a session the caller owns (`id` + `user_id`); a missing, foreign, or unreadable session yields `null` with a warning — attribution is observability and must never turn a valid commit into a 4xx |
| `run_id?` | the agent run inside that session (UUIDv4 minted by the agent; one run may commit N roadmaps). No FK — runs live in Redis |

Both land on the `roadmap_change_history` row (`session_id`, `run_id`) and on the
`roadmap.committed` audit metadata (`ai_session_id`, `ai_run_id`, `ai_scope`).
Two behaviours switch on `run_id`:

| | `run_id` absent (web, MCP, legacy) | `run_id` present (agent run) |
| --- | --- | --- |
| Change-history insert | fire-and-forget (`void`) | **awaited**; the response carries `history_recorded: boolean` — `false` when the insert failed, and the commit is still 200 because the roadmap is already updated (the agent's verify phase reads the row back by run) |
| Idempotency replay record (`idempotency_key`) | the full response, including `candidate_snapshot` and `roadmap`, kept **600 s** | a **trimmed** record — `change_id, committed_at, revision_token, semantic_diff, operation_results, timeline, temp_id_mapping, history_recorded`, no snapshot or roadmap payload — kept **24 h** (`RUN_COMMIT_IDEMPOTENCY_TTL_SECONDS = 86_400`), because a paused run may retry the same batch hours later. A replay returns that shape verbatim |

The replay record is written **after** the history outcome is known, so a replay
reports the same `history_recorded` the first attempt did. Existing guards are
unchanged: the same key with different operations is a 409 `IDEMPOTENCY_KEY_REUSED`,
a stale `revision_token` a 409 `STALE_REVISION`, and N roadmaps are N independent
commits — there is no cross-roadmap atomic commit.

## Workspace AI threads

`WorkspaceAiSessionsController`
([`workspace-ai-sessions.controller.ts`](../../backend/src/modules/execution/roadmaps/controllers/workspace-ai-sessions.controller.ts))
is the dashboard assistant's thread store: the same eight routes, DTOs, and status
codes as `roadmaps/:id/ai-sessions`, keyed on a workspace. It lives in
`RoadmapsModule` because `RoadmapAiSessionsService` is shared; every method takes an
`AiSessionScope` (`{ kind: 'workspace', workspaceId }` here) first.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/workspaces/:id/ai-sessions` | `archived?`, `limit?` 1–100 |
| POST | `/workspaces/:id/ai-sessions` | `{ title?, mode? }`, `mode` ∈ `chat, edit_plan, plan_proposal` → 201 |
| GET | `/workspaces/:id/ai-sessions/:sessionId` | |
| PATCH | `/workspaces/:id/ai-sessions/:sessionId` | `{ title?, is_archived?, is_pinned? }` |
| PUT | `/workspaces/:id/ai-sessions/:sessionId/agent-state` | `{ agent_state }`, the agent's durable memory snapshot → 204 |
| DELETE | `/workspaces/:id/ai-sessions/:sessionId` | 204 |
| GET | `/workspaces/:id/ai-sessions/:sessionId/messages` | `limit?` 1–200, `before_seq?` / `after_seq?` |
| POST | `/workspaces/:id/ai-sessions/:sessionId/messages` | `{ role, content, … , metadata? }` → 201; `metadata` (refs, run views) and `agent_state` share a **64 KB** serialized ceiling, exceeded → 400 leading with `MESSAGE_METADATA_TOO_LARGE` |

Scope rules, shared with the roadmap route: the scope check is the same predicate
the RLS uses (`WorkspacesService.isMember` here, roadmap view on the roadmap route)
and denies with 404; every read pins both the target id column and the `scope`
discriminator, so a roadmap thread cannot be read through the workspace route or
vice versa, even by its owner. The row carries `scope`, `roadmap_id | null`,
`workspace_id | null` — see
[Data → schema overview](../07-data-and-db/schema-overview.md#roadmaps) and
[RLS → AI thread tables](../07-data-and-db/rls-and-security.md#ai-thread-tables).

## Database dependencies

| Object | Migration | Used by |
| --- | --- | --- |
| `roadmap_ai_sessions.scope`, `.workspace_id`, nullable `.roadmap_id`, own-row RLS | [`20260904090000_ai_sessions_scope_and_context_rpcs.sql`](../../supabase/migrations/20260904090000_ai_sessions_scope_and_context_rpcs.sql) | both AI-sessions controllers |
| `roadmap_change_history.session_id`, `.run_id` | same | commit attribution, `changes` |
| `ai_context_roadmap_counts`, `ai_context_search_nodes`, `ai_context_list_tasks` | same | `overview`, `search`, `tasks` |
| `search_knowledge_chunks_projects` | [`20260904090100_search_knowledge_chunks_projects.sql`](../../supabase/migrations/20260904090100_search_knowledge_chunks_projects.sql) | `knowledge-search` |

Both migrations are reported applied to hosted dev and production on 2026-09-05
(see [migrations-workflow.md](../07-data-and-db/migrations-workflow.md#applied-through-mcp)).

## See also

- [modules.md](./modules.md) — where `ai-context` sits among the 42 modules
- [Agent & Roadmap AI](../05-agent-ai/README.md) — the runtime that calls this surface
- [Domains → Workspaces](../11-domains/workspaces/README.md) — the tier a workspace thread belongs to
