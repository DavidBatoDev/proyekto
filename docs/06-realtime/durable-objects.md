# Durable Objects

> **Last updated:** 2026-07-09 · **Status:** current

Realtime is a **Cloudflare Worker** (`proyekto-realtime`) backed by **Durable
Objects** — one DO instance per "room", each holding the live WebSocket connections
for that room and fanning out events to them. It replaces Supabase Realtime for the
roadmap canvas and chat, and it's shipped **dormant** behind transport flags.

> One Durable Object per room key. The Worker routes a publish or a socket upgrade to
> the right DO by `env.ROOMS.idFromName(roomKey)`; the DO owns the sockets and does
> the broadcast.

## The Worker

Configured in [`realtime/wrangler.toml`](../../realtime/wrangler.toml):

- Worker `proyekto-realtime`, entry `src/index.ts`, `compatibility_date = 2025-06-01`.
- **Durable Object** binding `ROOMS` → class `RealtimeRoom` (SQLite-backed migration).
- **R2 bindings** `MEDIA` / `PRIVATE` (the Worker also carries file uploads — see
  [Storage & Media](../08-storage-media/README.md)).
- **Vars:** `BACKEND_AUTHORIZE_URL = https://api.proyekto.tech/api/realtime/authorize`,
  `ALLOWED_ORIGINS`, `R2_PUBLIC_BASE_URL`.
- **Secrets** (via `wrangler secret put`): `SUPABASE_JWT_SECRET`, `SUPABASE_URL`
  (JWKS), `REALTIME_PUBLISH_TOKEN`.
- Served on `proyekto-realtime.…workers.dev` (no custom domain). Deployed by
  `.github/workflows/realtime-deploy.yml` on `realtime/**` pushes.

## Room keys

A room key namespaces a channel; each maps to one DO instance:

| Key | For |
| --- | --- |
| `roadmap:{id}` | A roadmap canvas — `data_changed` + peer cursor/typing/drag events |
| `user:{userId}` | A user's personal inbox — `chat` events, `ai_trace_event` |
| `chatroom:{id}` | (Where used) a specific chat room |

`user:` rooms are **self-scoped** (you can only join your own); other rooms are
authorized against the backend (see [transport-and-events.md](./transport-and-events.md)).

## The room object

[`realtime/src/room.ts`](../../realtime/src/room.ts) `RealtimeRoom`:

- Uses the **WebSocket Hibernation API** — the DO can evict from memory between
  messages and rehydrate, so idle rooms cost nothing.
- `fetch('/publish')` → `broadcast(event, payload)` iterates `state.getWebSockets()`
  and `ws.send({ event, payload })`.
- `webSocketMessage` relays peer events (cursor / typing / node-drag) among the
  connected sockets for collaborative editing.

## Files

| File | Role |
| --- | --- |
| [`realtime/src/index.ts`](../../realtime/src/index.ts) | Worker entry — `/publish`, `/ws` upgrade, `/uploads`, auth, routing |
| [`realtime/src/room.ts`](../../realtime/src/room.ts) | The `RealtimeRoom` Durable Object |
| [`realtime/src/types.ts`](../../realtime/src/types.ts) | `Env` bindings + message types |

## See also

- [transport-and-events.md](./transport-and-events.md) — the publish/subscribe paths and flags.
- [Architecture → cross-service flows](../02-architecture/cross-service-flows.md#flow-3--realtime--chat).
