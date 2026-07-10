# Agent & Roadmap AI

> **Last updated:** 2026-07-09 · **Status:** current

The Python FastAPI agent that powers conversational roadmap editing. It has a single
brain — a tool-calling loop over one OpenAI model — that reads roadmap context
through the backend and produces edit operations conforming to a shared contract. The
web app calls it directly; it calls back into the backend to commit.

> If you only read one page, read [v2-loop.md](./v2-loop.md). For how it fits the
> whole system, see
> [Architecture → cross-service flows](../02-architecture/cross-service-flows.md#flow-1--roadmap-ai-edit).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [v2-loop.md](./v2-loop.md) | The single tool-calling loop — turns, tools, response modes, the model |
| [memory.md](./memory.md) | Redis session state, the durable Postgres snapshot, the summarizer, roadmap memories |
| [operations-schema.md](./operations-schema.md) | The shared backend↔agent operations contract and its parity checker |
| [json-editing.md](./json-editing.md) | Manual JSON dev-mode editing (`/roadmaps/full`, JSON patch) |
| [setup-and-deploy.md](./setup-and-deploy.md) | Running locally, config knobs, deploy, testing |

## Glossary

| Term | Meaning |
| --- | --- |
| **v2 loop** | The single tool-calling loop in `agent/app/core/v2/` — the only roadmap-AI brain. |
| **Terminal tool** | A tool that ends the turn (`plan_roadmap_operations`, `propose_plan`, `ask_user`, `revert_changes`). |
| **response_mode** | The outcome of a turn — `chat`, `edit_plan`, or `plan_proposal`. |
| **Staging** | Operations are staged on the session, then auto-committed through the backend. |
| **Lean diff** | The `include_roadmap: false` commit path that returns a revision token, not the full roadmap. |
| **Roadmap memory** | A durable per-roadmap preference in `roadmap_ai_memories`, shared across collaborators. |

## Code locations

- **The loop:** [`agent/app/core/v2/`](../../agent/app/core/v2/)
- **Orchestration:** [`agent/app/core/orchestration/agent_service.py`](../../agent/app/core/orchestration/agent_service.py) (`plan_message`)
- **Session store:** [`agent/app/core/session_store.py`](../../agent/app/core/session_store.py)
- **Backend callback client:** [`agent/app/core/nest_client.py`](../../agent/app/core/nest_client.py)
- **Shared contract:** [`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json)
- **Backend AI endpoints:** [`backend/src/modules/roadmaps/controllers/roadmap-ai.controller.ts`](../../backend/src/modules/roadmaps/controllers/roadmap-ai.controller.ts)
