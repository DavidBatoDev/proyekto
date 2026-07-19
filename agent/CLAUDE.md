# agent/ - Python FastAPI AI agent

Local context for the agent unit. Cross-cutting rules live in the root CLAUDE.md.

## Layout

- Entry: run.py -> app.main:app (uvicorn, port 8010). Venv at agent/venv/ (python 3.12).
- The single brain is the v2 loop in app/core/v2/: loop.py, brain.py, context.py, tools_spec.py, tools_exec.py, staging.py, summarizer.py, prompts/system_v2.md (the system prompt). AgentService.plan_message (app/core/orchestration/agent_service.py) ALWAYS runs v2 - there is no v1/v2 flag matrix.
- Tunables live in app/core/config.py (pydantic-settings): AGENT_V2_MAX_TURNS, AGENT_V2_MAX_TOOL_CALLS, OPENAI_V2_* knobs, SESSION_TTL_SECONDS, AGENT_SUMMARY_* knobs.
- Session state: app/core/session_store.py - Upstash Redis with CAS semantics. Memory-class state is snapshotted into roadmap_ai_sessions.metadata.agent_state (see root CLAUDE.md for the memory architecture).
- app/core/nest_client.py calls back into the NestJS backend; app/core/tools/registry.py resolves the shared schema from repo-root schemas/.

## Tests

- Run from the REPO ROOT: `node scripts/test_agent_unit.mjs [tests.module_name ...]` (e.g. tests.test_v2_loop). If venv autodetect fails, set AGENT_PYTHON_BIN=agent\venv\Scripts\python.exe.
- If a new test HANGS, delete it rather than retry-looping - flaky agent tests are dropped, not debugged (standing team rule).
- Contract tests: tests/test_operation_contracts.py must pass after any schemas/roadmap-ai-operations.json change - follow the /api-contract skill for the full workflow.
- Before pushing agent/ or schemas/ changes, run the canary: `node scripts/validate_agent_canary_matrix.mjs`.

## Conventions

- No lint/format config in this unit - match the surrounding code style.
- Docker builds from the REPO ROOT (agent/Dockerfile copies schemas/ into the image) - never move or rename the schemas/ directory.
