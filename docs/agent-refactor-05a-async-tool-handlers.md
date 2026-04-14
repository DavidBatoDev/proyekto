# #5 Phase A — Async tool handlers (no flag)

Tracking document for Phase A of the async-native orchestration refactor. Phases B, C, and D are scoped in the parent plan (`agent-refactor-plan.md` §5).

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Goal (Phase A only)

Make tool handlers async-native in a single pass, **without a feature flag**. The dispatcher's public sync `execute()` becomes a boundary adapter: it wraps the async handler call with `asyncio.run()` (no running loop) or falls back to `run_async_call` (already in a loop, i.e. called by the still-sync orchestration layer).

**Why no flag** (changed from the first draft):
- The repo already has 16+ `AGENT_*` flags. Flag fatigue is real.
- A flag creates two maintained code paths → drift risk. The mitigation for drift (parity tests) is our real safety net — so do that without also paying the flag tax.
- If we can't prove parity before merge, we shouldn't ship. Flags are not a substitute for validation.

### The actual win

Today, a single tool call (e.g. `resolve_node_reference`) spawns **N threads** via `run_async_call` — one per inner `nest_client` request variant, sometimes 3–5 per tool. Multiply by ~5 tool calls per message = 15–25 threads per user turn.

After this PR, a tool call spawns **at most one thread** — the boundary adapter at dispatcher entry. All inner nest calls run on that single event loop via `await`. Phase C deletes even that one.

## Scope

**In scope:**
- Handler `execute()` methods become `async def`. Sync versions deleted.
- `_run_context_call` / `_run_context_calls_parallel` on `ToolHandlerBase` become async. Sync versions deleted.
- Dispatcher's `ToolDispatcher.execute()` stays sync at the outer interface. Internally calls `_run_async_handler(...)` which awaits the async handler, entering a loop via `asyncio.run` or the existing bridge.
- `tool.invoked` metric gets a new `async_inner: bool` field (always `true` after this PR; kept as a field so Phase B/C toggles are visible later).
- Parity tests on 3 representative tools: `get_roadmap_summary`, `resolve_node_reference`, `create_epic`.

**Not in scope (Phase B/C/D):**
- Making `ContextToolsExecutor.execute()` itself async. The sync orchestration layer above still calls it sync.
- Converting `LLMPlanner` / `AgentService` / `planning_orchestrator`.
- Deleting `async_bridge.py`. It's still the fallback at the dispatcher boundary.

## Design

### `_run_async_handler` helper (on dispatcher)

Single entry point the sync `ToolDispatcher.execute` uses to drive the async handlers. Psuedocode:

```python
def _run_async_handler(self, coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        # No loop — we're the outermost sync caller. Own the loop.
        return asyncio.run(coro)
    # A loop is running (orchestration layer is still sync but called
    # from an async context via run_async_call elsewhere). Bridge it.
    return run_async_call(coro, settings=self._settings, logger=self._logger)
```

This one helper is the ONLY place the bridge appears in the tool path. Per tool dispatch, at most one thread spawn.

### Handler changes

Each of the two handlers: change `def execute(...)` → `async def execute(...)`. Every `self._run_context_call(session_context, coro)` becomes `await self._run_context_call(session_context, coro)`. Same for the parallel variant.

Mechanical. Don't refactor bodies — just change the two call shapes.

### Base helpers

`handlers/base.py`:

- `_run_context_call(self, session_context, coro) -> dict` → `async def _run_context_call(self, session_context, coro) -> dict`. Body becomes:
  ```python
  started = perf_counter()
  try:
      result = await coro
      return result if isinstance(result, dict) else {}
  except HTTPException as exc:
      return self._map_upstream_context_error(exc)
  finally:
      self._record_context_http_timing(session_context, (perf_counter() - started) * 1000)
  ```
  (Preserving the existing behavior of that method, only swapping thread-bridge for direct await.)
- `_run_context_calls_parallel(self, session_context, coros) -> list[dict]` → `async def`, uses `asyncio.gather(*coros, return_exceptions=True)` with the same error-mapping.

### Dispatcher

`ToolDispatcher.execute` stays sync. After pre-dispatch validation, route:
```python
if tool_name in CONTEXT_TOOL_NAMES:
    result = self._run_async_handler(
        self._context_handler.execute(tool_name, args, session_context)
    )
```
The `.execute(...)` call now returns a coroutine; `_run_async_handler` awaits it.

### Metrics

Add `async_inner=True` to the `tool.invoked` log. This is a constant for this PR but documents the path in dashboards. When Phase B/C convert more of the stack, new fields will appear (`async_outer`, etc.). Explicit > implicit.

## Tests

`tests/test_async_native_dispatcher.py`:

1. **No-loop caller → `asyncio.run` path.** Mock nest client with `AsyncMock`; call `ContextToolsExecutor.execute('get_roadmap_summary', ...)` from plain sync code; assert result shape matches expectations; assert `run_async_call` was NOT invoked.
2. **In-loop caller → bridge path.** Wrap the sync call inside `asyncio.run(outer())` where `outer` calls `executor.execute(...)` via `asyncio.to_thread`; assert `run_async_call` IS invoked.
3. **HTTPException from nest client maps to error dict** — same shape as pre-PR.
4. **Parallel variant** — two inner coros, one succeeds, one raises HTTPException; `return_exceptions=True` preserves both.
5. **`tool.invoked` carries `async_inner=True`**.

Parity tests (`tests/test_async_native_parity.py`):
- Run `get_roadmap_summary`, `resolve_node_reference`, `create_epic` with a fake nest client that returns deterministic payloads. Assert each result dict is byte-identical to the reference payloads captured pre-PR. No flag toggle needed — we compare against fixed expected output.

Full suite (`node scripts/test_agent_unit.mjs`) must show the same failure set as baseline.

## Checklist

- [ ] `_run_context_call` / `_run_context_calls_parallel` on `ToolHandlerBase` converted to `async def`
- [ ] `handlers/context_query.py::ContextQueryHandler.execute` → `async def`, all `self._run_context_call(...)` → `await self._run_context_call(...)`
- [ ] `handlers/edit_helpers.py::EditHelperHandler.execute` → `async def`, same mechanical swap
- [ ] `ToolDispatcher._run_async_handler` helper added
- [ ] `ToolDispatcher.execute` routes handler calls via `_run_async_handler`
- [ ] `tool.invoked` log line gains `async_inner=True` field
- [ ] Unit tests: 5 cases above
- [ ] Parity tests: 3 representative tools
- [ ] Full test suite: identical failure set to baseline
- [ ] Existing `test_context_tools_intent_tools.py` still 39/39 green (it exercises the sync entry point; any regression surfaces here immediately)

## Acceptance

- `ContextToolsExecutor.execute()` outer API is unchanged — signature, return shape, exception behavior all identical.
- A tool call that previously spawned N bridge threads (one per inner nest call) now spawns at most one.
- Pre-existing tests pass without modification.
- Parity tests prove sync-path-pre-PR output == async-path-post-PR output for 3 representative tools.

## Rollback

Revert the PR. There's no flag to flip. The change is contained to the dispatcher + two handler files + base helpers; nothing outside that surface depends on the internals we're changing.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| `asyncio.run` called from a thread that already has an event loop associated | `_run_async_handler` detects via `get_running_loop()` + `RuntimeError` — standard idiom. Covered by unit test #2. |
| `asyncio.gather(return_exceptions=True)` in the parallel helper returns a mix that downstream code doesn't expect | Downstream code already handled exceptions via the sync helper's try/except wrapping per-call; the `return_exceptions` shape is mapped to the same `{'error': {...}}` dict inline, preserving the caller contract. Covered by unit test #4. |
| Event-loop policy on Windows differs | `asyncio.run` uses the default policy; no explicit policy change. Tests run on Windows in this repo; if a Proactor-specific issue surfaces, add `asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())` at module init — but don't preemptively. |
| A handler-internal mutation of `session_context` behaves differently under async | Session context is the same dict reference; mutation semantics unchanged. The #1 audit fix (pass-through without copy) continues to apply. |
| A mock in existing tests was patching `self._run_context_call` and now gets an `AsyncMock`-incompatible signature | Search the test tree for any such patches before landing. Fix call sites to use `AsyncMock` if found. |

## Ledger

| Step                                               | Status | Notes |
|----------------------------------------------------|--------|-------|
| Base helpers: `_run_context_call` async            | [x]    | Added defensive coro/value fallback for sync test mocks |
| Base helpers: `_run_context_calls_parallel` async  | [x]    | `asyncio.gather(..., return_exceptions=True)` inline |
| 7 sync helpers cascaded to async                   | [x]    | `_resolve_epic_fuzzy_fallback_matches`, `_build_resolve_unique_subgraph`, `_resolve_subgraph_parent`, `_resolve_subgraph_children`, `_collect_tasks_for_epic`, `_collect_tasks_for_roadmap`, `_compute_epic_progress` |
| `ContextQueryHandler.execute` async                | [x]    | 19 `await self._run_context_call`, 3 `await self._run_context_calls_parallel`, 8 await prefixes on cascaded helpers |
| `EditHelperHandler.execute` async                  | [x]    | 2 `await self._run_context_call`, 1 parallel, 2 helper awaits |
| Dispatcher `_drive_handler_coroutine` + routing    | [x]    | Self-contained adapter: `asyncio.run` if no loop, else `run_async_call` bridge. `run_async_context_call` kwarg kept for backcompat but no longer used. |
| `tool.invoked` carries `async_inner=True`          | [x]    | Added to `record_tool_invocation` signature |
| Unit tests (4 cases)                               | [x]    | `test_async_native_dispatcher.py`: no-loop, in-loop (bridge routing), sync-mock fallback, async_inner field |
| Full suite parity                                  | [x]    | 176 tests, identical 10F+9E baseline |
| `test_context_tools_intent_tools` still green      | [x]    | 39/39 OK |
| Added to default test runner                       | [x]    | `scripts/test_agent_unit.mjs` |
