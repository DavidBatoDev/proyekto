# agent/ - Python FastAPI AI agent

Local context for the agent unit. Cross-cutting rules live in the root CLAUDE.md.

## Layout

- Entry: run.py -> app.main:app (uvicorn, port 8010). Venv at agent/venv/ (python 3.12).
- The single brain is the v2 loop in app/core/v2/: loop.py, brain.py, context.py, tools_spec.py, tools_exec.py, staging.py, summarizer.py, prompts/system_v2.md (the system prompt). AgentService.plan_message (app/core/orchestration/agent_service.py) ALWAYS runs v2 - there is no v1/v2 flag matrix.
- Tunables live in app/core/config.py (pydantic-settings): AGENT_V2_MAX_TURNS, AGENT_V2_MAX_TOOL_CALLS, OPENAI_V2_* knobs, SESSION_TTL_SECONDS, AGENT_SUMMARY_* knobs.
- Session state: app/core/session_store.py - Upstash Redis with CAS semantics. Memory-class state is snapshotted into roadmap_ai_sessions.metadata.agent_state (see root CLAUDE.md for the memory architecture).
- app/core/nest_client.py calls back into the NestJS backend; app/core/tools/registry.py resolves the shared schema from repo-root schemas/.

## Logs - see what the agent actually did

`agent/logs.txt` is the local run log (gitignored). It is written because agent/.env sets `AGENT_LOG_FILE=logs.txt`; `AGENT_LOG_TO_CONSOLE=true` mirrors it to stdout. READ THIS FILE FIRST when debugging agent behavior - it is far faster than reasoning about the code, and it shows what the model actually received and did.

- Every turn ends with a human-readable `AI REQUEST: <TITLE>` lifecycle block (built in logging_utils `_build_lifecycle_block`, flushed when the `message_completed` event fires). One block per turn, covering: ACTOR, ROUTING, TOOL CALL, LLM OPERATIONS, response mode, staged-op counts, token usage, and the assistant reply.
- Useful greps: `AI REQUEST` (turn boundaries), `cache ` (prompt-cache hit rate), `route_lane=v2_budget` (turn ran out of turns/tool calls), `reasoning_effort_selected` (adaptive-effort escalation + trigger), `auto_commit_sync_failed` / `auto_commit_async_failed` (commit rejected), `provider_failure`.
- The `cache` line renders `cached/input (NN%)`. Cached input bills at ~10%, and app/core/v2/context.py `compact_state` deliberately orders the prompt so the static prefix stays byte-stable. A multi-turn conversation sitting at 0% means something per-turn crept ABOVE the `# Actor` block and broke the cacheable prefix - treat it as a regression, not noise.
- Message/tool CONTENT is redacted unless `AGENT_LOG_INCLUDE_CONTENT=true`. Turn it on locally when you need the actual prompt or tool payloads; leave it off otherwise.
- To capture a clean run: empty logs.txt, restart the agent, do the one thing you are debugging, then read the file. Old traces are not pruned, so a stale file makes it easy to read the wrong turn.

## Tests

- Run from the REPO ROOT: `node scripts/test_agent_unit.mjs [tests.module_name ...]` (e.g. tests.test_v2_loop). With no arguments it DISCOVERS and runs every tests/test_*.py module - do not reintroduce a hand-maintained allowlist (the old one had silently drifted to skipping 22 of 37 modules). If venv autodetect fails, set AGENT_PYTHON_BIN=agent\venv\Scripts\python.exe.
- If a new test HANGS, delete it rather than retry-looping - flaky agent tests are dropped, not debugged (standing team rule).
- Contract tests: tests/test_operation_contracts.py must pass after any schemas/roadmap-ai-operations.json change - follow the /api-contract skill for the full workflow.
- Before pushing agent/ or schemas/ changes, run the canary: `node scripts/validate_agent_canary_matrix.mjs`.

## Conventions

- No lint/format config in this unit - match the surrounding code style.
- Docker builds from the REPO ROOT (agent/Dockerfile copies schemas/ into the image) - never move or rename the schemas/ directory.
