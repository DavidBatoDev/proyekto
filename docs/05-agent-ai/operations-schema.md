# The Operations Schema

> **Last updated:** 2026-07-09 · **Status:** current

Roadmap edits crossing the agent↔backend boundary conform to a single shared
contract: [`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json).
It's the manifest both sides validate against — the agent produces operations, the
backend applies them — and a checker guarantees the two stay in lockstep. **Change
the operation shape in one place and you must update the schema and re-run the
checker.**

> The schema is a contract manifest that points at the canonical JSON Schema
> (`roadmap-ai-operations.schema.json`); the per-operation branches are *derived*
> from the agent's `RoadmapOperation` Pydantic model, so drift is caught mechanically.

## The envelope

The model's terminal `plan_roadmap_operations` call carries an `assistant_message`
plus an `operations[]` array (and optionally `revision_operations[]` when a plan is
pending, and `clarifier_options[]`). Each entry in `operations` is one operation.

## Operation vocabulary

| Field group | Values |
| --- | --- |
| **operation_types** | `add_epic`, `add_feature`, `add_task`, `add_milestone`, `update_node`, `move_node`, `delete_node`, `mark_status`, `shift_dates` |
| **node_types** | `roadmap`, `epic`, `feature`, `task`, `milestone` |
| **operation_fields** | `op`, `node_type`, `node_id`, `node_ref`, `parent_id`, `parent_ref`, `new_parent_id`, `new_parent_ref`, `temp_id`, `position`, `patch`, `status`, `delta_days`, `scope`, `data`, `targets` |

Nodes are referenced either by a real `node_id` or by a `node_ref` label that the
`resolve_node_reference` tool resolves to an id (the resolver requires `roadmap_id`
and `label`). New nodes use a `temp_id` so later operations in the same batch can
reference them before they have real ids.

## Validated on both sides

| Side | How |
| --- | --- |
| **Agent (Python)** | `RoadmapOperation.model_validate` + `validate_operation_contract` (semantic checks — e.g. `mark_status.status_invalid`, `update_node.mutation_missing`, `shift_dates.delta_days_out_of_range`). The runtime tool schema's per-op `anyOf` branches are generated from the Pydantic model. |
| **Agent tests** | [`agent/tests/test_operation_contracts.py`](../../agent/tests/test_operation_contracts.py) — contract + handle-expansion tests, run via the Node wrapper. |
| **Backend (NestJS)** | DTO union types in [`roadmap-ai.dto.ts`](../../backend/src/modules/roadmaps/dto/roadmap-ai.dto.ts) (`RoadmapAiOperationType`, `RoadmapNodeType`, `RoadmapAiOperationDto`). |

## The parity checker

`scripts/check_roadmap_ai_schema.mjs` (`npm run check:roadmap-ai-schema`, from
`backend/`) asserts the schema, the backend TS unions, and the agent Python enums all
agree — operation types, node types, operation fields, resolver args. It also:

- **Guards strict mode** — the canonical `operations.items` must stay flat (no
  `allOf`/`anyOf`/`oneOf`/`if`), so the provider enforces the op enum at sampling time.
- **Detects runtime drift** — it spawns the agent to emit the live planning-tool
  schema and checks every per-op branch's fields match the Pydantic model (this guard
  exists because a mismatch once caused a multi-minute provider outage).

> **⚠️ When you change an operation:** update
> [`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json)
> **and** the canonical schema, mirror the backend DTO and the Python model, then run
> `npm run check:roadmap-ai-schema`. The checker failing is a release blocker.

## How operations become database writes

The backend receives operations at `POST /roadmaps/:id/ai/commit`, applies them in
memory, validates, computes a semantic diff, and persists the whole tree atomically
via the `upsert_full_roadmap` RPC. That's the same persistence path used by the
manual JSON editor — see [json-editing.md](./json-editing.md) and
[Architecture → cross-service flows](../02-architecture/cross-service-flows.md#flow-1--roadmap-ai-edit).
