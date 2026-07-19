# Cross-Service Flows

> **Last updated:** 2026-07-19 · **Status:** current

Three request lifecycles that cross service boundaries: **roadmap AI editing**
(the most load-bearing), **meetings scheduling**, and **realtime / chat**. Each is
traced hop by hop with the real files and routes. If you internalize one thing:
the web app talks to the **agent directly**, and the agent calls **back** into the
backend — the AI edit path does not flow web → backend → agent.

## Flow 1 — Roadmap AI edit

The canvas AI panel sends a message straight to the Python agent. The agent runs a
tool-calling loop, reading roadmap context back through the NestJS backend, then
auto-commits the resulting operations through the backend, which mediates all
roadmap writes. (The backend is *not* the only writer to Supabase — the web app
writes a few tables, e.g. `project_briefs` and `profiles`, directly under RLS.)
A lean diff comes back so the UI can refresh without a full payload.

```
 web (AI panel)                agent (FastAPI)              backend (NestJS)        Supabase
      │                              │                            │                    │
      │ POST /agent/sessions/:id/messages                         │                    │
      │─────────────────────────────►│                            │                    │
      │        (Bearer JWT /          │ load session state         │                    │
      │         x-guest-user-id)      │◄──► Upstash Redis          │                    │
      │                              │                            │                    │
      │                              │ v2 loop: read tools ───────► GET /roadmaps/:id/  │
      │                              │   (context/resolve/search)  │   ai/context/*     │
      │                              │◄───────────────────────────│                    │
      │                              │                            │                    │
      │                              │ edit_plan → auto-commit     │                    │
      │                              │ POST /roadmaps/:id/ai/commit│                    │
      │                              │  {operations, revision_token,                    │
      │                              │   idempotency_key,          │ applyOperations    │
      │                              │   include_roadmap:false} ──►│ validate + diff    │
      │                              │                            │ upsertFullRoadmap ─►│ write
      │                              │                            │ publishRoadmapChange│
      │                              │◄───────────────────────────│ (lean diff)        │
      │◄─────────────────────────────│ MessageResponse            │                    │
      │  realtime data_changed → React Query invalidate → refetch → store.updateServerData
```

### Hops

1. **web → agent.** `roadmapAgentService.sendMessage(...)`
   ([`web/src/services/roadmap-agent.service.ts`](../../web/src/services/roadmap-agent.service.ts))
   → `POST {VITE_AGENT_API_URL}/agent/sessions/:sessionId/messages` via the dedicated
   `agentApiClient` ([`web/src/api/agent-axios.ts`](../../web/src/api/agent-axios.ts)).
   Auth is the Supabase JWT (or `x-guest-user-id` for guests); an optional
   `x-trace-id` links live trace polling.
2. **web → backend (parallel, not the edit path).** Chat history is persisted
   separately via `POST/GET /api/roadmaps/:id/ai-sessions*`
   ([`roadmap-ai-sessions.controller.ts`](../../backend/src/modules/roadmaps/controllers/roadmap-ai-sessions.controller.ts)).
   This is bookkeeping, independent of the edit.
3. **agent receives + hydrates.** `app.main` routes to
   [`agent/app/api/routes/sessions.py`](../../agent/app/api/routes/sessions.py)
   `send_message` → `send_message_flow`; session state loads from Upstash Redis via
   [`session_store.py`](../../agent/app/core/session_store.py) (compare-and-set writes).
4. **agent runs the v2 loop.** `AgentService.plan_message` →
   [`agent/app/core/v2/loop.py`](../../agent/app/core/v2/loop.py) `run_loop`: the model
   calls read tools in parallel; the edit/stage tool is terminal on success. The
   outcome's `response_mode` is `chat`, `edit_plan`, or `plan_proposal`.
5. **agent → backend (context reads).** During the loop,
   [`nest_client.py`](../../agent/app/core/nest_client.py) calls
   `GET {NEST_API_BASE_URL}/roadmaps/:id/ai/context/*` (summary, members, search,
   resolve, features, tasks, nodes), served by
   [`roadmap-ai.controller.ts`](../../backend/src/modules/roadmaps/controllers/roadmap-ai.controller.ts).
   The caller's auth header is forwarded.
6. **agent → backend (commit).** On `edit_plan`, `execute_auto_commit` →
   `POST /roadmaps/:id/ai/commit` with the staged `operations`, a `revision_token`,
   an `idempotency_key`, and **`include_roadmap: false`** (the lean path). May run
   inline or in the background when `AGENT_ASYNC_AUTO_COMMIT_ENABLED` is set.
7. **backend applies to Supabase.** `RoadmapAiService.commit()`
   ([`roadmap-ai.service.ts`](../../backend/src/modules/roadmaps/services/roadmap-ai.service.ts)):
   `assertCanEditRoadmap` first, then the idempotency replay guard (runs *after*
   authz, scoped by `userId` + `sha256(operations)` — a key reused with different
   operations returns 409 `IDEMPOTENCY_KEY_REUSED`); 409 `STALE_REVISION` on token
   mismatch; `applyOperations` in memory → `validateState` → `computeSemanticDiff` →
   `patchRepo.upsertFullRoadmap(...)`. With `include_roadmap=false` it skips
   reloading the full roadmap and returns a fresh `revision_token` from a ~1ms
   `findUpdatedAt` — a deliberate latency optimization (benchmark-covered by
   `scripts/benchmark_roadmap_ai_commit.mjs`). For a project-linked roadmap it also
   fire-and-forget logs a `roadmap.committed` row to `project_activity_log`.
8. **backend → realtime.** `publishRoadmapChange(roadmapId, userId)` emits a
   `data_changed` event (see [Flow 3](#flow-3--realtime--chat)).
9. **response → web.** The agent's `MessageResponse` carries `operations`,
   `commit_summary`, and `response_mode`. The panel
   ([`RoadmapAiAssistantPanel.tsx`](../../web/src/components/roadmap/ai/RoadmapAiAssistantPanel.tsx))
   renders it; the committed change lands via the realtime `data_changed` →
   React Query invalidation ([`useRoadmapDataSync.ts`](../../web/src/hooks/useRoadmapDataSync.ts))
   → refetch → `roadmapStore.updateServerData` (merges without disturbing in-flight
   optimistic edits).

### The shared contract

Operations conform to
[`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json)
(mirrored in TypeScript as `AgentOperation`). Operation types:
`add_epic`, `add_feature`, `add_task`, `add_milestone`, `update_node`, `move_node`,
`delete_node`, `mark_status`, `shift_dates`. Nodes are referenced by id or by a
`resolve_node_reference` label lookup. When operation shapes change, update the
schema **and** run `npm run check:roadmap-ai-schema` from `backend/` — it is
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
   [`realtime-publisher.service.ts`](../../backend/src/modules/realtime/realtime-publisher.service.ts):
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
   [`realtime.controller.ts`](../../backend/src/modules/realtime/realtime.controller.ts)
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
