# Agent & Roadmap AI

> **Last updated:** 2026-09-05 · **Status:** current

The Python FastAPI agent that powers the Proyekto assistant in two places: the
in-roadmap panel (a session focused on one roadmap) and the dashboard assistant (a
session focused on a workspace). Every message is a **run** the agent orchestrates
through investigate -> propose -> execute -> verify over one tool-calling loop engine
and one model. The agent reads context through the backend as the user, commits one
batch per roadmap through the backend, and persists run state in Upstash Redis so any
instance can continue any run. The web talks to it directly.

> If you only read one page, read [runs-and-phases.md](./runs-and-phases.md). For how
> it fits the whole system, see
> [Architecture -> cross-service flows](../02-architecture/cross-service-flows.md#flow-1--roadmap-ai-edit).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [runs-and-phases.md](./runs-and-phases.md) | The run state machine - endpoints, input and transition tables, checkpoint policy, phases, tool catalog, refs, prompt cache, budgets, legacy sync mode, error codes, trace events, the `logs.txt` block |
| [memory.md](./memory.md) | The Redis session document (scope, owner, run), the trace store keys, the durable snapshot ladder, the summarizer, roadmap memories |
| [operations-schema.md](./operations-schema.md) | The shared backend/agent operations contract and its parity checker |
| [json-editing.md](./json-editing.md) | Manual JSON dev-mode editing (`/roadmaps/full`, JSON patch) |
| [setup-and-deploy.md](./setup-and-deploy.md) | Running locally, every tunable with its default, deploy, testing |

## Glossary

| Term | Meaning |
| --- | --- |
| **Run** | The server-side state machine one user message drives: `investigate -> propose -> await_user -> execute -> verify -> done \| failed \| cancelled`. Lives in `metadata.run`. |
| **Step** | One HTTP request's worth of a run (`POST .../messages` or `POST .../runs/{run_id}/continue`), bounded by the soft (90s) and hard (165s) budgets. |
| **Segment** | One trace's worth of a run: a user send or a checkpoint answer mints a trace; continues reuse it. |
| **Phase** | `investigate` (read + decide), `propose` (record a proposal, no model call), `execute` (one commit per roadmap), `verify` (checks + report). |
| **Checkpoint** | A run paused for the user: `clarifier` (an `ask_user` card) or `proposal` (a plan or an edits batch awaiting confirmation). |
| **Scope** | `{kind:"roadmap", roadmap_id}` or `{kind:"workspace", workspace_id}` - what a session focuses on; also the prompt-cache key. |
| **Focus roadmap** | The scope roadmap in roadmap scope (bare `E1` handles); none in workspace scope. |
| **Handle** | `E1` / `E1.F2` / `M1` for the focus roadmap, `R2.E1`-style for every other loaded roadmap; expanded to uuids at parse time. |
| **Batch** | One roadmap's worth of staged operations inside a run (`RunBatch`); a multi-roadmap `stage_edits` response is one batch per roadmap. |
| **Commit** | The progress record of one batch's `POST /roadmaps/:id/ai/commit` (`RunCommit`: own idempotency key, status `pending \| committed \| failed \| skipped`). |
| **Checkpoint policy** | The rule that decides whether `stage_edits` batches execute immediately or become a proposal: focus roadmap up to 90 ops (deletes included); workspace scope up to 15 ops, no deletes; anything multi-roadmap or non-focus proposes. |
| **Terminal tool** | A tool that ends a loop turn: `stage_edits`, `propose`, `revise_proposal`, `ask_user`, `revert_changes`. |
| **Ref** | A composer `@`-mention (`{kind, id, label}`) hydrated once per run; a hint about what the user means, never a restriction. |
| **Legacy sync mode** | A `/messages` call without `capabilities: ["continue"]`: the whole run happens in one request, batches that do not fit are skipped. Kept one release for old bundles. |
| **Lean diff** | The `include_roadmap: false` commit path that returns a fresh revision token instead of the full roadmap. |
| **Roadmap memory** | A durable per-roadmap preference in `roadmap_ai_memories`, shared across collaborators. |

## Code locations

- **Runtime (orchestrator, phases, tools, prompt):** [`agent/app/core/runtime/`](../../agent/app/core/runtime/)
- **Loop engine:** [`agent/app/core/engine/`](../../agent/app/core/engine/)
- **Contracts:** [`agent/app/core/contracts/sessions.py`](../../agent/app/core/contracts/sessions.py), [`runs.py`](../../agent/app/core/contracts/runs.py)
- **Routes:** [`agent/app/api/routes/sessions.py`](../../agent/app/api/routes/sessions.py) + [`sessions_support/flows.py`](../../agent/app/api/routes/sessions_support/flows.py)
- **Session store / trace store:** [`agent/app/core/session_store.py`](../../agent/app/core/session_store.py), [`agent/app/core/trace/store.py`](../../agent/app/core/trace/store.py)
- **Backend callback client:** [`agent/app/core/nest_client.py`](../../agent/app/core/nest_client.py)
- **Shared contract:** [`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json)
- **Backend endpoints the agent calls:** roadmap-keyed [`roadmap-ai.controller.ts`](../../backend/src/modules/execution/roadmaps/controllers/roadmap-ai.controller.ts) (`/roadmaps/:id/ai/*`), user-scoped [`ai-context.controller.ts`](../../backend/src/modules/execution/ai-context/ai-context.controller.ts) (`/ai/context/*`), thread storage [`roadmap-ai-sessions.controller.ts`](../../backend/src/modules/execution/roadmaps/controllers/roadmap-ai-sessions.controller.ts) and [`workspace-ai-sessions.controller.ts`](../../backend/src/modules/execution/roadmaps/controllers/workspace-ai-sessions.controller.ts)
- **Web AI kit:** [`web/src/components/ai/`](../../web/src/components/ai/) (`AiAssistantPanel`, `AiComposer`, `runController.ts`), [`web/src/services/ai-agent.service.ts`](../../web/src/services/ai-agent.service.ts), [`ai-sessions.service.ts`](../../web/src/services/ai-sessions.service.ts); the roadmap wrapper [`RoadmapAiAssistantPanel.tsx`](../../web/src/components/roadmap/ai/RoadmapAiAssistantPanel.tsx) and the dashboard [`DashboardAiPanel.tsx`](../../web/src/components/home/DashboardAiPanel.tsx)
