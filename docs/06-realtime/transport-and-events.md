# Transport & Events

> **Last updated:** 2026-07-09 · **Status:** current

How events get from a backend write to a browser: the backend (and agent) **publish**
to the Worker, which routes to a Durable Object that **fans out** to connected
sockets; clients **subscribe** with a WebSocket that mirrors the old Supabase channel
API. The whole thing is **dormant unless configured** on both sides, with an
automatic fallback to Supabase Realtime.

```
 backend/agent            Worker                 Durable Object      web clients
     │ POST /publish        │ idFromName(room)      │                  │
     │ x-realtime-token ───►│─────────────────────►│ broadcast ──────►│ ws.send
     │                      │                       │                  │
     │   web opens ws?room=<key>&token=<jwt> ──────► verify JWT +      │
     │                      │ authorizeWithBackend ─► /api/realtime/authorize
```

## Publish path

1. **A domain service triggers a publish.** Chat → `realtime.publishChatEvent(...)`;
   roadmap canvas/AI → `realtime.publishRoadmapChange(roadmapId, fromUserId)`.
2. **The publisher fans out.**
   [`realtime-publisher.service.ts`](../../backend/src/modules/realtime/realtime-publisher.service.ts)
   POSTs to `${REALTIME_WORKER_URL}/publish` with an `x-realtime-token` header —
   roadmap events to `roadmap:{id}` (`data_changed`), chat events to `user:{userId}`
   (`chat`). It's **fire-and-forget**, never throws, and is a **no-op unless both
   `REALTIME_WORKER_URL` and `REALTIME_PUBLISH_TOKEN` are set**.
3. **The Worker routes** — validates the token, `env.ROOMS.idFromName(room)`, forwards
   to the DO, which broadcasts to its sockets.

The agent can also publish `ai_trace_event` to `user:{id}` (gated by
`AGENT_REALTIME_TRACE_PUSH_ENABLED`) as an accelerator for live AI traces — trace
polling stays authoritative.

## Subscribe path

1. **The client connects** — [`web/src/lib/realtime.ts`](../../web/src/lib/realtime.ts)
   opens `{VITE_REALTIME_URL→ws}/ws?room=<key>&token=<jwt>`, a thin WS client that
   mirrors the Supabase channel API (`on`/`send`/`track`), with lazy connect and
   reconnect-with-backoff. `isRealtimeConfigured()` = `Boolean(VITE_REALTIME_URL)`.
2. **The Worker authorizes the upgrade** — `verifyToken` (Supabase JWT via JWKS or
   `SUPABASE_JWT_SECRET`). `user:` rooms are self-scoped; other rooms
   `POST {BACKEND_AUTHORIZE_URL}` →
   [`realtime.controller.ts`](../../backend/src/modules/realtime/realtime.controller.ts)
   `@Post('authorize')` → `canViewRoadmap` / `canAccessRoom`. The upgrade is then
   forwarded to the DO with `x-user-id` / `x-room-type` headers.
3. **Hooks invalidate on events** — roadmap:
   [`useRoadmapDataSync.ts`](../../web/src/hooks/useRoadmapDataSync.ts) /
   `useRoadmapCollaboration.ts` (peer cursor/typing/drag relayed by the DO); chat:
   [`useChatRealtime.ts`](../../web/src/hooks/useChatRealtime.ts) subscribes the single
   `user:{userId}` inbox.

## Events

| Event | Room | Payload | Consumer |
| --- | --- | --- | --- |
| `data_changed` | `roadmap:{id}` | `{ from }` | Roadmap refetch (React Query invalidation) |
| `chat` | `user:{userId}` | `{ kind, roomId, projectId }` | Chat cache invalidation |
| `ai_trace_event` | `user:{id}` | trace event | Live AI trace accelerator |
| cursor / typing / node_drag | `roadmap:{id}` | peer state | Collaborative canvas presence |

## Feature flags & dormancy

| Flag | Where | Default | Effect |
| --- | --- | --- | --- |
| `realtimeRoadmapTransport` | `web/src/config/featureFlags.ts` | `durable-objects` | Falls back to Supabase Realtime when `VITE_REALTIME_URL` is unset |
| `realtimeChatTransport` | same | `durable-objects` | Same fallback |
| `realtimeCursors` | same | `true` | Gates high-frequency cursor broadcasts |
| `realtimeAiTracePush` | web + agent | `true` | AI trace push (accelerator only) |

The DO transport is **shipped but dormant** unless both sides are configured:
`VITE_REALTIME_URL` (web) and `REALTIME_WORKER_URL` + `REALTIME_PUBLISH_TOKEN`
(backend/agent). Until then, realtime falls back to legacy Supabase Realtime — so
turning it on is a config change, not a code change.

## See also

- [durable-objects.md](./durable-objects.md) — the Worker + room model.
- [Feature Domains → chat](../11-domains/chat.md) — the biggest realtime consumer.
