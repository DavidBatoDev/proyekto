# The v2 Loop

> **Last updated:** 2026-07-09 · **Status:** current

The agent has **one brain**: a single tool-calling loop in
[`agent/app/core/v2/`](../../agent/app/core/v2/) driven by one model over the OpenAI
**Responses API**. There is no v1/v2 flag matrix and no separate classifier —
`AgentService.plan_message` always runs the v2 loop. The model calls read tools to
gather context (in parallel), then ends the turn with one **terminal** tool that
decides what happens: chat, propose a plan, ask a question, apply edits, or revert.

> The loop's job each turn: understand the ask, read only what it needs, and land on
> exactly one terminal action. Edits are **staged**, then auto-committed through the
> backend (see [Architecture → cross-service flows](../02-architecture/cross-service-flows.md#flow-1--roadmap-ai-edit)).

## The loop at a glance

```
 user turn ─► build context (system prompt + state header + trimmed history)
                │
                ▼
        ┌─►  call model (Responses API, tools=auto)
        │        │
        │        ├─ read/memory tool calls?  ──► run in PARALLEL ──┐
        │        │                                                 │ feed results back
        │        └─ terminal tool call?                            │
        │             plan_roadmap_operations / propose_plan /     │
        │             ask_user / revert_changes  ──► END turn ◄────┘
        └───────────────────────────────────────────────
                │
                ▼
        map LoopResult → response_mode  (chat | edit_plan | plan_proposal)
```

Budget guards: **`AGENT_V2_MAX_TURNS`** (default 8, clamped 1–16) and
**`AGENT_V2_MAX_TOOL_CALLS`** (default 24, clamped 1–60). Exhausting either ends the
turn with a clarifier explaining the budget stop.

## The model

- **`OPENAI_MODEL_V2`** (default `gpt-5.4-mini`) — one model for the entire loop, via
  the OpenAI **Responses API** (`/v1/responses`, `tool_choice=auto`, `store=false`).
- **Reasoning effort** starts at `OPENAI_V2_REASONING_EFFORT` (default `low`) and
  escalates to **medium** on a "hard turn" (a plan is pending, a reference is
  ambiguous, or the user asked to draft a plan). It never downgrades below the base.
- **Streaming** (`OPENAI_V2_STREAMING_ENABLED`, default on) emits `assistant_delta`
  trace events; optional reasoning summaries (`..._REASONING_SUMMARY_ENABLED`, default
  off) emit `assistant_thought`. The client self-heals — if the provider rejects
  streaming or reasoning, it drops that feature once and remembers for the process.

## Tools

Read/context and edit tools are reused verbatim from the shared tool registry so the
operation schema stays in lockstep with the Pydantic model.

**Read / context (non-terminal, run in parallel):** `resolve_node_reference` (the
primary "which node did the user mean" lookup), `search_nodes`, `search_tasks`,
`get_roadmap_summary`, `get_roadmap_overview`, `get_node_details`,
`get_features_by_epic`, `get_feature_details`, `get_epics_by_roadmap`,
`get_epic_progress`, `list_members` (call before assigning by name),
`get_tasks_assigned_to_me`, `get_tasks_by_status`, `get_tasks_by_parent`,
`get_overdue_tasks`, `get_blocked_items`. Each read fetches through the backend
context endpoints; `roadmap_id` is force-injected so the model can't scope-escape.

**Memory (non-terminal, write):** `save_memory`, `forget_memory` — durable per-roadmap
preferences (see [memory.md](./memory.md)).

**Terminal (each ends the turn):**

| Tool | Ends the turn by… | → response_mode |
| --- | --- | --- |
| `plan_roadmap_operations` | Emitting `operations[]` (roadmap edits) | `edit_plan` → auto-commit |
| `propose_plan` | Presenting a titles-only plan for confirmation | `plan_proposal` |
| `ask_user` | Asking 1–4 clarifier questions with clickable options | `chat` (clarifier card) |
| `revert_changes` | Deterministically undoing committed changes | `edit_plan` (inverse ops) |

A parse/contract failure on `plan_roadmap_operations` is **not** terminal — the error
is fed back into the same loop so the model self-corrects.

## Response modes

`terminal.py` maps the finished loop to a `MessagePlanningOutcome`:

- **chat** — plain answer (no edits). If reads were used it's a grounded
  `context_answer`; a bare options-question is nudged into a proper `ask_user`.
- **edit_plan** — the model produced kept operations; they're **staged** onto the
  session, and the message route auto-commits them through
  `POST /roadmaps/:id/ai/commit` (lean diff). Inline by default; backgrounded when
  `AGENT_ASYNC_AUTO_COMMIT_ENABLED` is set.
- **plan_proposal** — a structured plan is recorded as pending; a follow-up
  confirmation turns it into edits (dual-target contract).

## Files in `agent/app/core/v2/`

| File | Role |
| --- | --- |
| `brain.py` | `run_v2_message` — the entrypoint `AgentService.plan_message` calls |
| `loop.py` | `run_loop` — the agentic tool-calling loop and terminal dispatch |
| `context.py` | Builds the OpenAI `messages` (system prompt + state header + history) |
| `tools_spec.py` | Tool catalog + terminal/dispatcher classification |
| `tools_exec.py` | Runs read tools; parses + contract-validates the edit tool call |
| `openai_client.py` | Responses API wrapper (streaming, reasoning, self-heal) |
| `staging.py` | Stages produced operations onto the session |
| `revert.py` | Deterministic point-in-time revert (no LLM) |
| `summarizer.py` | Rolling conversation compaction — see [memory.md](./memory.md) |
| `terminal.py` | Maps `LoopResult` → outcome + side effects |
| `progress.py` | Progress trace events + delta/thought emitters |
| `sentinels.py` | Folds web card-interaction sentinels into the user turn |
| `prompts/system_v2.md` | The system prompt |

## See also

- [memory.md](./memory.md) · [operations-schema.md](./operations-schema.md)
  · [json-editing.md](./json-editing.md) · [setup-and-deploy.md](./setup-and-deploy.md)
- The tunables above and their defaults are in [setup-and-deploy.md](./setup-and-deploy.md#configuration).
