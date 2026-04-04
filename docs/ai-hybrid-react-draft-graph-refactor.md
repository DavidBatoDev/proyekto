# AI Refactor Plan: Hybrid ReAct + Draft Graph/Versioning

Owner: Agent Team  
Date: 2026-04-04  
Status: In progress (partial delivery complete)

## Implementation status snapshot (as of 2026-04-04)

Completed in code:

- Draft graph contracts are implemented in session metadata (`DraftNode`, `AppliedDraftCommit`, active draft pointers, draft heads).
- Legacy-to-draft initialization/mirroring exists in orchestration and is wired for route use.
- Planner payload supports Hybrid ReAct metadata (`draft_action`, `tool_plan`, `needs_more_info`, `stop_reason`) with schema guards.
- Retry hardening is implemented with versioned hints, stale checks, bounded retry discovery, and telemetry fields.
- Preview fingerprint binding is implemented and enforced in strict commit mode.
- Draft status transitions (`previewed`, `applied`, `abandoned`) are implemented in session routes.
- Commit now repoints active draft head to the applied draft and abandons descendant drafts when applying a non-active draft preview.

Still open (not complete yet):

- Commit/preview self-heal regeneration paths still exist and need final tightening/removal per strict contract.
- `replace_operations`/legacy staging heuristics are still present in core edit flow.
- Full bounded ReAct loop (turn-by-turn planner/executor budget control across all edit planning) is not yet fully consolidated.
- End-to-end verification is pending in this environment (`pytest` not available in current shell).

## 1) Baseline from current codebase

This plan is based on the current implementation in:

- agent/app/core/orchestration/agent_service.py
- agent/app/api/routes/sessions.py
- agent/app/core/contracts/sessions.py
- agent/app/core/llm/client.py
- agent/app/core/llm/context_tools_executor.py
- agent/app/core/config.py

Current strengths we will preserve:

- Pending edit lifecycle and continuation handling using pending_edit_context.
- Staging versioning via staged_operations_version.
- Retry/autostage stale-hint protection and duplicate operation dedupe.
- Preview/apply safety checks and idempotency guard using applied_preview_ids.
- Bounded tool-turn planning in LLM-first planner and clarifier fallbacks.

Current gaps this refactor addresses:

- Single flat staged operations list cannot represent parallel intents cleanly.
- replace_operations and correction heuristics are overburdened.
- Commit path still contains a permissive self-heal flow (preview regeneration) that can drift from explicit user intent.
- Planner/executor control flow is split across layers, making bounded ReAct behavior less explicit and less observable.

## 2) Target architecture

Implement Hybrid ReAct with deterministic controls:

- LLM proposes intent family, draft action, tool strategy, and candidate operations.
- Deterministic executor runs tools, enforces budget, validates results, and decides whether to continue or clarify.
- Deterministic staging applies ops to a selected draft node with strict dedupe/versioning.
- Preview and commit are hard-bound to a draft snapshot fingerprint.

Add Draft Graph/Versioning:

- Replace one flat session.operations list with draft nodes.
- Support continue, revise, and new_draft explicitly.
- Remove dependence on replace=true heuristics for intent switching and correction flows.

## 3) New domain model

## 3.1 Session metadata additions

Add to SessionMetadata:

- active_draft_id: str | None
- drafts: dict[str, DraftNode]
- draft_head_ids: list[str] (optional, for branching UX)
- applied_draft_commits: list[AppliedDraftCommit]

Add new model:

```python
class DraftNode(BaseModel):
    draft_id: str
    parent_draft_id: str | None = None
    draft_mode: Literal['append', 'revise', 'branch']
    operations: list[RoadmapOperation] = Field(default_factory=list)
    draft_version: int = 0
    base_revision: int | None = None
    revision_token: str | None = None
    created_from_message_id: str | None = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    summary: str | None = None
    status: Literal['active', 'previewed', 'applied', 'abandoned'] = 'active'
```

Optional commit journal model:

```python
class AppliedDraftCommit(BaseModel):
    preview_id: str
    preview_fingerprint: str
    draft_id: str
    draft_version: int
    committed_at: datetime = Field(default_factory=datetime.utcnow)
```

## 3.2 Preview fingerprint contract

Define:

- preview_fingerprint = sha256(draft_id, draft_version, operations, base_revision)

Store:

- On preview creation: store preview_id -> preview_fingerprint binding in session metadata.
- On commit: require exact match between provided preview_id binding and current draft snapshot.

Reject commit if:

- preview_id missing
- preview_id not bound
- bound fingerprint does not match active snapshot
- preview already applied for same draft_id + draft_version

## 3.3 Backward compatibility and migration

Phase A compatibility bridge:

- If session has legacy operations but no drafts:
- Create root draft with draft_mode=append and operations=session.operations.
- Set active_draft_id to root draft.
- Mirror root draft operations back to session.operations temporarily.

Temporary invariants during migration window:

- session.operations == drafts[active_draft_id].operations
- staged_operations_version mirrors active draft_version

## 4) Hybrid ReAct control loop

Per user turn in agent_service orchestration:

1. Intent + continuation gate

- Keep existing roadmap_edit/question/unclear intent lane.
- Add deterministic continuation routing from active_draft_id + pending edit state.

2. Planner step (strict JSON contract)

- LLM output fields:
  - draft_action: continue | revise | new_draft
  - intent_family
  - tool_plan: list[ToolCallPlan]
  - proposed_operations
  - needs_more_info
  - stop_reason

3. Deterministic tool executor

- Execute tool_plan sequentially.
- Enforce tool budget and planner max turns.
- Validate tool args, result shape, node IDs/types/confidence.
- Feed tool results back into planner up to max turns.
- Exit with resolve or clarifier.

4. Deterministic stage and validate

- Resolve selected draft target via policy.
- Apply operations with signature dedupe.
- Increment draft_version on mutation.
- Update mirror legacy fields during compatibility phase.

5. Preview and commit

- Preview binds to active draft snapshot fingerprint.
- Commit requires matching preview fingerprint.
- No silent target switching, no permissive self-heal commit fallback.

## 5) Draft action decision policy

Deterministic post-LLM policy:

- continue:
  - Same objective family and compatible target context.
  - Applies to active draft as append.

- revise:
  - Same objective but correction/replacement of prior staged intent.
  - Creates child draft from active with revised operations, or rewrites active depending on policy flag.

- new_draft:
  - Distinct user objective, explicit start-over language, or incompatible target family.
  - Creates isolated draft node and switches active_draft_id.

If uncertain:

- Return clarifier with explicit options:
  - 1. Append to current draft
  - 2. Revise current draft
  - 3. Start a new draft

## 6) Refactor phases

## Phase A: Data foundation

Scope:

- Add DraftNode contracts to sessions models.
- Add migration adapter from legacy operations to root draft.
- Add metadata fields for draft graph and preview bindings.

Checklist:

- [x] Add DraftNode and AppliedDraftCommit contracts.
- [x] Extend SessionMetadata with draft fields.
- [x] Implement ensure_draft_graph_initialized(session) adapter.
- [x] Keep root mirror to legacy operations and staged_operations_version.
- [ ] Add serialization tests for old and new session payloads.

Acceptance criteria:

- Sessions created before refactor still load and function.
- Any legacy session without drafts is upgraded in-memory without data loss.
- Existing API responses remain backward compatible.

## Phase B: Planner contract

Scope:

- Add strict planner JSON schema including draft_action and tool_plan.
- Keep existing planner path as fallback under flag.

Checklist:

- [x] Define planner payload models in client planner layer.
- [x] Validate schema with explicit error codes.
- [ ] Keep legacy output coercion path behind flag.
- [x] Log schema failures with planner_schema_invalid_attempts.

Acceptance criteria:

- Invalid planner payloads never stage operations.
- Clarifier payloads are always well-formed and user-readable.
- Fallback to legacy planner works when feature flag is off.

## Phase C: ReAct executor

Scope:

- Implement bounded planner-executor loop in orchestration.
- Reuse context tools executor with normalized telemetry.

Checklist:

- [ ] Add deterministic loop controller in agent_service.
- [ ] Enforce max tool budget and max planner turns.
- [ ] Normalize tool result validation and failure mapping.
- [x] Emit loop telemetry: turns, tool_calls, stop_reason, budget_exhausted.

Acceptance criteria:

- No unbounded tool loops.
- Budget exhaustion always yields clarifier, never partial unsafe staging.
- Tool validation failures are deterministic and test-covered.

## Phase D: Preview/commit hard-binding

Scope:

- Bind preview to draft snapshot fingerprint.
- Enforce strict commit matching.
- Remove permissive commit self-heal target switching.

Checklist:

- [x] Add preview_fingerprint generation helper.
- [x] Persist preview_id -> fingerprint + draft_id + draft_version mapping.
- [x] Validate mapping on commit before backend commit call.
- [x] Keep duplicate-apply prevention using applied tracking.
- [ ] Remove commit regeneration self-heal branch.

Acceptance criteria:

- Commit fails with deterministic stale code when fingerprint mismatches.
- Commit never applies a regenerated preview for a different snapshot implicitly.
- Duplicate apply remains blocked idempotently.

## Phase E: UX and clarifier contract

Scope:

- Standardize clarifier format and lane behavior when a draft is active.
- Keep confirm/retry/correction in edit lane deterministically.

Checklist:

- [ ] Define standard clarifier schema with options and action.
- [ ] Ensure numbered options for ambiguity and multi-match cases.
- [x] Preserve deterministic retry stale-hint invalidation.
- [x] Add explicit draft_action clarifier when mode is uncertain.

Acceptance criteria:

- Ambiguous cases always return concise numbered options.
- Active draft sessions do not leak into generic chat responses for edit intents.
- Retry flows never reuse stale rename hints.

## Phase F: Cleanup

Scope:

- Remove legacy single-list staging path after parity.
- Keep deterministic fastpaths optional and gated.

Checklist:

- [ ] Remove temporary mirror write path.
- [ ] Delete replace_operations heuristic dependence where draft_action supersedes it.
- [ ] Keep optional fastpath as feature-flagged optimization only.
- [ ] Update internal docs and runbooks.

Acceptance criteria:

- Core edit path operates entirely on draft graph.
- Legacy behavior can be toggled only for rollback windows.
- No regression in preview/apply safety tests.

## 7) Config flags for rollout

Add in settings and env:

- AGENT_HYBRID_REACT_ENABLED=false
- AGENT_DRAFT_GRAPH_ENABLED=false
- AGENT_REACT_TOOL_BUDGET=3
- AGENT_REACT_PLANNER_MAX_TURNS=4
- AGENT_STRICT_PREVIEW_FINGERPRINT=true

Notes:

- Existing max_edit_tool_turns currently defaults to 4 in config and should align with AGENT_REACT_TOOL_BUDGET during migration.
- Existing AGENT_LLM_FIRST_EDIT_ENABLED remains the outer gate for planner mode fallback.

Rollout plan:

- Dev environment enabled with verbose telemetry.
- Shadow mode logging in staging (decision compare only, no behavior switch).
- Canary by roadmap_id allowlist.
- Full enable after parity and test pass criteria.

## 8) Test plan (must-have)

Unit/integration coverage:

- [ ] continue/revise/new_draft routing correctness.
- [ ] correction then retry does not use stale rename hints.
- [ ] two independent renames in one session:
  - append mode intentionally accumulates.
  - new_draft mode isolates operations.
- [ ] preview failure does not allow stale apply.
- [ ] commit rejects mismatched preview fingerprint.
- [ ] ambiguous resolve returns clarifier with numbered options and IDs.
- [ ] tool budget exhaustion yields clarifier and no infinite loop.

E2E cases aligned to observed failures:

- [ ] Double rename same session with correction and retry.
- [ ] Preview generated, then draft mutated, then commit old preview should fail with stale code.
- [ ] Parallel draft branch created, commit from non-active draft preview should fail unless explicitly selected.

Acceptance criteria for test suite:

- All new tests pass in agent test suite.
- No regression in existing deterministic intent, context adapter, and edit resolver tests.
- CI includes at least one e2e path validating strict fingerprint binding.

## 9) Immediate next sprint backlog

1. Remove commit self-heal regeneration paths (strict stale-preview contract only).

- Deliverables:
  - remove commit regeneration fallback in `sessions.py`
  - deterministic stale preview conflict response only
  - tests covering no implicit preview switching/regeneration

2. Consolidate bounded ReAct loop in orchestration.

- Deliverables:
  - explicit planner-executor bounded loop in `agent_service.py`
  - strict budget/turn guard behavior across edit planning
  - deterministic tool result validation mapping

3. Standardize clarifier response contract.

- Deliverables:
  - numbered disambiguation options with stable identifiers
  - consistent ask-clarifier schema for ambiguous edit flows
  - tests for ambiguous rename/target resolution UX

4. Add serialization/migration coverage for draft graph metadata.

- Deliverables:
  - backward compatibility tests for legacy sessions
  - round-trip serialization for new draft graph fields
  - migration parity assertions for active draft and staged version mirrors

5. Remove legacy staging heuristics after parity validation.

- Deliverables:
  - reduce/remove `replace_operations` dependence
  - remove temporary mirror path once parity gate is met
  - rollout checklist and rollback notes updated

Definition of done for sprint:

- Feature flags default off.
- New tests green locally and in CI.
- Manual QA scripts confirm no unsafe commit path.
- Rollback path documented (flags + fallback behavior).

## 10) Implementation touchpoints by file

Primary files expected to change:

- agent/app/core/contracts/sessions.py
- agent/app/core/orchestration/agent_service.py
- agent/app/core/llm/client.py
- agent/app/api/routes/sessions.py
- agent/app/core/config.py
- agent/tests/test_agent_safety.py
- agent/tests/test_deterministic_context\*.py
- agent/tests/test_edit_resolver.py

Secondary/new tests likely:

- agent/tests/test_draft_graph_routing.py
- agent/tests/test_preview_fingerprint_binding.py
- agent/tests/test_hybrid_react_budget.py

## 11) Risks and mitigations

Risk:

- Migration bugs for pre-existing sessions.
  Mitigation:

- Root-draft adapter plus compatibility mirror and serialization tests.

Risk:

- Over-clarification causing UX friction.
  Mitigation:

- Deterministic draft policy and concise numbered options; tune only on measured ambiguity rates.

Risk:

- Planner payload drift across providers.
  Mitigation:

- Strict schema validation and bounded repair retries with deterministic fallback.

Risk:

- Commit regressions when removing self-heal path.
  Mitigation:

- Feature flag and explicit stale-preview error guidance to regenerate preview.

## 12) Final acceptance gate for rollout

Ship when all conditions are true:

- [ ] Draft graph parity with legacy staging is verified.
- [ ] Strict preview fingerprint commit guard is enforced and tested.
- [ ] No known unsafe apply paths remain.
- [ ] Budget/turn bounded ReAct telemetry confirms stable behavior in canary.
- [ ] Legacy path remains available behind flags for rollback window.
