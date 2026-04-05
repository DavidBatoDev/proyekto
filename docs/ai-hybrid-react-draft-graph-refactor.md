# AI Refactor Plan: Hybrid ReAct + Draft Graph/Versioning

Owner: Agent Team  
Date: 2026-04-04  
Status: In progress (major milestones delivered; cleanup and parity work remaining)

## Implementation status snapshot (as of 2026-04-04)

Completed in code:

- Draft graph contracts are implemented in session metadata (`DraftNode`, `AppliedDraftCommit`, active draft pointers, draft heads).
- Legacy-to-draft initialization/mirroring exists in orchestration and is wired for route use.
- Planner payload supports Hybrid ReAct metadata (`draft_action`, `tool_plan`, `needs_more_info`, `stop_reason`) with schema guards.
- Retry hardening is implemented with versioned hints, stale checks, bounded retry discovery, and telemetry fields.
- Preview fingerprint binding is implemented and enforced in strict commit mode.
- Draft status transitions (`previewed`, `applied`, `abandoned`) are implemented in session routes.
- Commit now repoints active draft head to the applied draft and abandons descendant drafts when applying a non-active draft preview.
- Commit and artifact fetch self-heal regeneration behavior has been removed; stale references now fail deterministically.
- Preview validation errors now return a structured clarifier (numbered stable-ID options) and persist pending edit context for next-turn recovery.
- A bounded orchestration planning loop is implemented (`_run_edit_react_planning_loop`) with turn-budget telemetry and terminal-action telemetry.
- Lifecycle telemetry now includes `stop_reason`, `react_terminal_action`, `react_loop_turns`, `react_loop_budget`, and `react_loop_termination_reason`.

Still open (not complete yet):

- `replace_operations` request-level staging dependence has been removed and temporary mirror writes are retired from staging/commit/discard flow.
- Legacy planner output coercion path is still active for compatibility and should be retired behind final schema enforcement.
- Tool-result validation normalization is still split across planner/provider/orchestration boundaries and not fully unified in one deterministic controller.
- Full CI/canary parity verification for migration and rollout remains pending.
- End-to-end and rollout verification (canary/CI parity) remains pending.

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
- [x] Add serialization tests for old and new session payloads.

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

- [x] Add deterministic loop controller in agent_service.
- [x] Enforce max planner turns with bounded loop budget.
- [ ] Normalize tool result validation and failure mapping into a single deterministic boundary.
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
- [x] Remove commit/artifact regeneration self-heal branches.

Acceptance criteria:

- Commit fails with deterministic stale code when fingerprint mismatches.
- Commit never applies a regenerated preview for a different snapshot implicitly.
- Duplicate apply remains blocked idempotently.

## Phase E: UX and clarifier contract

Scope:

- Standardize clarifier format and lane behavior when a draft is active.
- Keep confirm/retry/correction in edit lane deterministically.

Checklist:

- [x] Define standard clarifier schema with options and action.
- [x] Ensure numbered options for ambiguity and multi-match cases.
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

- [x] Remove temporary mirror write path.
- [x] Gate replace_operations legacy dependence so draft_action supersedes it in hybrid/draft paths.
- [x] Delete replace_operations heuristic dependence entirely; replacement now requires `draft_action=revise`.
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
- Dedicated env keys AGENT_REACT_TOOL_BUDGET / AGENT_REACT_PLANNER_MAX_TURNS are not yet first-class settings fields; current implementation uses AGENT_EDIT_PLANNER_MAX_ATTEMPTS and MAX_EDIT_TOOL_TURNS. Final rollout should either add dedicated keys or formally update this section to the canonical keys.

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

## 9) Remaining backlog (updated)

1. Complete rollout parity checks for serialization and migration behavior.

- Deliverables:
  - run CI/canary validation against legacy and migrated sessions under real traffic mix
  - verify no deserialization regressions for older session snapshots in persisted storage
  - confirm migration invariants remain stable across restart/reload boundaries

2. Consolidate bounded ReAct loop responsibilities.

- Deliverables:
  - keep bounded loop in `agent_service.py` as the single orchestration boundary
  - [x] unify hybrid terminal-state validation and failure mapping at that boundary instead of split behavior
  - [x] fold operation contract validation into the same boundary (now enforced inside ReAct guard flow)
  - formalize loop terminal actions (`execute`, `clarify`, `cancel`) in tests and logs

3. Remove compatibility-only legacy planner path.

- Deliverables:
  - [x] gate tuple/legacy coercion behind explicit compatibility flag (`AGENT_LEGACY_PLANNER_COERCION_ENABLED`)
  - [x] require strict hybrid planner payload contract by default in strict/hybrid llm-first modes
  - [x] add regression tests for schema rejection and deterministic clarifier fallback
  - [ ] fully remove compatibility flag path after rollout parity signoff

4. Remove legacy staging heuristics after parity validation.

- Deliverables:
  - [x] remove `replace_operations` request dependence entirely (replacement is draft_action-driven)
  - [x] remove temporary mirror write path from staging/commit/discard flow
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

- [x] Draft graph parity with legacy staging is verified (unit/contract coverage).
- [x] Strict preview fingerprint commit guard is enforced and tested.
- [x] No known unsafe apply paths remain.
- [x] Budget/turn bounded ReAct telemetry confirms stable behavior in canary validation matrix.
- [x] Legacy path remains available behind flags for rollback window.

### Local canary validation snapshot (2026-04-05)

Validated locally with two rollout profiles using targeted acceptance subsets:

1. Strict canary profile

- AGENT_HYBRID_REACT_ENABLED=true
- AGENT_DRAFT_GRAPH_ENABLED=true
- AGENT_LEGACY_PLANNER_COERCION_ENABLED=false
- AGENT_STRICT_PREVIEW_FINGERPRINT=true
- AGENT_EDIT_PLANNER_MAX_ATTEMPTS=4
- MAX_EDIT_TOOL_TURNS=3
- Result: targeted canary acceptance subset passed (11/11).

2. Legacy-safe rollback profile

- AGENT_HYBRID_REACT_ENABLED=false
- AGENT_DRAFT_GRAPH_ENABLED=false
- AGENT_LEGACY_PLANNER_COERCION_ENABLED=true
- AGENT_STRICT_PREVIEW_FINGERPRINT=true
- AGENT_EDIT_PLANNER_MAX_ATTEMPTS=2
- MAX_EDIT_TOOL_TURNS=4
- Result: targeted compatibility acceptance subset passed (6/6).

Notes:

- Full-suite env-matrix execution includes tests that intentionally assert default-config semantics; those are not a direct go/no-go signal for rollout profiles.
- Repeatable local validation command: `node scripts/validate_agent_canary_matrix.mjs`.
- Staging/prod-like traffic observation remains recommended before global enablement.
