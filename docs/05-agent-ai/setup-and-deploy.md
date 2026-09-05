# Setup & Deploy

> **Last updated:** 2026-09-05 · **Status:** current

The agent is a Python 3.12 FastAPI service. Locally it runs via `run.py` (uvicorn);
in production it is a Docker image on Cloud Run. This page covers running it, every
config knob with its default (read from
[`agent/app/core/config.py`](../../agent/app/core/config.py)), deploy, and testing.

## Run it locally

```bash
cd agent
python -m venv venv && source venv/Scripts/activate    # venv lives at agent/venv/
pip install -r requirements.txt
cp .env.example .env                                    # fill OPENAI_API_KEY, UPSTASH_REDIS_*
python run.py                                           # uvicorn on APP_PORT (default 8010)
```

`run.py` launches `uvicorn app.main:app` on `APP_HOST` (`0.0.0.0`) / `PORT` or
`APP_PORT`, with `reload` on only when `APP_ENV=development`. The app mounts two
routers: `/agent/sessions` (create, messages, continue, cancel, trace events) and
`/briefs/generate` (the project-brief generator, backend-only via
`AGENT_INTERNAL_TOKEN`), plus `/` and `/health`.

Key dependencies (`requirements.txt`): `fastapi`, `uvicorn[standard]`, `httpx`,
`pydantic` v2 + `pydantic-settings`, `openai` (Responses API), `langchain` /
`langchain-openai` / `langgraph`, and `upstash-redis` (the session and trace store).
Without `UPSTASH_REDIS_REST_URL`/`_TOKEN` the session routes answer 503
`SESSION_STORE_UNAVAILABLE`.

> **Local debugging:** set `AGENT_LOG_FILE=logs.txt` and `AGENT_LOG_JSON=false` to get
> the per-request `AI REQUEST` lifecycle block described in
> [runs-and-phases.md](./runs-and-phases.md#the-logstxt-lifecycle-block).

## Configuration

All settings load from `agent/.env` via `pydantic-settings`. Defaults and clamps below
are the code's; `agent/.env.example` differs in a few places (it sets
`NEST_API_BASE_URL=http://localhost:8001/api`, `AGENT_LOG_JSON=true`,
`MAX_OPERATIONS_PER_REQUEST=25`, `AGENT_RESOLVE_PARALLEL_VARIANTS_ENABLED=false`).

### App and backend

| Var | Default | What |
| --- | --- | --- |
| `APP_NAME` / `APP_ENV` / `APP_HOST` / `APP_PORT` | `Roadmap AI Agent` / `development` / `0.0.0.0` / `8010` | Process identity and bind |
| `NEST_API_BASE_URL` | `http://localhost:8000/api` (prod: `https://api.proyekto.tech/api`) | Backend callback base; `/api` is appended if missing |
| `NEST_TIMEOUT_SECONDS` | `20.0` | Per-call backend timeout; feeds the execute batch reserve |
| `AGENT_INTERNAL_TOKEN` | unset | Shared secret for `/briefs/generate` (required outside development; unset fails closed) |
| `AGENT_BRIEF_MODEL` / `AGENT_BRIEF_MAX_OUTPUT_TOKENS` | falls back to `OPENAI_MODEL_V2` / `3000` | The brief generator |

### Model and loop engine

The `*_V2_*` names are kept for deploy compatibility; there is one model and one loop.

| Var | Default | What |
| --- | --- | --- |
| `OPENAI_API_KEY` | - | Required |
| `OPENAI_MODEL_V2` | `gpt-5.4-mini` | The one model, via the Responses API |
| `OPENAI_V2_REASONING_EFFORT` | `low` | Base effort (`minimal \| low \| medium \| high`; anything else -> `low`); investigate escalates to at least `medium` on hard turns, materialize/repair always run at least `medium` |
| `OPENAI_V2_MAX_OUTPUT_TOKENS` | `4000` | Max output per call |
| `OPENAI_V2_TEMPERATURE` | unset | Omitted unless set (GPT-5 reasoning models reject non-default values) |
| `OPENAI_V2_STREAMING_ENABLED` | `true` | Stream text deltas (`assistant_delta` events) |
| `OPENAI_V2_REASONING_SUMMARY_ENABLED` | `false` | Emit reasoning summaries (`assistant_thought` events) |
| `OPENAI_MODEL_TIMEOUT_SECONDS` | `90.0` (clamp 5-280) | Per-call OpenAI client timeout; feeds the batch reserve |
| `AGENT_V2_MAX_TURNS` | `8` (clamp 1-16) | Loop turns per phase entry |
| `AGENT_V2_MAX_TOOL_CALLS` | `24` (clamp 1-60) | Tool-call budget per phase entry |

### Run orchestration

Every knob is a clamped number, never an on/off switch - the run machine is always on.

| Var | Default | What |
| --- | --- | --- |
| `AGENT_RUN_STEP_BUDGET_SECONDS` | `90.0` (clamp 10-280) | Soft budget: loops stop starting new model turns past it and the step returns `next: continue` |
| `AGENT_RUN_HARD_DEADLINE_SECONDS` | `165.0` (clamp 30-280) | Per-request ceiling under the web's 180s and Cloud Run's 300s; raised to the step budget if set lower |
| (derived) batch reserve | `OPENAI_MODEL_TIMEOUT_SECONDS + 3 x NEST_TIMEOUT_SECONDS` = 150s | Execute starts a model-calling batch only when `elapsed + reserve <= hard deadline` (direct edits reserve only the 60s Nest tail). Must stay under the hard deadline or no batch can ever start |
| `AGENT_RUN_MAX_STEPS` | `8` (clamp 1-32) | HTTP requests (message + continues) one run may consume; the web caps polling at 30 minutes |
| `AGENT_RUN_LOCK_TTL_SECONDS` | `300` (clamp 60-3600) | Per-session run lock (`SET NX EX`); keep >= the Cloud Run request timeout |
| `AGENT_RUN_TRANSCRIPT_TTL_SECONDS` | `900` (clamp 60-14400) | Paused loop transcripts (Redis side keys); a missing transcript restarts the read-only phase |
| `AGENT_DIRECT_EDIT_MAX_OPERATIONS` | `15` (clamp 0-200) | Workspace scope: a single-roadmap, delete-free batch up to this many ops executes without confirmation |
| `AGENT_DIRECT_EDIT_MAX_OPERATIONS_FOCUS` | `90` (clamp 0-200) | Roadmap scope: a batch on the focus roadmap executes immediately up to this many ops, deletes included |
| `AGENT_EXECUTE_MAX_TURNS` / `AGENT_EXECUTE_MAX_TOOL_CALLS` | `4` (1-16) / `10` (1-60) | The materialize mini loop (proposal titles -> operations per target) |
| `AGENT_MAX_LOADED_ROADMAPS` | `6` (clamp 1-20) | Context-cache LRU size (never evicts the run's focus roadmaps); at most N-1 referenced roadmaps auto-load |
| `AGENT_MAX_REFS_PER_MESSAGE` | `20` (clamp 0-25) | `@`-references accepted per message (the backend resolver takes 1-25) |

### Session store, trace store, caches

| Var | Default | What |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | - | Session + trace store (required for the session routes) |
| `SESSION_TTL_SECONDS` | `14400` | Redis session TTL (4h), refreshed on read; expiry is benign thanks to the durable snapshot |
| `REDIS_SESSION_KEY_PREFIX` | `roadmap:ai:session` | Session key prefix (side keys hang off it) |
| `REDIS_TRACE_KEY_PREFIX` | `roadmap:ai:trace` | Trace hash + `:events` list prefix |
| `AGENT_TRACE_TTL_SECONDS` | `900` (clamp 60-86400) | Trace TTL, re-armed on every flush |
| `AGENT_TRACE_FLUSH_EVERY_EVENTS` / `AGENT_TRACE_FLUSH_INTERVAL_SECONDS` | `5` (1-100) / `0.5` (0.05-10) | Flush the per-process event buffer every N events or every interval, whichever first |
| `MAX_CHAT_HISTORY_MESSAGES` | `30` | Message rows sent as history (tool-call pairs count as 2) |
| `MAX_OPERATIONS_PER_REQUEST` | `90` | Declared in settings but not read by the runtime (the checkpoint policy caps above are what apply) |
| `AGENT_CACHE_TTL_SECONDS` | `600` | Memory notes, project context and workspace overview cache TTL |
| `AGENT_PROJECT_CONTEXT_ENABLED` | `true` | Inject the linked project's compact context pack |
| `AGENT_KNOWLEDGE_SEARCH_ENABLED` | `false` | Expose the `search_knowledge` tool (needs the backend knowledge pipeline) |
| `AGENT_MEMORY_SEMANTIC_THRESHOLD` | `15` (clamp 0-100) | Above this many notes, inject-all switches to per-turn top-k retrieval |
| `AGENT_RESOLVE_CACHE_TTL_SECONDS` | `300` (clamp 0-300) | In-turn resolve-lookup cache (the dispatcher is rebuilt every turn) |
| `AGENT_RESOLVE_PARALLEL_VARIANTS_ENABLED` | `true` | Resolve label variants in parallel |

### Summarizer

| Var | Default | What |
| --- | --- | --- |
| `AGENT_SUMMARY_MODEL` | `gpt-4o-mini` | Summarizer model |
| `AGENT_SUMMARY_TRIGGER_MESSAGES` / `_KEEP_MESSAGES` / `_MAX_CHARS` | `40` / `30` / `4000` | Compaction thresholds (see [memory.md](./memory.md#4-conversation-summarizer)) |

### Logging, tracing, realtime push

| Var | Default | What |
| --- | --- | --- |
| `AGENT_LOG_LEVEL` / `AGENT_LOG_JSON` / `AGENT_LOG_COLOR` | `DEBUG` / `false` / `auto` | JSON mode emits one line per event and skips the lifecycle block |
| `AGENT_LOG_INCLUDE_CONTENT` | `false` | Include message/tool content in logs |
| `AGENT_LOG_FILE` / `AGENT_LOG_TO_CONSOLE` | unset / `true` | Append every event to a file (ANSI off); mirror to stdout |
| `AGENT_PROGRESS_EVENTS_ENABLED` / `AGENT_PROGRESS_EVENTS_ALLOW_VERBOSE` | `true` / `true` | Serve trace events; allow `detail=verbose` |
| `REALTIME_WORKER_URL` / `REALTIME_PUBLISH_TOKEN` / `AGENT_REALTIME_TRACE_PUSH_ENABLED` | - / - / `false` | Optional AI-trace push to `user:{id}` rooms; polling stays authoritative |

## Deploy

The agent ships to **Cloud Run** via `.github/workflows/agent-deploy.yml` on pushes
to `main` under `agent/**`. The image (`agent/Dockerfile`, `python:3.12-slim`) is
built from the **repo root** context so it can copy `schemas/` alongside `agent/app`
(the registry needs `<root>/schemas/roadmap-ai-operations.schema.json`). The
container runs `uvicorn app.main:app` on port 8080 (not `run.py`). Runtime footprint:
`--max-instances=3 --concurrency=10 --timeout=300`. There is no session affinity,
which is why run state and trace events live in Redis. See
[Architecture -> deploy topology](../02-architecture/deploy-topology.md#agent--cloud-run).

Deploy order is a contract: the backend (with the `20260904090000` /
`20260904090100` migrations applied) must be live before an agent that sends
`session_id`/`run_id` on commit, and the agent before a web bundle that sends
`scope`, `refs`, `capabilities` and calls `continue`.

## Testing

Python tests run through a Node wrapper from the repo root:

```bash
node scripts/test_agent_unit.mjs                              # every tests/test_*.py module (discovered)
node scripts/test_agent_unit.mjs tests.test_runtime_runs      # one module
node scripts/validate_agent_canary_matrix.mjs                 # the canary (non-zero exit on failure)
```

The runner resolves a Python interpreter (`AGENT_PYTHON_BIN` ->
`agent/venv/Scripts/python.exe` -> `python`/`py`) and runs `python -m unittest` with
`cwd=agent`. The canary pins nine modules: `test_engine_loop`,
`test_runtime_terminal`, `test_runtime_orchestrator_e2e`, `test_runtime_execute`,
`test_operation_contracts`, `test_tool_registry_schema_snapshot`,
`test_edit_resolver`, `test_session_store_cas`, `test_trace_store`. The wider suite
covers the run machine (`test_runtime_runs`, `test_runtime_refs`,
`test_runtime_prompt`, `test_runtime_tools_catalog`, `test_runtime_verify`,
`test_session_flows`, `test_session_ownership`, `test_run_lock`), the snapshot
ladder, the summarizer, and the trace endpoint.

> **Gotcha:** if a test module hangs, drop the flaky addition rather than looping on
> retries. And `test_operation_contracts` must stay green alongside
> `npm run check:roadmap-ai-schema` (run from `backend/`) - see
> [operations-schema.md](./operations-schema.md).
