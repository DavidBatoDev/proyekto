# Realtime

> **Last updated:** 2026-07-09 · **Status:** current

Collaborative realtime — the roadmap canvas and chat — runs on a **Cloudflare Worker
+ Durable Objects** service (`realtime/`), replacing Supabase Realtime. The backend
publishes events to the Worker; the Worker fans them out over WebSockets to connected
clients. It's **shipped dormant** behind transport flags, so activation is a config
change.

> If you only read one page, read [transport-and-events.md](./transport-and-events.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [durable-objects.md](./durable-objects.md) | The Worker, the per-room Durable Object model, room keys, config |
| [transport-and-events.md](./transport-and-events.md) | Publish/subscribe paths, the event catalog, feature flags & dormancy |

## Glossary

| Term | Meaning |
| --- | --- |
| **Room key** | A channel id like `roadmap:{id}` or `user:{userId}`; one Durable Object per key. |
| **Durable Object** | A stateful Cloudflare primitive holding a room's live WebSocket connections. |
| **Publish** | Backend/agent → `POST {WORKER}/publish` with a shared token → routed to the room's DO. |
| **Ship-dark / dormant** | Deployed but a no-op until `REALTIME_WORKER_URL`/`VITE_REALTIME_URL` are configured. |
| **Fallback** | With realtime unconfigured, the web uses legacy Supabase Realtime. |

## Code locations

- **Worker:** [`realtime/`](../../realtime/) (`src/index.ts`, `src/room.ts`, `src/types.ts`), [`realtime/wrangler.toml`](../../realtime/wrangler.toml)
- **Backend:** [`backend/src/modules/realtime/`](../../backend/src/modules/realtime/) (publisher + authorize controller)
- **Web:** [`web/src/lib/realtime.ts`](../../web/src/lib/realtime.ts), [`web/src/config/featureFlags.ts`](../../web/src/config/featureFlags.ts)
- **Deploy:** [`.github/workflows/realtime-deploy.yml`](../../.github/workflows/realtime-deploy.yml)
