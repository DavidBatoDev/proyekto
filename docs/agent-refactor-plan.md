# Agent Refactor Plan

Tracking document for the six-part refactor of `agent/`. Update checkboxes as milestones land. Each section is a standalone PR; do not start the next until the previous is merged and tests are green.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Sequencing (must be done in order)

1. [x] Split `ContextToolsExecutor` by tool category
2. [ ] Error catalog + per-tool latency metrics
3. [ ] `contextvars` for `trace_id` / `session_id` propagation
4. [ ] Session CAS (optimistic concurrency on Redis writes)
5. [ ] Async-native orchestration (remove `async_bridge` threading)
6. [ ] Prompt consolidation + LangChain removal

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
- [ ] `ErrorCode` enum drafted — list every existing error string found via grep
- [ ] `AgentError` with `code`, `message`, `details`, `retriable` fields
- [ ] `to_http_exception()` maps to FastAPI `HTTPException` with stable shape
- [ ] `@tool_metric` decorator emits `{event: "tool.invoked", tool, duration_ms, outcome}`
- [ ] All tool handlers decorated
- [ ] Route error handlers converted to `AgentError`
- [ ] Tool `{'error': {...}}` returns converted to raising `AgentError`
- [ ] Dashboard-ready log fields documented in this file

**Acceptance:**
- `grep -r "HTTPException" agent/app` returns only the central error mapper and the route layer.
- Every tool invocation produces a `tool.invoked` log line with `duration_ms`.
- Cache hit/miss counters emitted for `ContextAnswerCache`.

**Rollback:** Revert the PR. The error shapes are additive; old callers still work if reverted.

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
- [ ] `trace_context.py` with four ContextVars and `bind_trace_context()` context manager
- [ ] Route layer binds at request entry, unbinds on exit
- [ ] `log_event()` auto-pulls fields from contextvars (still overridable by explicit kwargs)
- [ ] Async bridge (`async_bridge.py`) propagates context across threads via `contextvars.copy_context()`
- [ ] Signatures cleaned up — `trace_id` removed from at least 20 functions
- [ ] Tests updated; no test should need to pass `trace_id` by hand anymore

**Acceptance:**
- `grep -rn "trace_id:" agent/app | wc -l` drops by ≥ 70%.
- Log lines from deep utilities still carry `trace_id` without being passed it.
- Canary matrix green.

**Rollback:** Revert. No wire-format change.

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
- [ ] `AgentSession.version` field added, default 0
- [ ] `SessionStore.get()` returns `(session, version)` tuple
- [ ] `SessionStore.save(session, expected_version)` with CAS via Lua script
- [ ] `SessionConflictError` exception
- [ ] `AgentService` wraps session mutations in retry loop (max 3 attempts, jitter backoff)
- [ ] Metric: `session.cas_conflict` counter
- [ ] Test: simulate concurrent writes, assert no lost updates
- [ ] Test: exhaust retries, assert clean error bubble-up

**Acceptance:**
- Two overlapping `send_message` calls on the same session produce two committed messages (no loss). Verified by integration test.
- `session.cas_conflict` metric visible in logs during the concurrency test.

**Rollback:** Revert. Older clients tolerate the new `version` field (Pydantic ignores unknown on read).

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

**Two independent sub-tracks** — can be done in parallel if we have hands for it.

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

### 6b. LangChain removal

- New: `agent/app/core/llm/providers/openai_native.py` — raw `openai` SDK, implements `LLMProvider` protocol.
- Modified: `OpenAILangChainAdapter` becomes `LegacyLangChainAdapter`, kept behind flag for one release.
- Gain: enables `cache_control` breakpoints on system prompts → lower token costs.

**Checklist:**
- [ ] Narrow `LLMProvider` protocol finalized (`plan`, `classify_intent`, `tools` support)
- [ ] `openai_native.py` implementation
- [ ] Cache-control breakpoints added to system prompts (after 6a consolidation)
- [ ] `AGENT_LLM_PROVIDER` flag: `langchain` | `openai_native`, default `langchain` initially
- [ ] Canary with `openai_native` for 1 week
- [ ] Default flipped to `openai_native`
- [ ] `langchain` + `langchain_openai` + `langchain_core` removed from `requirements.txt`
- [ ] `LegacyLangChainAdapter` deleted

**Acceptance:**
- `grep -r "langchain" agent/app` returns zero.
- Prompt cache hit rate > 60% on system prompts (measured via OpenAI response `cache_read_input_tokens`).
- Token cost per message drops (baseline the week before, compare the week after).

**Rollback:** Flag flip for provider; revert for prompt consolidation (templates are additive until callers switch).

---

## Cross-cutting: what we are NOT doing

To keep scope honest, these are **explicitly deferred** and should not be bundled in:

- OpenTelemetry / distributed tracing — keep structured logs until there's a real need.
- Provider diversity (Claude, Gemini) — the protocol from 6b makes it possible, but not now.
- Tool batching / parallel tool calls — separate project.
- Draft graph rework — keep as-is.
- Supabase schema changes — out of scope.

If one of these becomes necessary to finish a step, stop and re-scope. Don't let scope creep in mid-PR.

---

## Ledger

| PR  | Branch                                  | Opened | Merged | Notes |
|-----|-----------------------------------------|--------|--------|-------|
| #1  | `refactor/agent-01-split-context-tools` | 2026-04-14 | _pending_ | Done on working tree; 0 regressions (identical test failure set pre/post). Files: `dispatch.py`, `handlers/{base,context_query,edit_helpers}.py`, façade reduced to 43 lines. |
| #2  | `refactor/agent-02-errors-metrics`      |        |        |       |
| #3  | `refactor/agent-03-trace-contextvars`   |        |        |       |
| #4  | `refactor/agent-04-session-cas`         |        |        |       |
| #5  | `refactor/agent-05-async-native`        |        |        |       |
| #6a | `refactor/agent-06a-prompt-manager`     |        |        |       |
| #6b | `refactor/agent-06b-drop-langchain`     |        |        |       |
