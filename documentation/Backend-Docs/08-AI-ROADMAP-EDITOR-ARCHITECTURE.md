# AI Roadmap Editor Architecture

> **Status:** In Progress (Partially Implemented)  
> **Scope:** Documentation-only architecture spec for AI-assisted roadmap editing  
> **Primary goal:** Define a production-safe design before implementation in `agent` (FastAPI) and NestJS

## Related docs

- `./00-README.md`
- `./07-API-REFERENCE.md`
- `../Roadmap-JSON/JSON_ROADMAP_DEV_GUIDE.md`

---

## A. Inferred current JSON Roadmap workflow
**Status Tags:** [Current: JSON roadmap flow implemented + AI preview flow partially implemented] [Planned: artifact workspace completion] [Gap: full preview tab/panel + commit UX integration]

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
5. LangChain graph orchestration is now active in `agent`, with provider adapters to keep model backends swappable.
6. Visual roadmap UX is the primary user surface; raw JSON is a developer-mode tool, not end-user UX.

---

## C. Current risks
**Status Tags:** [Current: active risks] [Planned: mitigations defined below] [Gap: mitigations not implemented yet]

1. Full-document upsert can delete nested items if omitted accidentally.
2. No semantic diff gate exists before persistence in Dev Mode.
3. No explicit roadmap revision token check exists in the current full upsert contract.
4. Validation is strong on type/schema but lighter on semantic cross-node business rules.
5. JSON Patch path/index operations are brittle when list order changes.
6. AI edit planning currently covers core node operations, but dependency mutations and rollback remain incomplete.

---

## D. Executive recommendation
**Status Tags:** [Current: partially implemented] [Planned: finalize artifact workspace + approval lifecycle] [Gap: complete end-user visual preview/approve/discard experience]

Use an **operation-first AI editing model**:

1. AI never blindly rewrites full roadmap JSON.
2. AI produces structured edit operations through tool/function calling.
3. NestJS runs preview apply + validation + semantic diff before commit.
4. User approves visual diff in frontend.
5. NestJS commits atomically and stores a versioned revision.

This keeps AI orchestration flexible while preserving backend authority and data safety.

---

## E. Architecture
**Status Tags:** [Current: chat-first + preview APIs partially implemented] [Planned: full artifact tab UX + commit lifecycle] [Gap: dedicated roadmap preview tab/panel UX]

### Target interaction flow

```text
React (TanStack)
  -> FastAPI /agent (chat/session/tool orchestration)
    -> LangChain graph (intent + dynamic system prompt + tools)
      -> FastAPI draft operations
        -> NestJS /api/roadmaps/:id/ai/preview (apply+validate+semantic diff, no write)
          -> FastAPI returns artifact reference in chat response
            -> React opens preview artifact
              -> FastAPI /agent/sessions/:sessionId/artifacts/:artifactId
                -> NestJS /api/roadmaps/:id/ai/previews/:previewId
                  -> React visual roadmap candidate panel
                    -> FastAPI /agent commit
                      -> NestJS /api/roadmaps/:id/ai/commit
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
| FastAPI (`agent`) | LLM provider calls (Gemini/OpenAI), tool orchestration, intent parsing, operation planning, session state |
| NestJS | Authoritative apply/validate/diff/commit logic, permission checks, versioning, rollback |
| Supabase | Storage, relational constraints, auth integration, transactional persistence |

### Ownership decisions

1. **Who applies changes:** NestJS only.
2. **Who validates:** NestJS authoritative; FastAPI preflight only.
3. **Who generates semantic diff:** NestJS authoritative.
4. **Who owns AI tools:** FastAPI owns tool registry/orchestration; tools call NestJS domain endpoints.

---

## H. Current implementation (Gemini primary + OpenAI fallback in FastAPI agent)
**Status Tags:** [Current: partially implemented] [Planned: artifact tab UX completion] [Gap: full visual preview workspace integration]

### Current implementation snapshot

1. FastAPI `agent` runs LangChain graph orchestration with intent routing (`smalltalk`, `question`, `roadmap_edit`, `unclear`).
2. Dynamic prompts are externalized in `agent/app/core/prompts/*` and composed per mode (`chat_mode`, `edit_mode`).
3. `/messages` now uses native tool loops for roadmap questions and edit planning:
   - context tools (`get_roadmap_summary`, `search_nodes`, `get_node_details`, `get_children`)
   - question/unclear intents with roadmap context -> context-answer tool loop
   - roadmap_edit intent -> edit planning loop that terminates on `plan_roadmap_operations`
   - terminal planning tool (`plan_roadmap_operations`)
4. `/messages` returns chat metadata (`intent_type`, `response_mode`, `preview_available`) and typed `roadmap_preview` artifacts.
5. NestJS now exposes preview retrieval by ID (`GET /api/roadmaps/:id/ai/previews/:previewId`) for artifact-open flows.
6. NestJS now exposes AI context APIs (`/api/roadmaps/:id/ai/context/*`) used by the agent tool loop.
7. Discard lifecycle is implemented:
   - NestJS: `POST /api/roadmaps/:id/ai/discard`
   - FastAPI: `POST /agent/sessions/:sessionId/discard`
8. Chat remains concise while preview payload stays outside chat body and is fetched by artifact reference.
9. Provider adapter layer is active in `agent`:
   - primary: `GeminiLangChainAdapter`
   - fallback: `OpenAILangChainAdapter`
   - final fallback: rule-based response/planner when both providers fail.
10. `/messages` includes provider telemetry:
   - `provider_used`: `gemini | openai | rule_based`
   - `fallback_used`: boolean
   - `provider_error_code`: sanitized provider failure code when fallback was needed.
11. Structured JSON debug tracing is active for `/messages` with request `trace_id` across routing, providers, tool execution, and staging outcome.
12. `/messages` includes optional `debug_trace_id` to correlate frontend requests with backend logs.
13. API keys remain server-side only in `agent/.env` (`GEMINI_API_KEY`, `OPENAI_API_KEY`); no frontend `VITE_*` key usage for orchestration.

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
**Status Tags:** [Current: LangChain graph + provider adapter interfaces implemented in `agent`] [Planned: add provider-specific tuning/observability] [Gap: deeper provider parity testing]

### Stable interfaces to preserve

1. `LLMClient` for model invocation with tool support.
2. `ToolRegistry` for tool metadata and execution.
3. `PromptRepository` for externalized prompts.
4. `OperationPlanner` for operation assembly.
5. `ValidationClient` for preview/commit contracts.
6. `SessionStore` for AI session memory/state.

### Adapter strategy

1. current orchestrator: `LangChainGraphOrchestrator` + `ProviderOrchestrator`.
2. current adapter contract: `LLMProviderAdapter` with implementations `GeminiLangChainAdapter` and `OpenAILangChainAdapter`.
3. provider policy: Gemini first, OpenAI fallback, then rule-based fallback if both fail.
4. keep operation schema, validators, and NestJS contracts stable while swapping model providers.

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
        providers/
          base.py
          gemini_adapter.py
          openai_adapter.py
          orchestrator.py
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
**Status Tags:** [Current: intent-aware tool calling implemented in agent] [Planned: richer tool catalog coverage] [Gap: expanded read tools + dependency-specific tooling]

### Safety Rules

1. AI must not directly overwrite full roadmap JSON without preview validation.
2. AI must not mutate unrelated fields.
3. AI commits must require validated preview plus user confirmation.
4. AI tool execution must be scoped to one roadmap and one base revision.
5. Any destructive operation must surface impact in semantic diff before commit.

### MVP tool catalog (implemented direction)

| Tool | Purpose | Ownership |
|---|---|---|
| `get_roadmap_summary` | Lightweight roadmap context for planning | FastAPI tool wrapper + NestJS read |
| `search_nodes` | Resolve fuzzy references to concrete node IDs | FastAPI tool wrapper + NestJS read |
| `get_node_details` | Fetch details for one roadmap node | FastAPI tool wrapper + NestJS read |
| `get_children` | Fetch child nodes under roadmap/epic/feature | FastAPI tool wrapper + NestJS read |
| `plan_roadmap_operations` | Terminal tool that returns `RoadmapOperation[]` | FastAPI (LLM output contract), validated by NestJS on preview |

### Write operation coverage (current DTO contract)

`plan_roadmap_operations` may output:

- `add_epic`
- `add_feature`
- `add_task`
- `update_node`
- `move_node`
- `delete_node`
- `mark_status`
- `shift_dates`

### Deferred (phase 2)

- dependency mutation operations: `add_dependency`, `remove_dependency`
- model-autonomous commit/discard tools (commit/discard remain UI-driven)

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
**Status Tags:** [Current: semantic diff generated by preview endpoint] [Planned: richer visual diff UX] [Gap: full preview workspace integration]

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
**Status Tags:** [Current: chat-first + artifact references implemented] [Planned: dedicated roadmap preview tab/panel] [Gap: full preview workspace with approve/discard UX]

### Planned full flow

1. User submits natural-language request in roadmap chat UI.
2. React sends message to FastAPI `agent` session endpoint.
3. LangChain graph classifies intent and routes:
   - non-edit intent -> normal assistant chat response
   - edit intent -> operation planning with tool calling
4. FastAPI generates preview for edit intent and returns a compact `roadmap_preview` artifact in chat.
5. User clicks **Open Preview** on artifact card.
6. React resolves full preview package via FastAPI artifact endpoint.
7. FastAPI fetches preview package from NestJS by `preview_id`.
8. React renders candidate roadmap snapshot + semantic diff + validation issues in a dedicated preview surface.
9. On approval, FastAPI calls NestJS commit endpoint.
10. NestJS revalidates and persists transactionally with new revision.

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

### Sample chat artifact reference

```json
{
  "artifact_id": "artifact_uuid",
  "type": "roadmap_preview",
  "roadmap_id": "roadmap_uuid",
  "base_revision": 42,
  "preview_id": "preview_uuid",
  "title": "Roadmap Preview",
  "summary": "Prepared 3 semantic change(s).",
  "semantic_diff_summary": {
    "NODE_MOVED": 1,
    "STATUS_CHANGED": 1,
    "DATE_CHANGED": 1
  },
  "validation_issue_count": 0
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
**Status Tags:** [Current: core contracts implemented] [Planned: hardening + UX completion] [Gap: rollback + dependency ops + full commit UX]

1. Add automated tests for context tools, tool-loop planning, and discard lifecycle.
2. Add frontend discard controls to explicitly clear staged edits and preview artifacts.
3. Implement dependency mutation operations (`add_dependency`, `remove_dependency`) with validation.
4. Implement true rollback behavior behind existing rollback endpoints.
5. Add observability for tool-loop traces (tool sequence, turn count, provider fallback path).
6. Complete visual commit/discard UX in dedicated roadmap preview workspace.

---

## API/Interface Reference (Implementation Status)

> Endpoints below are a mix of **implemented** and **planned**. Status is noted per endpoint.

### FastAPI `agent` service (separate from NestJS `/api`)

| Method | Path | Status | Description |
|---|---|---|---|
| `POST` | `/agent/sessions` | Implemented | Create AI editing session |
| `POST` | `/agent/sessions/:sessionId/messages` | Implemented | Submit prompt, run intent + context-tool loop + planning, return chat metadata + artifacts |
| `POST` | `/agent/sessions/:sessionId/preview` | Implemented | Request preview package from current draft operations |
| `GET` | `/agent/sessions/:sessionId/artifacts/:artifactId` | Implemented | Resolve artifact reference to full preview package |
| `POST` | `/agent/sessions/:sessionId/commit` | Implemented | Commit approved preview |
| `POST` | `/agent/sessions/:sessionId/discard` | Implemented | Clear staged operations and optionally invalidate preview |
| `POST` | `/agent/sessions/:sessionId/rollback` | Implemented (placeholder) | Roll back to target revision (currently not implemented in domain service) |

### NestJS roadmap AI endpoints

| Method | Path | Status | Description |
|---|---|---|---|
| `POST` | `/api/roadmaps/:id/ai/preview` | Implemented | Apply operations in memory, validate, return semantic diff |
| `GET` | `/api/roadmaps/:id/ai/previews/:previewId` | Implemented | Fetch stored preview package for artifact-open flow |
| `POST` | `/api/roadmaps/:id/ai/commit` | Implemented | Revalidate and persist approved operation set |
| `POST` | `/api/roadmaps/:id/ai/discard` | Implemented | Invalidate preview ID without persisting |
| `GET` | `/api/roadmaps/:id/ai/context/summary` | Implemented | Lightweight roadmap summary for AI context |
| `GET` | `/api/roadmaps/:id/ai/context/search` | Implemented | Search roadmap nodes by query |
| `GET` | `/api/roadmaps/:id/ai/context/nodes/:nodeId` | Implemented | Get roadmap node details |
| `GET` | `/api/roadmaps/:id/ai/context/nodes/:nodeId/children` | Implemented | Get child nodes for roadmap/epic/feature |
| `POST` | `/api/roadmaps/:id/ai/rollback` | Implemented (placeholder) | Restore roadmap to prior revision (currently not implemented in domain service) |

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
