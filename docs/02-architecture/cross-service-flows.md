# Cross-Service Flows

> **Last updated:** 2026-09-05 · **Status:** current

Three request lifecycles that cross service boundaries: **roadmap AI editing**
(the most load-bearing), **meetings scheduling**, and **realtime / chat**. Each is
traced hop by hop with the real files and routes. If you internalize one thing:
the web app talks to the **agent directly**, and the agent calls **back** into the
backend as the user - the AI edit path does not flow web -> backend -> agent.

## Flow 1 — Roadmap AI edit

The web creates the durable thread through the backend, then sends the message
straight to the Python agent. The agent runs the message as a **run**
(investigate -> propose -> execute -> verify; see
[Agent -> runs and phases](../05-agent-ai/runs-and-phases.md)), reading context
back through the NestJS backend as the user, and commits **one batch per roadmap**
through `POST /roadmaps/:id/ai/commit`, which mediates all roadmap writes. A step
that runs out of budget returns `run.next: "continue"` and the web calls
`continue` until the run settles. The same flow serves the in-roadmap panel
(roadmap scope) and the dashboard assistant (workspace scope).

```
 web (AI kit)              backend (NestJS)             agent (FastAPI)          Supabase
   |                            |                            |                     |
   | POST /api/{roadmaps|workspaces}/:id/ai-sessions         |                     |
   |--------------------------->| insert roadmap_ai_sessions ----------------------->|
   |<---------------------------| {id}                       |                     |
   | POST /agent/sessions {session_id: id, scope}            |                     |
   |-------------------------------------------------------->| owner_key           |
   |                            |<---------------------------| GET .../ai/context/actor
   |                            |                            |   (or GET /workspaces/:id)
   | POST .../ai-sessions/:id/messages  (user turn, metadata.refs)                 |
   |--------------------------->|                            |                     |
   | POST /agent/sessions/:id/messages {message, refs, capabilities:["continue"]}  |
   |-------------------------------------------------------->| run lock, run_started
   |                            |<---------------------------| POST /ai/context/resolve-refs
   |                            |<---------------------------| GET /roadmaps/:id/ai/context/*
   |                            |<---------------------------| GET /ai/context/*  (workspace reads)
   |                            |                            | investigate -> policy -> execute
   |                            |<---------------------------| POST /roadmaps/:id/ai/commit
   |                            |  {operations, revision_token, idempotency_key,   |
   |                            |   include_roadmap:false, session_id, run_id}     |
   |                            | applyOperations -> upsertFullRoadmap ------------>| write
   |                            | roadmap_change_history (session_id, run_id) ---->|
   |                            |---------------------------->| {revision_token, history_recorded}
   |                            |<---------------------------| ... one commit per roadmap
   |                            |<---------------------------| verify -> report
   |<--------------------------------------------------------| MessageResponse {run, commits}
   |  while run.next == "continue": POST /agent/sessions/:id/runs/:run_id/continue |
   |  poll GET /agent/sessions/:id/traces/:trace_id/events  (+ optional realtime push)
   |                            |<---------------------------| PUT .../ai-sessions/:id/agent-state
   | POST .../ai-sessions/:id/messages  (assistant turn, metadata.run)             |
   |  realtime data_changed -> React Query invalidate -> refetch -> store.updateServerData
```

### Hops

1. **web -> backend (thread).** `useAiThreads.ensureThread`
   ([`web/src/components/ai/useAiThreads.ts`](../../web/src/components/ai/useAiThreads.ts))
   creates the durable thread row via `aiSessionsService`
   ([`ai-sessions.service.ts`](../../web/src/services/ai-sessions.service.ts)), whose
   base path comes from the scope: `POST /api/roadmaps/:id/ai-sessions`
   ([`roadmap-ai-sessions.controller.ts`](../../backend/src/modules/execution/roadmaps/controllers/roadmap-ai-sessions.controller.ts))
   or `POST /api/workspaces/:id/ai-sessions`
   ([`workspace-ai-sessions.controller.ts`](../../backend/src/modules/execution/roadmaps/controllers/workspace-ai-sessions.controller.ts));
   the two controllers expose the same eight routes. The row carries
   `scope`, `roadmap_id` or `workspace_id`, and later `metadata.agent_state`.
2. **web -> agent (session).** `aiAgentService.createSession({session_id: row.id, scope,
   base_revision, metadata: <agent_state snapshot>})`
   ([`ai-agent.service.ts`](../../web/src/services/ai-agent.service.ts)) via the
   dedicated `agentApiClient` ([`agent-axios.ts`](../../web/src/api/agent-axios.ts),
   180s timeout). Auth is the Supabase JWT or `X-Guest-User-Id` (required: 401
   `AUTH_REQUIRED`). The agent records the caller as `owner_key`, verifies the scope
   as the user (`GET /roadmaps/:id/ai/context/actor` or `GET /workspaces/:id`; a
   403/404 is 404 `SESSION_SCOPE_NOT_FOUND`), and keys the Redis session by the DB
   row id. Best-effort on thread creation; the send path repeats it if needed.
3. **web -> backend (user turn).** `runController.send`
   ([`runController.ts`](../../web/src/components/ai/runController.ts)) persists the
   user turn first - `POST .../ai-sessions/:id/messages` with the `@`-mention spans in
   `metadata.refs` (64 KB ceiling) - and receives `seed_messages` for a later
   rehydrate.
4. **web -> agent (message).** `POST /agent/sessions/:id/messages`
   `{message, refs: [{kind,id,label}], capabilities: ["continue"]}` with an
   `X-Trace-Id` that names this segment's trace and starts the trace poll. On 404
   `SESSION_NOT_FOUND` the controller recreates the agent session from the snapshot
   plus seeds and retries once; on 409 `RUN_IN_PROGRESS` it adopts the returned run,
   drives it to completion, then re-sends.
5. **agent step.** [`sessions.py`](../../agent/app/api/routes/sessions.py) ->
   [`flows.py`](../../agent/app/api/routes/sessions_support/flows.py) ->
   [`orchestrator.step`](../../agent/app/core/runtime/orchestrator.py): ownership
   check, the per-session run lock (Redis `SET NX EX`), then `advance()` through the
   phases. Investigate runs the loop engine
   ([`engine/loop.py`](../../agent/app/core/engine/loop.py)); refs are hydrated once
   via `POST /api/ai/context/resolve-refs`
   ([`ai-context.controller.ts`](../../backend/src/modules/execution/ai-context/ai-context.controller.ts));
   roadmap reads go to `GET /roadmaps/:id/ai/context/*`
   ([`roadmap-ai.controller.ts`](../../backend/src/modules/execution/roadmaps/controllers/roadmap-ai.controller.ts))
   and cross-scope reads (workspace overview, `list_roadmaps`, `search_everything`,
   `list_my_tasks`, project brief/resources/meetings/members) to `GET /api/ai/context/*`,
   all with the caller's auth forwarded and every denial a 404.
6. **checkpoint policy.** A `stage_edits` batch on the focus roadmap (up to 90 ops,
   deletes included) executes immediately - the in-roadmap behaviour byte for byte.
   A non-focus roadmap, several roadmaps, or a workspace-scope batch that deletes or
   exceeds 15 ops is recorded as a proposal and the step returns
   `run.next: "await_user"` with a `plan_proposal`; the user's confirm
   (`__plan_decision__`) resumes the same run in execute.
7. **agent -> backend (commit, per roadmap).** [`phases/execute.py`](../../agent/app/core/runtime/phases/execute.py):
   proposal/materialized/revert batches are previewed (`POST /roadmaps/:id/ai/preview`,
   one repair turn) first; direct edits are not. Then `POST /roadmaps/:id/ai/commit`
   with `operations`, `revision_token`, `idempotency_key`, **`include_roadmap: false`**
   (the lean path), `session_id` and `run_id`. `STALE_REVISION` refreshes the token and
   retries once with the same key; transient 5xx/408/429 retry once after 1s. Progress
   is persisted after every commit; a failure never stops the next roadmap.
8. **backend applies to Supabase.** `RoadmapAiService.commit()`
   ([`roadmap-ai.service.ts`](../../backend/src/modules/execution/roadmaps/services/roadmap-ai.service.ts)):
   `assertCanEditRoadmap` first, then the idempotency replay guard (scoped by
   `userId` + `sha256(operations)`; a key reused with different operations is 409
   `IDEMPOTENCY_KEY_REUSED`), 409 `STALE_REVISION` on token mismatch,
   `applyOperations` in memory -> `validateState` -> `computeSemanticDiff` ->
   `upsertFullRoadmap`. A `session_id` the caller does not own is dropped, never
   rejected. With `include_roadmap=false` it returns a fresh `revision_token` from a
   ~1ms `findUpdatedAt` (benchmark-covered by `scripts/benchmark_roadmap_ai_commit.mjs`).
   For a run-attributed commit the `roadmap_change_history` insert (with `session_id`,
   `run_id`) is **awaited** and reported as `history_recorded`; otherwise it stays
   fire-and-forget. A project-linked roadmap also logs `roadmap.committed` to
   `project_activity_log`.
9. **backend -> realtime.** `publishRoadmapChange(roadmapId, userId)` emits a
   `data_changed` event (see [Flow 3](#flow-3--realtime--chat)).
10. **verify + response.** The agent checks each commit (all batches committed, diff
    vs. plan, revision advanced, history recorded), writes the report with at most one
    model call, and returns `MessageResponse` with `assistant_message`, `run`
    (`status`, `phase`, `next`, `checkpoint`, `verify`), and `commits[]` - this step's
    commits carry `operations` and `impacted_items`. If the soft budget (90s) ran out
    first, the response is `parse_mode: "run_step"` with `run.next: "continue"` and the
    web calls `POST .../runs/:run_id/continue` (same trace, any instance) until it
    settles. Trace events are served from Redis by
    `GET .../traces/:trace_id/events`, with the optional Durable Objects push as an
    accelerator.
11. **write-back.** At a checkpoint or terminal the agent pushes the memory-class
    snapshot to `PUT .../ai-sessions/:id/agent-state` (fire-and-forget); the web
    persists the assistant turn with `metadata.run` (run id, phase, status, commits
    without operations) and `plan_proposal`/`clarifier` when present.
12. **canvas refresh.** The roadmap wrapper
    ([`RoadmapAiAssistantPanel.tsx`](../../web/src/components/roadmap/ai/RoadmapAiAssistantPanel.tsx))
    applies each commit's impacted items to `roadmapStore` when that roadmap is the one
    on screen, otherwise only invalidates its query; the committed state also lands via
    realtime `data_changed` -> React Query invalidation
    ([`useRoadmapDataSync.ts`](../../web/src/hooks/useRoadmapDataSync.ts)) -> refetch ->
    `roadmapStore.updateServerData`. The dashboard panel
    ([`DashboardAiPanel.tsx`](../../web/src/components/home/DashboardAiPanel.tsx))
    never imports `roadmapStore`; it invalidates the dashboard and per-roadmap queries
    for every committed roadmap.

### The shared contract

Operations conform to
[`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json)
(mirrored in TypeScript as `AgentOperation`). Operation types:
`add_epic`, `add_feature`, `add_task`, `add_milestone`, `update_node`, `move_node`,
`delete_node`, `mark_status`, `shift_dates`. Nodes are referenced by id, by a
`resolve_node_reference` lookup, or by a handle (`E1`, `E1.F2`, `R2.E1`) the agent
expands before the batch leaves the agent. When operation shapes change, update the
schema **and** run `npm run check:roadmap-ai-schema` from `backend/` - it is
consumed by both NestJS validation and the agent's contract tests. See
[Agent & Roadmap AI](../05-agent-ai/README.md).

## Flow 2 — Meetings scheduling

Fully documented in the [Meetings](../11-domains/README.md) domain set (currently at
[`docs/11-domains/meetings/`](../11-domains/meetings/architecture.md)). The cross-service summary:

1. **web collects wall-clock + IANA timezone**, converts to a UTC instant
   (`wallTimeToUtcISO`), and `POST /api/meetings { scheduled_at, timezone, … }`.
2. **backend authorizes + converts + guards overlap** — asserts the project role,
   resolves the video link, and `assertHostFree` (409 on conflict). *The backend
   owns the clock* — the browser never sends a naive local time.
3. **backend materializes recurring series** — a `meeting_series` template plus
   expanded child `meetings` rows (`expandOccurrences`, DST-correct).
4. **Supabase stores** `meetings` + `meeting_series` + `meeting_participants` as the
   service role; notifications are best-effort.
5. **Cloud Scheduler → backend** every minute `POST /api/meetings/cron/reminders`
   (shared-secret guarded) claims due reminders atomically and notifies participants.
   Gated on `MEETINGS_REMINDERS_ENABLED`.

## Flow 3 — Realtime / chat

The backend (and agent) publish events to the Cloudflare Worker; the Worker routes
each to a Durable Object per room, which fans out to connected WebSockets. Clients
subscribe with a thin WS client that mirrors the old Supabase channel API.

```
 backend/agent            realtime Worker            Durable Object        web clients
      │                        │                          │                   │
      │ POST /publish          │  idFromName(room)         │                   │
      │  x-realtime-token ────►│─────────────────────────►│ broadcast(event)  │
      │  {room,event,payload}  │                          │──────────────────►│ ws.send
      │                        │                          │                   │
      │       web opens  ws?room=<key>&token=<jwt> ───────► verify JWT +       │
      │                        │  authorizeWithBackend ───► /api/realtime/authorize
      │                        │◄─────────────────────────────────────────────│
```

### Publish path

1. **Domain services trigger a publish.** Chat: `ChatService` →
   `realtime.publishChatEvent(...)`. Roadmap canvas / AI: `roadmap-ai.service.ts`,
   `roadmap-patch.service.ts`, and the epic/feature/task/milestone services →
   `realtime.publishRoadmapChange(roadmapId, fromUserId)`.
2. **Publisher fans out.**
   [`realtime-publisher.service.ts`](../../backend/src/modules/shared/realtime/realtime-publisher.service.ts):
   roadmap events go to room `roadmap:{id}` (`data_changed`); chat events go to a
   per-recipient `user:{userId}` room (`chat`). `POST {REALTIME_WORKER_URL}/publish`
   with `x-realtime-token`. **A dormant no-op unless both `REALTIME_WORKER_URL` and
   `REALTIME_PUBLISH_TOKEN` are set** — fire-and-forget, never throws.
3. **Worker routes.** [`realtime/src/index.ts`](../../realtime/src/index.ts)
   `handlePublish` validates the token, `env.ROOMS.idFromName(room)`, forwards to the DO.
4. **DO fans out.** [`realtime/src/room.ts`](../../realtime/src/room.ts) `RealtimeRoom`
   → `broadcast` over `getWebSockets()` (WebSocket Hibernation API).

### Subscribe path

5. **Client connects.** [`web/src/lib/realtime.ts`](../../web/src/lib/realtime.ts)
   opens `{VITE_REALTIME_URL→ws}/ws?room=<key>&token=<jwt>`; lazy connect with
   backoff. `isRealtimeConfigured()` = `Boolean(VITE_REALTIME_URL)`.
6. **Worker authorizes the upgrade.** `verifyToken` (Supabase JWT via JWKS or
   `SUPABASE_JWT_SECRET`); `user:` rooms are self-scoped, others call
   `POST {BACKEND_AUTHORIZE_URL}` →
   [`realtime.controller.ts`](../../backend/src/modules/shared/realtime/realtime.controller.ts)
   `@Post('authorize')` → `canViewRoadmap` / `canAccessRoom`.
7. **Hooks invalidate on events.** Roadmap:
   [`useRoadmapDataSync.ts`](../../web/src/hooks/useRoadmapDataSync.ts) /
   `useRoadmapCollaboration.ts` (peer cursor/typing/drag relayed by the DO). Chat:
   [`useChatRealtime.ts`](../../web/src/hooks/useChatRealtime.ts) subscribes the
   single `user:{userId}` inbox room.

### Feature flags & dormancy

| Flag | Where | Default | Gates |
| --- | --- | --- | --- |
| `realtimeRoadmapTransport` | `web/src/config/featureFlags.ts` | `durable-objects` | Falls back to Supabase Realtime when `VITE_REALTIME_URL` is unset |
| `realtimeChatTransport` | same | `durable-objects` | Same fallback |
| `realtimeCursors` | same | `true` | High-frequency cursor broadcasts only |
| `realtimeAiTracePush` | web + agent | `true` | AI trace events pushed to `user:{id}`; **accelerator only** — trace polling stays authoritative |

The Durable Objects transport is **shipped but dormant** unless configured on both
sides: `VITE_REALTIME_URL` (web) and `REALTIME_WORKER_URL` + `REALTIME_PUBLISH_TOKEN`
(backend/agent). Until then, realtime falls back to legacy Supabase Realtime. See
[Realtime](../06-realtime/README.md).

## See also

- [system-overview.md](./system-overview.md) — the units and their edges.
- [deploy-topology.md](./deploy-topology.md) — where each service runs.
