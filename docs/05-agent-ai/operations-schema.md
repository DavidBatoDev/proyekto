# The Operations Schema

> **Last updated:** 2026-09-06 · **Status:** current

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

The model's terminal `stage_edits` call (the wire name; the registry still exports the
schema under the `PLANNING_TOOL_NAME` constant `plan_roadmap_operations`, which the
schema gate reads) carries an `assistant_message`, a `roadmap_id`, and an `operations[]`
array. Revisions to a pending proposal go through the separate `revise_proposal` tool
(`revision_operations[]`). Each entry in `operations` is one operation.

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

## `update_node` patch fields

The manifest's `update_node_patch_fields` matrix is the per-node-type allowlist. The
backend's `allowedPatchFields` switch mirrors it - a patch key outside the list fails
the whole batch with an `OUT_OF_SCOPE_MUTATION` issue - and the agent's stage-time
guard (`tool_exec.py`) refuses the same key earlier with a per-field hint. The parity
checker parses the backend switch and compares it against the manifest.

| Node type | Allowed `patch` keys |
| --- | --- |
| `roadmap` | `name`, `description`, `status`, `start_date`, `end_date`, `settings` |
| `epic` | `title`, `description`, `status`, `priority`, `color`, `start_date`, `end_date`, `tags` |
| `feature` | `title`, `description`, `is_deliverable`, `start_date`, `end_date` (no `status` - it is derived from child tasks) |
| `task` | `title`, `description`, `status`, `priority`, `assignee_id`, `assignee_ids`, `due_date` |
| `milestone` | `title`, `description`, `status`, `target_date`, `completed_date`, `color` |

## Task assignees

Tasks are the only node type with assignees, and a task can have several: the join
table `roadmap_task_assignees` holds the set and the legacy `roadmap_tasks.assignee_id`
column is the **primary** (the first join row). Every layer of the AI edit path -
contract, backend service, `upsert_full_roadmap`, agent, web optimistic apply - follows
the same rules, copied from the direct task-write path
(`tasks.repository.supabase.ts` `resolveAssigneeIds`):

| Rule | Meaning |
| --- | --- |
| `assignee_ids: string[]` | The canonical field: the **full replacement set** of user ids. `[]` unassigns everyone. |
| `assignee_ids: null` | **Assignment unchanged.** A `null` (in `patch.assignee_ids` or `add_task` `data.assignee_ids`) is treated as if the key were absent - only `[]` unassigns. Every layer agrees: the agent normalizer drops a `null` before staging and the tool schema types the field as a plain `array` (not nullable), the backend reads `null` as missing, the RPC sends a null / non-array value down its scalar branch, and the web optimistic apply skips it. |
| `assignee_id: string \| null` | Legacy scalar alias, still accepted: `X` means `[X]`, `null` means `[]`. |
| Precedence | `assignee_ids` wins whenever it is present as an array; only when it is absent (or `null`) is `assignee_id` read. |
| Mirror rule | `assignee_id === assignee_ids[0] ?? null` wherever both are written - the backend normalizes and writes both, and the RPC derives the column from the set. |
| Order and dedupe | Ids are deduped preserving order; the first id is the primary assignee. |
| Scope | `update_node` `patch` on a task, and `add_task` `data` (`data.assignee_ids`, or `data.assignee_id` as the single-id alias). `assignee_ids` on an epic, feature, or milestone is `OUT_OF_SCOPE_MUTATION`. Feature teams (`roadmap_feature_assignees`) are outside the contract. |

The `"me"` sentinel (and `myself`, `self`, `current user`, `current_user`) is an
**agent-side** concept. `tool_exec.py` substitutes the actor id inside
`patch.assignee_ids` elements, `patch.assignee_id`, and `add_task` `data.assignee_ids` /
`data.assignee_id` before the batch reaches the backend, and drops the duplicates the
substitution can create. The backend never accepts `"me"`: `assignee_ids` must be an
array of UUID strings and `assignee_id` a UUID or null; anything else is a validation
issue at `operations/<i>/patch/assignee_ids` (`INVALID_FIELD_VALUE`).

Downstream of validation:

- The semantic diff emits `ASSIGNEE_CHANGED` when the **ordered** id lists differ (a
  co-assignee-only change counts), with `from` / `to` carrying both `assignee_id` and
  `assignee_ids`; the agent's applied-changes log renders the set from `assignee_ids`.
- `POST /roadmaps/:id/ai/commit` calls `upsert_full_roadmap` with the caller as
  `p_actor_id`; the RPC reconciles `roadmap_task_assignees` to the set and keeps
  `roadmap_tasks.assignee_id` on the first id (see
  [Data -> schema overview](../07-data-and-db/schema-overview.md#key-rpcs)).
- Undo (`revert_changes`) restores the whole set from the snapshot's `assigneeIds`.
- Users who gained an assignment are notified the same way a `PATCH /tasks/:id`
  assignment notifies them; a notification failure never fails the commit.

### Which reads return the set

Every task-list read returns `assignee_id` (the stored primary) **and** `assignee_ids`
(the full set, primary first), so the model can build a union ("also assign X") or a
removal from what a read just returned. Keyword search is the one exception.

| Agent tool | Backend read | Assignees in the response |
| --- | --- | --- |
| `get_node_details` | `GET /roadmaps/:id/ai/context/nodes/:nodeId` | `assignee_id`, `assignee_ids`, plus `assignees` (id + display name where the profile is known) on a task |
| `get_tasks_by_parent`, `get_tasks_by_status` (both walk `context/features` + the children read). `get_children`, `get_tasks_by_feature` and `get_tasks_by_epic` share that handler and pass the set through too, but they are dispatch-only names with no model-facing spec in `registry.get_context_tools()`, so the prompt never names them | `GET .../context/nodes/:nodeId/children` (task rows under a feature) | `assignee_id`, `assignee_ids` |
| `get_overdue_tasks` | The children walk, then `GET .../context/nodes/:nodeId` per task | `assignee_id`, `assignee_ids` copied from each task's details |
| `get_tasks_assigned_to_me` | `GET .../context/tasks-assigned-to-me` | `assignee_id`, `assignee_ids`; matches primary **or** co-assignee |
| - | `GET .../context/tasks?assignee_id=...` (filtered list) | `assignee_id`, `assignee_ids`; the filter matches the full set |
| `list_my_tasks` (workspace scope) | `GET /ai/context/tasks` (`ai_context_list_tasks`) | `assignee_ids`, primary first |
| `search_tasks`, `search_nodes`, `search_everything` | `GET .../context/search`, `GET /ai/context/search` | **Not included.** `RoadmapAiContextSearchMatchDto` is contract-checked and frozen, the `search_tasks` description says so, and the model follows a hit with `get_node_details` before changing an assignment |

> **Rollout order is fixed** because the contract has no version field: apply the
> `20260906090000_upsert_full_roadmap_task_assignees.sql` migration, deploy the
> backend, then the agent, then the web. The multi-assignee change (2026-09-06) lives
> in the working tree; check the deploy log before treating it as live in production.

## Validated on both sides

| Side | How |
| --- | --- |
| **Agent (Python)** | `RoadmapOperation.model_validate` + `validate_operation_contract` (semantic checks — e.g. `mark_status.status_invalid`, `update_node.mutation_missing`, `shift_dates.delta_days_out_of_range`). The runtime tool schema's per-op `anyOf` branches are generated from the Pydantic model. |
| **Agent tests** | [`agent/tests/test_operation_contracts.py`](../../agent/tests/test_operation_contracts.py) — contract + handle-expansion tests, run via the Node wrapper. |
| **Backend (NestJS)** | DTO union types in [`roadmap-ai.dto.ts`](../../backend/src/modules/execution/roadmaps/dto/roadmap-ai.dto.ts) (`RoadmapAiOperationType`, `RoadmapNodeType`, `RoadmapAiOperationDto`). |

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
