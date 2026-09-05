---
name: api-contract
description: End-to-end workflow for changing the roadmap-ai-operations shared contract between backend and agent. Use whenever roadmap operation shapes change (new op, new field, changed semantics).
---

# Skill: API Contract Change (roadmap-ai-operations)

The contract lives at `schemas/roadmap-ai-operations.json` plus its JSON-Schema sibling `schemas/roadmap-ai-operations.schema.json`. It is consumed by NestJS validation (backend), the Python agent's tool layer, and indirectly by web's optimistic UI handlers. Current operation types: add_epic, add_feature, add_task, add_milestone, update_node, move_node, delete_node, mark_status, shift_dates.

## Change checklist (in order)

1. **Schema first**: edit BOTH `schemas/roadmap-ai-operations.json` and `schemas/roadmap-ai-operations.schema.json` coherently.
2. **Backend consumers**: operation validation and application logic in `backend/src/modules/execution/roadmaps/` - `services/roadmap-ai.service.ts` (the `allowedPatchFields` switch the checker parses, `applyUpdateNode` / `applyAddTask`, the semantic diff, `validateState`), `services/roadmap-patch.service.ts` + the `patch/` JSON-patch machinery, and `dto/roadmap-ai.dto.ts` for the unions.
3. **Agent consumers**: `agent/app/core/tools/registry.py` (the planning-tool schema the checker spawns the agent to emit, the `patch.properties` overlays, the top-level patch aliases and assignee normalization), `agent/app/core/runtime/tools.py` + `tool_exec.py` (dispatch, the per-node-type patch guard and its hints, self-alias substitution), and `agent/app/core/runtime/operation_contracts.py` (semantic contract checks); if the op's *semantics* change (not just shape), also update `agent/app/core/runtime/prompts/system.md`.
4. **Web consumers**: optimistic UI handlers for the operation (roadmapStore / roadmap services).
5. **Verify**:
   - `cd backend && npm run check:roadmap-ai-schema`
   - `node scripts/test_agent_unit.mjs tests.test_operation_contracts` (repo root)
   - targeted backend spec(s) for the touched services
6. **Before any push**: full canary - `node scripts/validate_agent_canary_matrix.mjs` (non-zero exit = failure).
7. **Rollout note**: backend and agent deploy independently. Either the change is backward-compatible on both sides, or you must state the required deploy order (usually backend before agent). Write this down in the commit/PR description.

## Gotchas

- The agent's Docker image is built from the REPO ROOT specifically so `schemas/` is copied in - never move or rename the directory.
- `MAX_OPERATIONS_PER_REQUEST` (agent config.py) caps operation batches; large new op fan-outs may hit it.
- The strict-mode gate in `scripts/check_roadmap_ai_schema.mjs` forbids `allOf`/`anyOf`/`oneOf`/`if`/`then`/`else` at `operations.items` and at each of its direct properties only, so documenting sub-fields as nested `properties` under `patch` / `data` (as `assignee_ids` is) is safe - keep `patch` and `data` themselves as plain `type: object`.
- Rollout example: a field the backend must accept before the agent sends it (`assignee_ids`, 2026-09-06) deploys backend (with its migration applied) -> agent -> web.
