# LLM-First Edit Refactor Plan

> **Status:** Proposed (major refactor plan)  
> **Scope:** `agent` orchestration + NestJS safety/preview integration  
> **Primary goal:** Move edit understanding to LLM-first while keeping execution deterministic and safe

## Related docs

- `./08-AI-ROADMAP-EDITOR-ARCHITECTURE.md`
- `./07-API-REFERENCE.md`
- `../Roadmap-JSON/JSON_ROADMAP_DEV_GUIDE.md`

---

## 1. Why this refactor

Recent production-like chat traces show repeated failure patterns:

1. Deterministic parser over-matches create intents and mutates wrong targets/titles.
2. Follow-up confirmations (`okay`, `proceed`, `inside that epic`) lose edit continuity and drop to chat/context-answer mode.
3. Ambiguous edit requests can produce long prose plans without executable operations.
4. Rule-based fallback messaging is rigid and often mismatched to user intent.

This refactor changes intent understanding strategy, not safety boundaries.

---

## 2. Target architecture

### 2.1 Core principle

Use **LLM-first for edit planning**, then **deterministic validation + execution**.

### 2.2 Lane model

1. **Edit planning lane (LLM-first)**
   - Interprets user intent.
   - Produces strict structured output (`operations` or `clarifier`).
2. **Safety lane (deterministic)**
   - Validates operation schema, UUIDs, parent/child constraints, permission gates.
   - Blocks unsafe/invalid plans.
3. **Preview/commit lane (backend-authoritative)**
   - NestJS preview applies candidate operations and returns semantic diff + validation issues.
   - Commit remains explicit and authoritative in NestJS.

### 2.3 Non-goals

1. LLM does not directly mutate DB state.
2. LLM does not bypass validation contracts.
3. LLM does not replace backend authorization.

---

## 3. Behavior policy changes

### 3.1 Remove deterministic text fallback for edit misunderstanding

For edit turns, remove generic deterministic fallback responses such as:

- "Please include specific node IDs and action..."

Replace with:

1. LLM clarifier response (schema-constrained), or
2. deterministic safety error only when operation contract fails.

### 3.2 Keep deterministic fastpath narrowly scoped

Temporary policy during migration:

1. Disable deterministic fastpath for broad `create*` language.
2. Keep deterministic fastpath only for high-confidence single-target operations:
   - rename exact target
   - mark status exact target
   - move exact target

All other edit understanding goes through LLM planner first.

### 3.3 Conversation continuity state

Add `pending_edit_context` in session metadata:

1. `intent_family` (e.g., `create_feature_batch`)
2. resolved references (epic/feature IDs)
3. draft defaults and unresolved fields
4. last assistant question id / confirmation mode

Routing override:

1. If `pending_edit_context` exists and user replies with confirmation tokens (`ok`, `yes`, `proceed`), force edit planning lane.
2. Do not route these turns to context-answer chat lane.

---

## 4. LLM planner contract

Require strict JSON output for edit planning:

```json
{
  "intent": "roadmap_edit",
  "needs_clarification": false,
  "clarification_question": null,
  "operations": [],
  "references_used": []
}
```

Rules:

1. No prose-only plan responses in edit lane.
2. If intent is unclear, return `needs_clarification=true` with a focused question.
3. Multi-operation requests must emit explicit operation arrays.

---

## 5. Deterministic safety gates (unchanged in principle)

Before staging:

1. Validate operation schema.
2. Validate IDs (`node_id`, `parent_id`, `new_parent_id`) as UUID where required.
3. Validate operation-specific required fields (`data.title` for add ops).
4. Validate structural constraints (feature parent must be epic, task parent must be feature).
5. Validate role/permission gates.

If invalid:

1. Block staging.
2. Return focused user guidance tied to validation reason.

---

## 6. Observability and cost controls

### 6.1 Required telemetry

1. `route_lane` (`llm_edit_plan`, `deterministic_edit_fastpath`, `chat`)
2. `planner_mode` (`llm_first_edit_v2`)
3. `pending_edit_context_present` and transition events
4. `operations_count`, `validation_block_reason`
5. `provider_error_code`, `fallback_used`
6. per-phase timings (`intent_classification_ms`, `provider_planning_ms`, `context_tools_ms`, `preview_generation_ms`)

### 6.2 Budget controls

1. Max planner attempts per edit turn (default 1 + optional repair retry).
2. Tool-call budget for planner turns.
3. Token budget cap for planner context.
4. Automatic truncation of irrelevant historical context.

---

## 7. Security hardening requirement

## Finding addressed

`agent/app/api/routes/sessions.py` currently leaks raw infrastructure detail on 503 store failures.

### Required behavior

1. Keep full low-level reason in internal logs.
2. Return stable public error payload to clients:
   - public code (for example `SESSION_STORE_UNAVAILABLE`)
   - safe message without internal hostnames/network details.

This must ship as part of the refactor baseline.

---

## 8. Migration plan (phased)

### Phase 1: Foundation

1. Introduce `pending_edit_context` model and session persistence.
2. Add LLM planner strict schema contract and parser.
3. Add routing override for confirmation turns.

### Phase 2: Lane shift

1. Route most edit intent understanding to LLM-first planner.
2. Restrict deterministic create parser usage.
3. Keep deterministic validator/executor unchanged.

### Phase 3: Fallback cleanup

1. Remove generic deterministic fallback edit text.
2. Add focused clarifier templates for unresolved edits.
3. Enforce "no prose-only plan" in edit lane.

### Phase 4: Hardening

1. Ship 503 error redaction behavior.
2. Expand test matrix for ambiguous/multi-step edit conversations.
3. Verify telemetry dashboards for lane health and latency.

---

## 9. Test plan

1. **Continuation flow**
   - create request -> clarifier -> `okay/proceed` -> executable staged operations.
2. **Ambiguous create/edit language**
   - no wrong-node deterministic creation.
3. **Schema enforcement**
   - LLM prose-only output is rejected and retried/clarified.
4. **Safety validation**
   - invalid IDs/parents blocked with specific guidance.
5. **Fallback behavior**
   - edit lane never emits legacy generic fallback text.
6. **Security**
   - store failure response has redacted public error; logs preserve internal reason.

---

## 10. Acceptance criteria

1. Edit follow-up turns (`okay`, `proceed`) reliably continue pending edit context.
2. No accidental epic creation from feature-batch follow-up language.
3. Edit lane outputs executable operations or focused clarifier, never prose-only pseudo plans.
4. Client-visible 503 errors are sanitized.
5. Preview/commit lifecycle remains backend-authoritative and unchanged in mutation safety.
