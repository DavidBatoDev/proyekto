---
name: api-contract
description: End-to-end workflow for changing the roadmap-ai-operations shared contract between backend and agent. Use whenever roadmap operation shapes change (new op, new field, changed semantics).
---

# Skill: API Contract Change (roadmap-ai-operations)

The contract lives at `schemas/roadmap-ai-operations.json` plus its JSON-Schema sibling `schemas/roadmap-ai-operations.schema.json`. It is consumed by NestJS validation (backend), the Python agent's tool layer, and indirectly by web's optimistic UI handlers. Current operation types: add_epic, add_feature, add_task, add_milestone, update_node, move_node, delete_node, mark_status, shift_dates.

## Change checklist (in order)

1. **Schema first**: edit BOTH `schemas/roadmap-ai-operations.json` and `schemas/roadmap-ai-operations.schema.json` coherently.
2. **Backend consumers**: operation validation and application logic in `backend/src/modules/roadmaps/` (roadmap-ai services + `patch/` JSON-patch machinery).
3. **Agent consumers**: `agent/app/core/v2/tools_spec.py` + `tools_exec.py`; if the op's *semantics* change (not just shape), also update `agent/app/core/v2/prompts/system_v2.md`.
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
