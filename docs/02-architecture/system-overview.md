# System Overview

> **Last updated:** 2026-07-09 · **Status:** current

Proyekto is a **six-unit system**: a React web app (also packaged as a mobile app),
a NestJS API, a Python AI agent, a Cloudflare realtime Worker, a Supabase Postgres
database, and Terraform-managed infrastructure. The web app is the only thing users
touch; everything else is a backend service it talks to over HTTP or WebSocket.

> **In one line:** the **web** SPA calls the **backend** for all CRUD and the
> **agent** directly for roadmap AI; the **agent** calls back into the backend to
> read context and commit edits; the **backend** owns writes to **Supabase** and
> publishes live events to the **realtime** Worker, which fans them out to browsers.

## The six deployable units

| Unit | Stack | Entry point | Runs on |
| --- | --- | --- | --- |
| **web** | React 19 + Vite, TanStack Router/Query/Table, MUI + Tailwind, Zustand, Lexical, XYFlow/dagre; Capacitor for Android/iOS | `web/src/main.tsx` | Vercel (`www.proyekto.tech`) + mobile bundles |
| **backend** | NestJS 11 (TypeScript) | `backend/src/server.ts` → `main.ts` | Cloud Run (`api.proyekto.tech`) |
| **agent** | Python 3.12 FastAPI, LangChain/LangGraph + OpenAI Responses API | `agent/run.py` → `app.main:app` | Cloud Run |
| **realtime** | Cloudflare Worker + Durable Objects (SQLite-backed), R2 bindings | `realtime/src/index.ts` | Cloudflare Workers (`proyekto-realtime`) |
| **supabase** | Postgres 15 migrations + Deno edge functions | `supabase/migrations/`, `supabase/functions/` | Supabase (managed, Singapore) |
| **infra** | Terraform (Supabase provisioning + Cloudflare) | `infra/environments/{dev,prod}/` | n/a (provisioning) |

Two shared backing services sit behind these: **Upstash Redis** (agent session
store, backend throttler + data cache) and **Cloudflare R2** (all file storage —
buckets `proyekto-media` and `proyekto-private`). Deep dives:
[deploy-topology.md](./deploy-topology.md) for where each runs,
[cross-service-flows.md](./cross-service-flows.md) for how a request moves through them.

## How the units connect

```
  Clients:  Browser  /  Android · iOS (Capacitor)
                        │
                        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  web — React 19 + Vite SPA           Vercel · www.proyekto.tech │
  └──┬──────────────────┬───────────────────────────┬─────────────┘
     │ REST  /api        │ REST  /agent               │ WebSocket  /ws
     ▼                   ▼                            ▼
 ┌─────────────┐     ┌─────────────┐            ┌────────────────────┐
 │ backend     │ ctx │ agent       │            │ realtime           │
 │ NestJS      │◄────│ FastAPI     │            │ CF Worker + DO     │
 │ Cloud Run   │────►│ Cloud Run   │            │ proyekto-realtime  │
 │ api.proyekto│ +   └──────┬──────┘            └─────────┬──────────┘
 └──┬───────┬──┘ commit     │ session state               ▲  fan-out
    │       │               │                             │  to sockets
    │ service│              ▼                             │
    │ role   │        ┌──────────────┐   publish events   │
    ▼        └───────►│ Upstash Redis│◄───────────────────┘
 ┌────────────┐       │ sessions +   │   (backend & agent POST
 │ Supabase   │       │ cache        │    /publish to the Worker)
 │ Postgres SG│       └──────────────┘
 └────────────┘
```

### The edges that matter

| Edge | Protocol | What flows | Notes |
| --- | --- | --- | --- |
| web → backend | HTTPS REST `/api/*` | All CRUD, auth, chat, meetings, roadmap persistence | Supabase JWT (`Authorization: Bearer`) or `x-guest-user-id` |
| web → agent | HTTPS REST `/agent/*` | Roadmap AI chat/edit messages, trace polling | **Direct** — not proxied through the backend |
| agent → backend | HTTPS REST `/api/roadmaps/:id/ai/*` | Reads roadmap context; commits staged operations | HTTP callback; forwards the caller's auth header |
| backend → Supabase | Postgres (service role) | All authoritative writes/reads | RLS is defense-in-depth; the service layer authorizes |
| agent → Redis | Upstash REST | Session state (pending plan, undo log, summary) | Compare-and-set; TTL-touched on read |
| backend/agent → realtime | HTTPS `POST /publish` | Roadmap/chat/AI-trace events | Fire-and-forget; **dormant unless configured** |
| realtime → web | WebSocket | Live `data_changed` / `chat` / peer events | One Durable Object per room key |
| Cloud Scheduler → backend | HTTPS `POST /api/meetings/cron/reminders` | Reminder heartbeat (serverless has no cron) | Shared-secret guarded |

## Repository layout

| Path | What it is |
| --- | --- |
| [`web/`](../../web/) | The React SPA + Capacitor mobile shells |
| [`backend/`](../../backend/) | NestJS API; feature modules under `backend/src/modules/` |
| [`agent/`](../../agent/) | Python FastAPI AI agent; v2 loop under `agent/app/core/v2/` |
| [`realtime/`](../../realtime/) | Cloudflare Worker + Durable Objects |
| [`supabase/`](../../supabase/) | Migrations (schema source of truth) + edge functions |
| [`infra/`](../../infra/) | Terraform for Supabase + Cloudflare |
| [`scripts/`](../../scripts/) | Node benchmarks, agent test wrapper, storage migration |
| [`schemas/`](../../schemas/) | Shared backend↔agent contract (`roadmap-ai-operations.json`) |

## See also

- [deploy-topology.md](./deploy-topology.md) — where each unit is hosted and how it ships.
- [cross-service-flows.md](./cross-service-flows.md) — end-to-end request lifecycles.
- Per-unit deep dives: [Backend](../03-backend/README.md), [Web](../04-web/README.md),
  [Agent & Roadmap AI](../05-agent-ai/README.md), [Realtime](../06-realtime/README.md).
