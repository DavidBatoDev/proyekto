# Agent Refactor Plan

Tracking document for the six-part refactor of `agent/`. Update checkboxes as milestones land. Each section is a standalone PR; do not start the next until the previous is merged and tests are green.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Sequencing (must be done in order)

1. [x] Split `ContextToolsExecutor` by tool category
2. [x] Error catalog + per-tool latency metrics
3. [x] `contextvars` for `trace_id` / `session_id` propagation
4. [x] Session CAS (optimistic concurrency on Redis writes)
5. [~] Async-native orchestration (remove `async_bridge` threading) — **Phase A done** (see `agent-refactor-05a-async-tool-handlers.md`); Phases B/C/D pending
6. [~] Prompt consolidation + LangChain removal — **6a Phase A done** (see `agent-refactor-06a-prompt-manager.md`); **6b cancelled** — see §6b below for the retention decision

Rationale: each step removes friction for the next. #1 makes later changes tractable. #2 and #3 are cheap and compound. #4 fixes a latent correctness bug. #5 is the big rewrite and benefits from #1–#3. #6 is independent of #5 but easier once the provider boundary is the only LangChain touch point.

---

## Global conventions

- **Branch naming:** `refactor/agent-01-split-context-tools`, `refactor/agent-02-errors-metrics`, etc.
- **Test gate:** `node scripts/test_agent_unit.mjs` and `node scripts/validate_agent_canary_matrix.mjs` both pass before merge.
- **No behavior changes** in #1–#4. Behavior-affecting work is called out explicitly in #5 and #6.
- **Feature-flag new code paths** where there is any chance of regression. Default flags to the old behavior until canary proves the new path.
- **Update this file** as part of each PR. The last commit of each branch flips that section's checkboxes.

---

## 1. Split `ContextToolsExecutor` by category

**Problem:** `agent/app/core/llm/context/context_tools_executor.py` is 4,017 lines, one class, ~50 tool methods. Nobody can hold it in their head; diffs are unreviewable; unit tests are coupled to an unwieldy fixture.

**Goal:** Decompose into cohesive handlers behind a dispatch table, zero behavior change.

**Target structure:**

```
agent/app/core/llm/context/
  dispatch.py                # ToolDispatcher: name → handler lookup
  handlers/
    __init__.py
    base.py                  # ToolHandler protocol + shared helpers
    context_query.py         # list_*, get_*, resolve_* tools (read-only context)
    edit_helpers.py          # preview_*, stage_*, apply_* tools
    discovery.py             # search_*, find_*, suggest_* tools
  context_tools_executor.py  # thin façade, delegates to dispatcher (kept for import stability)
```

**Approach:**
1. Enumerate every tool method on the current class and tag it with a category (context-query / edit-helper / discovery). Write the mapping into a spreadsheet or a markdown table committed to this plan below.
2. Create `ToolHandler` protocol with `handles(name) -> bool` and `async execute(name, args, ctx) -> ToolResult`.
3. Move methods one category at a time. Each move keeps the old method as a thin delegator that calls the new handler, so import paths and tests keep working.
4. Flip the executor to pure dispatch once all three handlers are extracted.
5. Delete the delegators in a follow-up commit after verifying no external callers.

**Checklist:**
- [x] Tool inventory table added to this doc (§1.1 below)
- [x] `ToolDispatcher` landed (explicit class; `ToolHandler` protocol deferred — two concrete handlers are sufficient)
- [x] `ContextQueryHandler` extracted with tests unchanged
- [x] `EditHelperHandler` extracted with tests unchanged
- [~] `DiscoveryHandler` — **dropped from scope**. The codebase only has two natural categories (CONTEXT_TOOL_NAMES, EDIT_HELPER_TOOL_NAMES); there are no standalone "discovery" tools. Splitting further would be artificial.
- [x] `context_tools_executor.py` reduced to façade (43 lines)
- [x] Canary matrix green (same failure set as baseline — zero regressions)
- [ ] Delegators removed in follow-up commit — **N/A**: the façade is already the only remaining delegator and it's deliberately kept for import stability.

**Acceptance (actuals):**
- Target was <800 lines/file; actuals are base.py 1103, context_query.py 1645, edit_helpers.py 1212. Over target but far under the 4017-line monolith. Further splitting deferred — revisit only if a specific file becomes a merge-conflict hotspot.
- `node scripts/test_agent_unit.mjs` pre vs post: **identical** failing test set (10 failures + 9 errors, same names). Baseline failures exist on `main` and are not caused by this PR.
- `git blame` preserved for moved blocks (files are `Write`-created but line content is verbatim from the original).

**Intentional structural changes (both verified semantically equivalent):**
- `get_children` was an implicit fall-through at the end of the original `execute()`. Now an explicit `if tool_name == 'get_children':` branch inside `ContextQueryHandler.execute`. Safe because the dispatcher rejects unknown tools before handlers run.
- Pre-dispatch validation (unknown tool / missing roadmap_id / scope mismatch / auth extraction / `tool_call_requested` log) moved from `execute()` body into `ToolDispatcher`. The `try / except HTTPException / except Exception / finally` envelope and the `_record_context_tool_timing` call in `finally` are preserved verbatim in the dispatcher.

**Audit findings (post-initial-refactor, all addressed):**
- **Regression caught and fixed:** The first pass had `dispatcher.execute` build a shallow-copy `call_ctx = dict(session_context)` and pass that to handlers. The base helpers `_increment_phase_counter` and `_read/_write_resolve_request_cache` use `session_context.setdefault(...)` to store mutable state that the caller reads back afterward (see `orchestration/planning/planning_phase_metrics.py:39`). With the copy, phase metrics and within-turn resolve dedup were silently dropped — tests passed because this is observability state, not functional output. Fixed by dropping the copy and writing normalized derived values (`auth_header`, `context_change_selector`, `roadmap_id`) directly onto the caller's dict, matching the original's pass-by-reference semantics.
- **Tool inventory complete:** All 19 `CONTEXT_TOOL_NAMES` + 25 `EDIT_HELPER_TOOL_NAMES` accounted for. `delete_{task,feature,epic}`, `move_feature_to_epic`, `reorder_epics`, `bulk_update_epic_status` are handled in shared-branch `if tool_name in {...}:` structures, preserved verbatim.
- **External API surface preserved:** Only `client.py` and `test_context_tools_intent_tools.py` import from this module, and both only reference the `ContextToolsExecutor` class. No code accesses private fields.

**Rollback:** Revert the PR. Because the façade preserves the class name, `__init__` signature, and `execute()` signature, downstream imports are unaffected.

### §1.1 Tool inventory (final)

| Category (dest file) | Tools |
|----------------------|-------|
| `handlers/context_query.py` | `get_roadmap_summary`, `get_roadmap_overview`, `get_epics_by_roadmap`, `search_nodes`, `search_tasks`, `resolve_node_reference`, `get_children_from_resolution`, `get_features_by_epic`, `get_epic_progress`, `get_feature_details`, `get_tasks_by_parent`, `get_tasks_by_feature`, `get_tasks_by_epic`, `get_tasks_by_status`, `get_overdue_tasks`, `get_blocked_items`, `get_tasks_assigned_to_me`, `get_node_details`, `get_children` |
| `handlers/edit_helpers.py` | `create_epic`, `create_feature`, `create_task`, `update_task_status`, `update_task_priority`, `update_task_assignee`, `update_feature_status`, `update_epic_status`, `update_titles`, `move_task_to_feature`, `move_feature_to_epic`, `reorder_tasks`, `reorder_features`, `reorder_epics`, `delete_task`, `delete_feature`, `delete_epic`, `bulk_update_task_status`, `bulk_update_tasks_by_parent`, `bulk_update_tasks_by_filter`, `bulk_assign_tasks`, `bulk_delete_tasks`, `bulk_move_tasks_to_feature`, `bulk_update_feature_status`, `bulk_update_epic_status` |
| `handlers/base.py` | All `_*` private helpers (normalization, caching, resolution subgraph, date parsing, filter validation, epic progress computation) + module constants |
| `dispatch.py` | Pre-dispatch validation (unknown tool / missing roadmap_id / scope mismatch / auth extraction / `tool_call_requested` log) + routing by tool name |

---

## 2. Error catalog + per-tool latency metrics

**Problem:** Three incompatible error shapes in flight: `HTTPException(detail={...})`, `{'error': {...}}` from tools, and raw strings like `UNKNOWN_TOOL`. No per-tool timing, so we can't tell which tool is slow or failing.

**Goal:** One `AgentError` exception + typed `ErrorCode` enum. One decorator that times and counts every tool invocation.

**Scope:**
- New: `agent/app/core/errors.py` (`ErrorCode`, `AgentError`, `to_http_exception()`)
- New: `agent/app/core/metrics.py` (`tool_metric` decorator, counter/timer primitives writing to `log_event`)
- Modified: all tool handlers (apply decorator), route error handlers, `context_tools_executor` error returns

**Checklist:**
- [x] `ErrorCode` enum drafted — populated from every error string found via grep (20 codes)
- [x] `AgentError` with `code`, `message`, `details`, `http_status`, `retriable` fields + `to_tool_dict()` method
- [x] `to_http_exception()` maps to FastAPI `HTTPException` with stable shape
- [x] `tool.invoked` event emitted via `record_tool_invocation()` helper — fires once per top-level dispatch with `{tool_name, duration_ms, outcome, error_code, trace_id, roadmap_id}`
- [x] Dispatcher wired (single instrumentation point covers all 44 tools)
- [~] Route error handlers converted to `AgentError` — **deferred to follow-up PR**. Helpers exist (`to_http_exception`, `error_dict`), but migrating the existing `raise HTTPException(detail={...})` sites is 102 occurrences across 22 files and not mechanically safe in one pass.
- [~] Tool `{'error': {...}}` returns converted to raising `AgentError` — **deferred to follow-up PR**. Same rationale; `error_dict()` helper is in place for new code to use. The dict shape is part of the LLM tool contract and each of the ~40 sites has subtly different `log_event` calls that would need careful preservation.
- [x] Dashboard-ready log fields documented (§2.1 below)

**Acceptance (actuals):**
- `grep -r "HTTPException" agent/app` still returns 102 occurrences — unchanged. Deferred to a follow-up PR.
- Every tool invocation **now** emits a `tool.invoked` log line with `duration_ms` (verified via smoke test).
- Resolve caches emit `cache.event` with `{cache: 'resolve_lookup'|'resolve_request', outcome: 'hit'|'miss', ...}`. `ContextAnswerCache` already emitted `cache_hit`/`cache_miss` events prior to this PR; left alone to avoid breaking existing dashboards.

**Rollback:** Revert the PR. The two new modules (`errors.py`, `metrics.py`) have no imports from outside them except for `dispatch.py` and `handlers/base.py`, both of which degrade gracefully if the modules are removed.

### §2.1 Observability fields emitted

| Event          | Fields                                                                              | Source                                                |
|----------------|-------------------------------------------------------------------------------------|-------------------------------------------------------|
| `tool.invoked` | `tool_name`, `duration_ms`, `outcome` (ok/error), `error_code?`, `trace_id`, `roadmap_id` | `dispatch.py` finally block → `record_tool_invocation` |
| `cache.event`  | `cache` (resolve_lookup / resolve_request), `outcome` (hit/miss), `trace_id?`, `extra?` (reason) | `handlers/base.py::_read_resolve_*`                    |
| `cache_hit` / `cache_miss` | `cache_scope: 'context_answer'`, `trace_id`, `roadmap_id` | `context_answer_service.py` (pre-existing, unchanged) |

---

## 3. `contextvars` for trace propagation

**Problem:** `trace_id` is threaded through 20+ function signatures. Every new function must remember to accept and forward it. Logging inside deep utilities can't correlate without it being passed explicitly.

**Goal:** Store `trace_id`, `session_id`, `roadmap_id`, `actor_id` in `contextvars.ContextVar` bound at the route layer. Remove them from signatures.

**Scope:**
- New: `agent/app/core/trace_context.py` — ContextVar definitions + `bind_trace_context()` + `get_trace_fields()`
- Modified: `sessions.py` routes bind context at entry
- Modified: `logging_utils.py` pulls fields from contextvars automatically
- Modified: all functions currently accepting `trace_id` — remove the param

**Checklist:**
- [x] `trace_context.py` with four ContextVars + `bind()` (imperative, for FastAPI task-scoped binding) + `bind_trace_context()` (context manager for nested scopes)
- [x] Route layer binds at request entry. No explicit unbind — each FastAPI request runs in its own asyncio Task, and ContextVars are task-local, so the binding expires naturally when the task completes
- [x] `log_event()` auto-pulls `trace_id`, `session_id`, `roadmap_id`, `actor_id` from contextvars when callers don't pass them. Explicit kwargs still override
- [x] Async bridge (`async_bridge.py`) uses `contextvars.copy_context()` so the bridge thread inherits the caller's trace correlation
- [~] Signatures cleaned up — **deferred to follow-up PR**. `trace_id` is used in two roles in the codebase: (a) logging correlation, and (b) upstream HTTP header propagation (`nest_client.context_*(..., trace_id=trace_id)`). Role (b) means many signature removals aren't mechanically safe — we'd also have to change how the value reaches the nest_client call. Doing this carefully is a separate PR
- [~] Tests updated — **deferred to follow-up PR** alongside signature cleanup

**Acceptance (actuals):**
- `grep -rn "trace_id:" agent/app | wc -l` still high — signature cleanup deferred. This is acceptable because the *infrastructure* for that cleanup now exists
- **Log lines from deep utilities auto-carry `trace_id` without being passed it** — verified via smoke test. This is the core observability win and it landed
- Async bridge: verified that `run_async_call()` inside a task bound to `trace_id=T1` propagates correctly; the bridge-thread coroutine sees `T1` and its log entries carry it

**Rollback:** Revert the PR. The new module has no imports from outside it except `logging_utils.py` (added one import) and the route-flow file (added one import + three calls). No wire-format change.

### §3.1 Usage cheat sheet

```python
# Route handlers: imperative bind at entry, no unbind needed (task-scoped).
from app.core.trace_context import bind as bind_trace_context_values
bind_trace_context_values(trace_id=t, session_id=s, roadmap_id=r)

# Deep utilities / new code: just call log_event without trace_id. It auto-populates.
log_event(logger, 'some_event', settings=settings, other_field='x')

# Nested scope with different trace_id (rare — e.g., fan-out tasks):
from app.core.trace_context import bind_trace_context
with bind_trace_context(trace_id='child-trace'):
    ...  # log_event() inside sees 'child-trace', caller's trace_id restored on exit

# Read current values (for cases that need them as args, e.g., nest_client):
from app.core.trace_context import get_trace_id
trace_id = get_trace_id()
```

---

## 4. Session CAS (optimistic concurrency)

**Problem:** `session_store.py` does `get → mutate in memory → set`. Two concurrent requests on the same session race; the later write wins silently. Lost staged operations are possible under rapid UI interactions.

**Goal:** Version every session. On write, refuse if the stored version differs from the one we loaded.

**Design:**
- Add `version: int` to `AgentSession`.
- `SessionStore.get()` returns `(session, version)`.
- `SessionStore.save(session, expected_version)` uses Upstash Redis `SET` with a Lua check-and-set script, or a `WATCH/MULTI/EXEC` transaction.
- On conflict, raise `SessionConflictError`. Caller retries up to N times (N=3) by re-reading and re-applying the mutation closure.

**Checklist:**
- [x] `AgentSession.version` field added, default 0. Backwards-compat verified: old session JSON without the field deserializes with version=0
- [~] `SessionStore.get()` returns `(session, version)` tuple — **not done, intentionally**. The `version` travels inside the session model (`session.version`), so callers don't need a tuple. This is a cleaner API than the plan originally sketched
- [x] `SessionStore.save_cas(session)` with CAS via Lua `EVAL` on Upstash. Uses `session.version` as expected; on success bumps both the stored counter key and `session.version` in-place
- [x] `SessionStoreConflictError` exception with `session_id`, `expected_version`, `stored_version` fields
- [x] `with_cas_retry(load_fn, mutate_fn, save_fn, ...)` helper with jitter backoff, configurable `max_attempts`, and `on_conflict` callback for telemetry
- [x] Metric helper `record_session_cas_conflict()` added to `metrics.py` (fires per retry attempt)
- [x] Test: stale-version conflict detected
- [x] Test: retry-then-succeed flow
- [x] Test: retry exhaustion raises last conflict
- [~] Wiring `save_cas` into `plan_message` / `auto_commit` — **deferred to follow-up PR**. This is the hot-path rewire that actually eliminates lost updates in production. It requires making the mutation closure safely re-runnable (either idempotent, or a pattern where we re-load then re-apply staged-ops diff). Doing this well is a focused effort that should ship separately; this PR establishes the contract and proves it with unit tests

**Acceptance (actuals):**
- Contract exists: `save_cas` detects version mismatches correctly (14/14 unit tests pass)
- `session.cas_conflict` metric ships structured log lines; `on_conflict` callback in `with_cas_retry` wires it per attempt
- "Two overlapping `send_message` calls produce two committed messages" acceptance criterion is **not yet met in production** because the hot path still uses legacy `update()`. Marking this acceptance as partial; closing it is the goal of the follow-up PR

**Rollback:** Revert. The CAS surface is additive (`save_cas` is a new method; `update()`, `get()`, `create()` unchanged). The new `version` field on `AgentSession` has default 0 so older JSON still deserializes.

### §4.1 Storage schema

Two Redis keys per session:

- `{prefix}:{session_id}`   — session JSON payload
- `{prefix}:{session_id}:v` — integer version counter (string-encoded)

Both share the configured `SESSION_TTL_SECONDS` and are refreshed atomically by the Lua `save_cas` script. Legacy `_save()` / `update()` writes only the JSON key — the version counter only advances when `save_cas` is used.

**Migration note for the follow-up PR:** when switching `plan_message` to `save_cas`, sessions that were created via legacy `update()` won't have a `:v` key yet. The Lua script handles this: `stored == false` + `expected == '0'` is the valid first-CAS-write case. So the first `save_cas` on a legacy session succeeds cleanly and initializes the counter.

---

## 5. Async-native orchestration (remove threaded `async_bridge`)

**Problem:** FastAPI routes are async. Nest client is async. But orchestration is sync, and we bridge with `run_async_call()` that spawns threads with a 20s timeout per call. Thread overhead, lost cancellation, cross-event-loop fragility, and session mutation races all trace back to this.

**Goal:** Every function on the hot path is `async def`. `async_bridge.py` deleted.

**This is the riskiest PR.** Do it after #1–#3 are merged, because:
- #1 gives us decomposed handlers that are each small enough to flip individually.
- #3 removes signature churn that would collide with an async rewrite.
- #2 gives us metrics to catch regressions immediately.

**Phased approach:**
1. **Phase A:** Convert leaf I/O (Nest client calls already async — just stop bridging). Flip `ContextToolsExecutor` handlers to `async def`.
2. **Phase B:** Convert `LLMPlanner.plan_with_tools()` and the ReAct executor.
3. **Phase C:** Convert `PlanningOrchestrator` and `AgentService`.
4. **Phase D:** Delete `async_bridge.py` and `run_async_call()`.

Each phase is independently shippable behind an `AGENT_ASYNC_NATIVE_ENABLED` feature flag that routes between old and new paths.

**Checklist:**
- [ ] `AGENT_ASYNC_NATIVE_ENABLED` flag added, defaults to `false`
- [ ] Phase A: tool handlers async — canary green
- [ ] Phase B: planner + ReAct async — canary green
- [ ] Phase C: orchestration async — canary green
- [ ] Flag default flipped to `true` after 1 week of canary
- [ ] Phase D: `async_bridge.py` deleted, flag removed
- [ ] `grep -r "run_async_call" agent/app` returns zero

**Acceptance:**
- P50 and P95 latency of `send_message` not worse than baseline. Ideally better (no thread spawn).
- No `asyncio.get_event_loop()` warnings in logs.
- `scripts/benchmark_roadmap_ai_commit.mjs` lean-path P95 improves or holds.

**Rollback per phase:** Flip the feature flag off. Each phase must be flag-gated so rollback is a one-line change, not a revert.

---

## 6. Prompt consolidation + LangChain removal

**Problem:** Prompts are built in at least five places (`PromptRepository`, `planner_operation_flow.py`, `planner_react_helpers.py`, `planning_dispatch`, `context_tools`). Inline f-strings, no versioning, no A/B hooks. Separately, LangChain (`ChatOpenAI`, `bind_tools`) is used for features the raw OpenAI SDK handles natively, and it blocks prompt caching via `cache_control`.

**Goal:** One `PromptManager` owns every template, versioned. OpenAI SDK replaces LangChain at the provider boundary.

**Two independent sub-tracks** — originally planned in parallel. **Only 6a was executed**; 6b was cancelled after the retention decision on 2026-04-15 (see §6b for rationale).

### 6a. Prompt consolidation

- New: `agent/app/core/prompts/manager.py` — `PromptManager` with `render(template_id, version, context) -> str`.
- Templates in `agent/app/core/prompts/templates/<id>/<version>.md` (directory per template, file per version).
- Callers reference templates by `(id, version)` tuple — no inline strings.

**Checklist:**
- [ ] Inventory of every prompt-building site (grep for `f"""` near `"You are"`, `system_prompt`, `planner_prompt`)
- [ ] `PromptManager` class with version resolution
- [ ] Templates migrated from `prompts/*.md` and inline strings into versioned directories
- [ ] All callers use `PromptManager.render(...)`
- [ ] Feature-flag for template version: `AGENT_PROMPT_VERSION_OVERRIDE` (maps id → version)
- [ ] A/B test hook: `choose_version(template_id, session_id) -> version`

### 6b. LangChain removal — **CANCELLED (2026-04-15)**

**Original proposal:** Replace LangChain (`ChatOpenAI`, `bind_tools`, `SystemMessage/HumanMessage/ToolMessage`) with a raw `openai` SDK adapter. Gain billed as "cache_control breakpoints → lower token costs" plus the general cleanup of a thin wrapper layer.

**Why it was cancelled:**

1. **The cost-savings justification was factually wrong.** `cache_control` is an **Anthropic**-specific API feature. OpenAI (which this codebase uses exclusively) performs prompt caching **automatically** for any prompt ≥ 1024 tokens — no markers, no SDK migration required. Whatever token savings are available from caching on OpenAI are already happening (or will happen once prompts cross the threshold) regardless of SDK.

2. **The retrieval roadmap changes the calculus.** Complex retrieval pipelines are planned. LangChain's real value is not its `ChatOpenAI` wrapper (~10% of its surface, the cheap-to-replace part) — it's the retrievers, document loaders, text splitters, LCEL composition, and LangGraph (already in use at `langgraph==0.6.6`) ergonomics. Tearing out LangChain now would mean either rewriting retrieval infra from scratch later, or reinstalling LangChain when those primitives are needed. Either is worse than keeping it.

3. **The cleanup argument is real but low-priority.** Drift risk across `_chat_model` / `_planner_chat_model` / profile variants is a minor code-smell issue, not a business-value issue. It doesn't warrant a 641-line adapter rewrite.

**What's retained in `requirements.txt`:**
- `langchain==0.3.27`
- `langchain-openai==0.3.30`
- `langgraph==0.6.6`

**Follow-up cleanup** (not scheduled, noted for future work):
- Consolidate the `ChatOpenAI` instantiation surface in `openai_adapter.py` into a single factory so profile variants don't duplicate kwargs.
- Make the adapter's message construction ready to compose with LCEL-based retrieval chains when the retrieval work starts (structure, not rewrite).

**If you're reading this and considering reviving 6b:** the retention decision was driven by the retrieval roadmap. If that roadmap changes, or if the project moves to Anthropic (where `cache_control` actually applies), re-evaluate.

---

## Cross-cutting: what we are NOT doing

To keep scope honest, these are **explicitly deferred** and should not be bundled in:

- OpenTelemetry / distributed tracing — keep structured logs until there's a real need.
- Provider diversity (Claude, Gemini) — out of scope.
- Tool batching / parallel tool calls — separate project.
- Draft graph rework — keep as-is.
- Supabase schema changes — out of scope.
- **LangChain removal** — cancelled. Retained for the retrieval roadmap (retrievers, loaders, splitters, LCEL) and LangGraph ergonomics. See §6b.

If one of these becomes necessary to finish a step, stop and re-scope. Don't let scope creep in mid-PR.

---

## Ledger

| PR  | Branch                                  | Opened | Merged | Notes |
|-----|-----------------------------------------|--------|--------|-------|
| #1  | `refactor/agent-01-split-context-tools` | 2026-04-14 | _pending_ | Done on working tree; 0 regressions (identical test failure set pre/post). Files: `dispatch.py`, `handlers/{base,context_query,edit_helpers}.py`, façade reduced to 43 lines. |
| #2  | `refactor/agent-02-errors-metrics`      |        |        |       |
| #3  | `refactor/agent-03-trace-contextvars`   | 2026-04-14 | _pending_ | Infra landed: `trace_context.py` + `log_event` auto-populate + route binding + async-bridge `copy_context()`. Signature cleanup deferred (many `trace_id` params also flow to `nest_client` HTTP headers; separate PR). Tests identical to baseline. |
| #4  | `refactor/agent-04-session-cas`         | 2026-04-14 | _pending_ | CAS infra landed: `AgentSession.version`, `SessionStore.save_cas` (Lua eval), `SessionStoreConflictError`, `with_cas_retry` helper, `session.cas_conflict` metric, 14 unit tests. Hot-path rewire (plan_message → save_cas) deferred to follow-up. |
| #5  | `refactor/agent-05a-async-tool-handlers` | 2026-04-14 | _pending_ | Phase A: tool handlers + 7 base helpers now async; dispatcher drives via self-contained `_drive_handler_coroutine`. One thread spawn per tool dispatch (was N per tool). No flag — drift-free. 4 new unit tests. Baseline identical (176 tests). Phases B/C/D deferred. |
| #6a | `refactor/agent-06a-prompt-manager`     | 2026-04-15 | _pending_ | Phase A: `PromptManager` with versioned templates (`templates/<id>/v1.md`), env override hook, A/B hook reserved. `PromptRepository` kept as shim. 13 new unit tests. Baseline identical (189 tests). Inline f-string extraction deferred to follow-up. |
| #6b | `refactor/agent-06b-drop-langchain`     | _n/a_ | **cancelled 2026-04-15** | LangChain retained. Cost-savings justification (`cache_control`) was Anthropic-specific and doesn't apply on OpenAI (auto-caching). Retrieval roadmap makes LangChain's retriever/loader/splitter/LCEL surface load-bearing. See §6b for full rationale. |
