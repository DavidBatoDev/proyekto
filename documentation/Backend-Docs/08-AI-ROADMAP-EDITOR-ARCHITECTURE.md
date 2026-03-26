# AI Roadmap Editor Architecture

> **Status:** Planned (Not Yet Implemented)  
> **Scope:** Documentation-only architecture spec for AI-assisted roadmap editing  
> **Primary goal:** Define a production-safe design before implementation in `agent` (FastAPI) and NestJS

## Related docs

- `./00-README.md`
- `./07-API-REFERENCE.md`
- `../Roadmap-JSON/JSON_ROADMAP_DEV_GUIDE.md`

---

## A. Inferred current JSON Roadmap workflow
**Status Tags:** [Current: implemented today] [Planned: AI-assisted flow not implemented] [Gap: preview/diff/commit pipeline missing]

1. The roadmap is edited as a single hierarchical JSON document in Dev Mode (`roadmap_epics -> roadmap_features -> roadmap_tasks`).
2. The visual roadmap UI is derived from the nested roadmap payload returned by `GET /api/roadmaps/:id/full` and rendered as cards, hierarchy, and timeline views.
3. Dev Mode JSON editing currently happens in the `JSONRoadmapSidePanel`, where users edit full JSON and save.
4. Saving full JSON currently calls `POST /api/roadmaps/full`.
5. NestJS normalizes defaults and IDs in `RoadmapPatchService`, then calls Supabase RPC `upsert_full_roadmap`.
6. Supabase stores roadmap data in normalized relational tables (`roadmaps`, `roadmap_epics`, `roadmap_features`, `roadmap_tasks`), with milestones and `milestone_features` managed through separate routes/tables.
7. Existing backend responsibilities already include full roadmap upsert, nested DTO validation, ID preservation/generation, enum/type validation, and ownership/permission checks.
8. JSON Patch (`PATCH /api/roadmaps/:id/json-patch`) exists for partial RFC 6902 updates with allowed path restrictions.

---

## B. Key assumptions
**Status Tags:** [Current: based on present repo behavior] [Planned: architecture target] [Gap: explicit implementation pending]

1. `agent/` will host a standalone FastAPI service for AI orchestration.
2. FastAPI and NestJS communicate over API calls, not in-process integration.
3. NestJS remains the only authoritative mutation/validation/persistence layer for roadmap state.
4. Supabase remains the storage/auth system of record.
5. LangChain migration is expected soon, but not used in v1.
6. Visual roadmap UX is the primary user surface; raw JSON is a developer-mode tool, not end-user UX.

---

## C. Current risks
**Status Tags:** [Current: active risks] [Planned: mitigations defined below] [Gap: mitigations not implemented yet]

1. Full-document upsert can delete nested items if omitted accidentally.
2. No semantic diff gate exists before persistence in Dev Mode.
3. No explicit roadmap revision token check exists in the current full upsert contract.
4. Validation is strong on type/schema but lighter on semantic cross-node business rules.
5. JSON Patch path/index operations are brittle when list order changes.
6. AI helper in UI currently suggests text only and cannot perform safe structured mutations.

---

## D. Executive recommendation
**Status Tags:** [Current: not implemented] [Planned: recommended target] [Gap: requires new contracts/services]

Use an **operation-first AI editing model**:

1. AI never blindly rewrites full roadmap JSON.
2. AI produces structured edit operations through tool/function calling.
3. NestJS runs preview apply + validation + semantic diff before commit.
4. User approves visual diff in frontend.
5. NestJS commits atomically and stores a versioned revision.

This keeps AI orchestration flexible while preserving backend authority and data safety.

---

## E. Architecture
**Status Tags:** [Current: partial pieces exist] [Planned: full AI preview/commit pipeline] [Gap: orchestration + preview endpoints]

### Target interaction flow

```text
React (TanStack)
  -> FastAPI /agent (chat/session/tool orchestration)
    -> OpenAI Responses API (function calling)
      -> FastAPI draft operations
        -> NestJS /api/roadmaps/:id/ai/preview (apply+validate+semantic diff, no write)
          -> React visual diff preview
            -> FastAPI /agent commit
              -> NestJS /api/roadmaps/:id/ai/commit (transactional write + revision)
                -> Supabase
```

### Sample roadmap model (canonical document shape)

```json
{
  "id": "roadmap_uuid",
  "revision": 42,
  "name": "Q3 Delivery Plan",
  "status": "active",
  "start_date": "2026-07-01T00:00:00Z",
  "end_date": "2026-09-30T00:00:00Z",
  "settings": {
    "view_mode": "roadmap"
  },
  "roadmap_epics": [
    {
      "id": "epic_uuid",
      "title": "Onboarding",
      "position": 0,
      "status": "in_progress",
      "roadmap_features": [
        {
          "id": "feature_uuid",
          "title": "SSO",
          "position": 0,
          "status": "in_progress",
          "roadmap_tasks": [
            {
              "id": "task_uuid",
              "title": "OIDC callback hardening",
              "status": "todo",
              "priority": "high",
              "position": 0
            }
          ]
        }
      ]
    }
  ]
}
```

---

## F. Why it fits my stack
**Status Tags:** [Current: stack constraints acknowledged] [Planned: aligned design] [Gap: integration work needed]

1. Keeps NestJS as domain authority for business logic, permission checks, and persistence.
2. Keeps FastAPI independent for AI orchestration and model/provider abstraction.
3. Keeps Supabase as existing storage/auth base with minimal disruption.
4. Reuses current roadmap module patterns (DTO/service/repository/RPC).
5. Supports visual roadmap UX by returning semantic diffs instead of raw code-style patches.

---

## G. Service responsibilities
**Status Tags:** [Current: partially implemented boundaries] [Planned: explicit AI boundary contract] [Gap: new AI endpoints/contracts]

| Layer | Responsibilities |
|---|---|
| Frontend (React + TanStack) | Render roadmap UI, show semantic preview diff, collect user confirmation, display validation issues |
| FastAPI (`agent`) | OpenAI calls, tool orchestration, intent parsing, operation planning, session state |
| NestJS | Authoritative apply/validate/diff/commit logic, permission checks, versioning, rollback |
| Supabase | Storage, relational constraints, auth integration, transactional persistence |

### Ownership decisions

1. **Who applies changes:** NestJS only.
2. **Who validates:** NestJS authoritative; FastAPI preflight only.
3. **Who generates semantic diff:** NestJS authoritative.
4. **Who owns AI tools:** FastAPI owns tool registry/orchestration; tools call NestJS domain endpoints.

---

## H. Current implementation (OpenAI + FastAPI agent)
**Status Tags:** [Current: not implemented] [Planned: first AI implementation phase] [Gap: FastAPI service absent]

### Phase-1 implementation target (before LangChain)

1. Build FastAPI `agent` service with OpenAI Responses API + function calling.
2. Keep prompts, tool schemas, and operation planning modular.
3. Use NestJS preview/commit endpoints for authoritative mutation lifecycle.

### Sample edit intent type

```json
{
  "intent_id": "intent_01",
  "roadmap_id": "roadmap_uuid",
  "base_revision": 42,
  "user_utterance": "Move SSO under Security epic and mark login task done",
  "guardrails": {
    "allow_delete": false,
    "max_operations": 25,
    "require_preview_before_commit": true
  }
}
```

---

## I. LangChain migration design
**Status Tags:** [Current: not using LangChain] [Planned: adapter-based migration] [Gap: adapter implementation pending]

### Stable interfaces to preserve

1. `LLMClient` for model invocation with tool support.
2. `ToolRegistry` for tool metadata and execution.
3. `PromptRepository` for externalized prompts.
4. `OperationPlanner` for operation assembly.
5. `ValidationClient` for preview/commit contracts.
6. `SessionStore` for AI session memory/state.

### Adapter strategy

1. v1 adapter: `OpenAIResponsesAdapter`.
2. future adapter: `LangChainAgentAdapter`.
3. no change to operation schema, validators, or NestJS contracts during migration.

---

## J. Modules / folder structure
**Status Tags:** [Current: partially present] [Planned: target module boundaries] [Gap: files/modules to create]

```text
agent/
  app/
    main.py
    api/routes/
      sessions.py
      preview.py
      commit.py
    core/
      llm/
        client.py
        openai_responses_adapter.py
      orchestration/
        agent_service.py
        operation_planner.py
        session_store.py
      tools/
        registry.py
        roadmap_tools.py
      contracts/
        intent.py
        operations.py
        validation.py
        diff.py
      prompts/
        system.md
        planner.md
        tool_policies.md

backend/src/modules/roadmaps-ai/
  controllers/
    roadmap-ai.controller.ts
  services/
    roadmap-ai-preview.service.ts
    roadmap-ai-commit.service.ts
    roadmap-operation-applier.service.ts
    roadmap-diff.service.ts
    roadmap-validation.service.ts
    roadmap-versioning.service.ts
  dto/
    ai-preview.dto.ts
    ai-commit.dto.ts
    operation.dto.ts
    diff.dto.ts
```

---

## K. Validation design
**Status Tags:** [Current: basic validations exist] [Planned: layered AI-safe validation] [Gap: unified validation contract]

### Validation layers

1. **AI intent validation (FastAPI):** scope guardrails, operation limits, unsafe intent blocking.
2. **Schema validation (NestJS):** operation DTO shape/type/enum/path checks.
3. **Business validation (NestJS):** hierarchy integrity, date rules, dependency integrity, progress consistency, stale revision checks.
4. **DB validation (Supabase):** FK/enum/check/constraint enforcement.

### Validation result format

```json
{
  "ok": false,
  "issues": [
    {
      "code": "DEPENDENCY_CYCLE",
      "severity": "error",
      "path": "/dependencies/2",
      "node_ref": {
        "type": "feature",
        "id": "feature_uuid"
      },
      "message": "Dependency creates cycle",
      "suggested_fix": "Remove dependency edge"
    }
  ]
}
```

### Sample validation issue type

```ts
type ValidationIssue = {
  code:
    | "MISSING_REQUIRED_FIELD"
    | "INVALID_TYPE"
    | "INVALID_ENUM"
    | "DUPLICATE_ID"
    | "BROKEN_RELATIONSHIP"
    | "DEPENDENCY_CYCLE"
    | "INVALID_DATE_RANGE"
    | "HIERARCHY_VIOLATION"
    | "PROGRESS_MISMATCH"
    | "STALE_REVISION"
    | "OUT_OF_SCOPE_MUTATION";
  severity: "error" | "warning";
  path: string;
  message: string;
  node_ref?: {
    type: "roadmap" | "milestone" | "epic" | "feature" | "task";
    id: string;
  };
  suggested_fix?: string;
};
```

### Error code registry (planned)

| Code | Meaning |
|---|---|
| `MISSING_REQUIRED_FIELD` | Required field missing in operation/candidate state |
| `INVALID_TYPE` | Field type mismatch |
| `INVALID_ENUM` | Enum value out of allowed domain |
| `DUPLICATE_ID` | Duplicate ID in same graph scope |
| `BROKEN_RELATIONSHIP` | Parent/child link invalid |
| `DEPENDENCY_CYCLE` | Dependency graph cycle detected |
| `INVALID_DATE_RANGE` | Start/end/target/due date rule violated |
| `HIERARCHY_VIOLATION` | Node placement rule violated |
| `PROGRESS_MISMATCH` | Status/progress inconsistency |
| `STALE_REVISION` | Base revision no longer current |
| `OUT_OF_SCOPE_MUTATION` | AI attempted disallowed mutation |

---

## L. Tool calling design
**Status Tags:** [Current: not implemented] [Planned: operation-first tool calling] [Gap: tool registry + execution engine]

### Safety Rules

1. AI must not directly overwrite full roadmap JSON without preview validation.
2. AI must not mutate unrelated fields.
3. AI commits must require validated preview plus user confirmation.
4. AI tool execution must be scoped to one roadmap and one base revision.
5. Any destructive operation must surface impact in semantic diff before commit.

### Planned tool catalog

| Tool | Purpose | Ownership |
|---|---|---|
| `find_node` | Resolve node(s) by ID/name/path | FastAPI tool wrapper + NestJS read |
| `add_epic` / `add_feature` / `add_task` | Create nodes | FastAPI drafts operation |
| `move_node` | Move/reorder node | FastAPI drafts operation |
| `update_node` | Partial field update | FastAPI drafts operation |
| `delete_node` | Remove node with impact awareness | FastAPI drafts operation |
| `link_dependency` / `unlink_dependency` | Manage dependencies | FastAPI drafts operation |
| `shift_dates` | Bulk timeline offset | FastAPI drafts operation |
| `mark_status` | State transitions | FastAPI drafts operation |
| `preview_changes` | Validate/apply in preview mode | NestJS authoritative |
| `commit_changes` | Persist approved preview | NestJS authoritative |
| `rollback` | Restore previous revision | NestJS authoritative |

### Sample tool contract

```json
{
  "name": "move_node",
  "description": "Move or reorder a roadmap node without mutating unrelated fields.",
  "input_schema": {
    "type": "object",
    "required": ["roadmap_id", "node_type", "node_id", "position"],
    "properties": {
      "roadmap_id": { "type": "string", "format": "uuid" },
      "node_type": { "type": "string", "enum": ["epic", "feature", "task"] },
      "node_id": { "type": "string", "format": "uuid" },
      "new_parent_id": { "type": ["string", "null"], "format": "uuid" },
      "position": { "type": "integer", "minimum": 0 }
    }
  }
}
```

---

## M. Semantic diff design
**Status Tags:** [Current: no canonical semantic diff endpoint] [Planned: diff-first approval UX] [Gap: diff generator + frontend integration]

### Diff types

1. `NODE_ADDED`
2. `NODE_REMOVED`
3. `NODE_MOVED`
4. `STATUS_CHANGED`
5. `DATE_CHANGED`
6. `DEPENDENCY_CHANGED`

### Generation strategy

1. Load base snapshot by `roadmap_id + base_revision`.
2. Apply operations in memory.
3. Compare node sets, parent/position edges, status/date fields, dependency edges.
4. Emit structured change list and summary counts.

### Sample diff type

```json
{
  "summary": {
    "node_added": 1,
    "node_removed": 0,
    "node_moved": 1,
    "status_changed": 1,
    "date_changed": 1,
    "dependency_changed": 1
  },
  "changes": [
    {
      "type": "NODE_MOVED",
      "node": { "type": "feature", "id": "feature_uuid" },
      "from": { "parent_id": "epic_a", "position": 3 },
      "to": { "parent_id": "epic_b", "position": 0 }
    }
  ]
}
```

---

## N. End-to-end request flow
**Status Tags:** [Current: partial non-AI flow exists] [Planned: full preview/commit AI flow] [Gap: missing AI API surfaces]

### Planned full flow

1. User submits natural-language request in roadmap chat UI.
2. React sends message to FastAPI `agent` session endpoint.
3. FastAPI calls OpenAI with tool schemas.
4. Model triggers tools; FastAPI builds draft operation list.
5. FastAPI requests NestJS preview with `base_revision + operations`.
6. NestJS returns candidate snapshot, validation issues, and semantic diff.
7. React renders visual preview and asks for approval.
8. On approval, FastAPI calls NestJS commit endpoint.
9. NestJS revalidates and persists transactionally with new revision.
10. React refreshes roadmap state and displays committed diff summary.

### Sample full flow payload

```json
{
  "roadmap_id": "roadmap_uuid",
  "base_revision": 42,
  "operations": [
    {
      "op": "move_node",
      "node_type": "feature",
      "node_id": "feature_uuid",
      "new_parent_id": "epic_security",
      "position": 0
    },
    {
      "op": "update_node",
      "node_type": "feature",
      "node_id": "feature_uuid",
      "patch": {
        "status": "blocked"
      }
    },
    {
      "op": "shift_dates",
      "scope": {
        "epic_id": "epic_security",
        "include_descendants": true
      },
      "delta_days": 5
    }
  ]
}
```

---

## O. Risks and tradeoffs
**Status Tags:** [Current: baseline complexity] [Planned: manageable with strict contracts] [Gap: implementation/operations overhead]

1. Added service boundaries increase integration complexity.
2. Preview-first workflow adds latency but improves safety.
3. Dependency validation requires first-class dependency data model support.
4. Revision history adds storage cost but enables rollback/auditability.
5. Strict AI guardrails reduce flexibility but prevent unsafe state mutation.

---

## P. Next steps
**Status Tags:** [Current: pending] [Planned: execution order defined] [Gap: no code changes yet]

1. Implement NestJS planned preview/commit/rollback contracts (without AI coupling).
2. Implement operation applier + validation + semantic diff services in NestJS.
3. Implement roadmap revision storage/versioning and rollback support.
4. Scaffold FastAPI `agent` with OpenAI function-calling and tool registry.
5. Integrate React visual diff approval UX.
6. Add contract tests for operation, validation, and diff payloads.
7. Introduce LangChain adapter only after v1 contracts are stable.

---

## Planned API/Interface Reference (Not Yet Implemented)

> All endpoints below are **planned only** and are not currently available.

### FastAPI `agent` service (separate from NestJS `/api`)

| Method | Path | Status | Description |
|---|---|---|---|
| `POST` | `/agent/sessions` | Planned | Create AI editing session |
| `POST` | `/agent/sessions/:sessionId/messages` | Planned | Submit user prompt and run tool orchestration |
| `POST` | `/agent/sessions/:sessionId/preview` | Planned | Request preview package from current draft operations |
| `POST` | `/agent/sessions/:sessionId/commit` | Planned | Commit approved preview |
| `POST` | `/agent/sessions/:sessionId/rollback` | Planned | Roll back to target revision |

### NestJS roadmap AI endpoints

| Method | Path | Status | Description |
|---|---|---|---|
| `POST` | `/api/roadmaps/:id/ai/preview` | Planned | Apply operations in memory, validate, return semantic diff |
| `POST` | `/api/roadmaps/:id/ai/commit` | Planned | Revalidate and persist approved operation set |
| `POST` | `/api/roadmaps/:id/ai/rollback` | Planned | Restore roadmap to prior revision |

### Planned preview request/response contracts

```json
{
  "request": {
    "roadmap_id": "roadmap_uuid",
    "base_revision": 42,
    "operations": []
  },
  "response": {
    "preview_id": "preview_uuid",
    "base_revision": 42,
    "candidate_revision": 43,
    "validation_issues": [],
    "semantic_diff": {
      "summary": {},
      "changes": []
    },
    "candidate_snapshot": {}
  }
}
```
