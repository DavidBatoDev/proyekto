# Architecture

> **Last updated:** 2026-07-09 · **Status:** current

How Proyekto is put together across its six deployable units, where each one runs,
and how a request flows across service boundaries. Start here for the big picture,
then drop into a per-unit section ([Backend](../03-backend/README.md),
[Web](../04-web/README.md), [Agent](../05-agent-ai/README.md),
[Realtime](../06-realtime/README.md)) for depth.

> If you only read one page, read [system-overview.md](./system-overview.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [system-overview.md](./system-overview.md) | The six deployable units, the edges that connect them, and the repo layout |
| [deploy-topology.md](./deploy-topology.md) | Where each unit is hosted (Cloud Run / Vercel / Cloudflare / Supabase), how it ships, domains, config |
| [cross-service-flows.md](./cross-service-flows.md) | End-to-end request lifecycles: roadmap AI edit, meetings, realtime/chat |

## Glossary

| Term | Meaning |
| --- | --- |
| **Deployable unit** | An independently built and deployed part of the system: web, backend, agent, realtime, supabase, infra. |
| **Service role** | The Supabase key the backend runs as; it bypasses RLS, so authorization happens in the service layer. |
| **Lean diff** | The `include_roadmap: false` commit path — the backend returns a fresh revision token instead of the full roadmap, to cut AI-edit latency. |
| **Room key** | A realtime channel identifier like `roadmap:{id}` or `user:{userId}`; one Durable Object instance per key. |
| **Dormant / ship dark** | Code that is deployed but a runtime no-op until its env/flags are configured (the realtime transport, OTA, FCM). |

## Code locations

- **CI/CD:** [`.github/workflows/`](../../.github/workflows/) — `backend-deploy.yml`, `agent-deploy.yml`, `realtime-deploy.yml`, `android-release.yml`, `mobile-ota-deploy.yml`
- **Container builds:** [`backend/Dockerfile`](../../backend/Dockerfile), [`agent/Dockerfile`](../../agent/Dockerfile)
- **Worker config:** [`realtime/wrangler.toml`](../../realtime/wrangler.toml)
- **Shared contract:** [`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json)
