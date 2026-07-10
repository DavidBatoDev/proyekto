# Setup & Deploy

> **Last updated:** 2026-07-09 · **Status:** current

The agent is a Python 3.12 FastAPI service. Locally it runs via `run.py` (uvicorn);
in production it's a Docker image on Cloud Run. This page covers running it, its
config knobs, and testing.

## Run it locally

```bash
cd agent
python -m venv venv && source venv/Scripts/activate    # venv lives at agent/venv/
pip install -r requirements.txt
cp .env.example .env                                    # fill OPENAI_API_KEY, UPSTASH_REDIS_*
python run.py                                           # uvicorn on APP_PORT (default 8010)
```

`run.py` launches `uvicorn app.main:app` on `APP_HOST` (`0.0.0.0`) / `PORT` or
`APP_PORT`, with `reload` on only when `APP_ENV=development`.

Key dependencies (`requirements.txt`): `fastapi`, `uvicorn[standard]`, `httpx`,
`pydantic` v2 + `pydantic-settings`, `openai` (Responses API), `langchain` /
`langchain-openai` / `langgraph`, and `upstash-redis` (the durable session store).

## Configuration

All settings load from `agent/.env` via `pydantic-settings`
([`agent/app/core/config.py`](../../agent/app/core/config.py)). The knobs that matter:

| Var | Default | What |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | Required |
| `OPENAI_MODEL_V2` | `gpt-5.4-mini` | The loop model (Responses API) |
| `OPENAI_V2_REASONING_EFFORT` | `low` | Base effort (escalates to medium on hard turns) |
| `OPENAI_V2_MAX_OUTPUT_TOKENS` | `4000` | Max output per call |
| `OPENAI_V2_STREAMING_ENABLED` | `true` | Stream text deltas |
| `OPENAI_V2_REASONING_SUMMARY_ENABLED` | `false` | Emit reasoning summaries |
| `AGENT_V2_MAX_TURNS` | `8` | Loop turns (clamp 1–16) |
| `AGENT_V2_MAX_TOOL_CALLS` | `24` | Tool-call budget (clamp 1–60) |
| `AGENT_ASYNC_AUTO_COMMIT_ENABLED` | `false` | Background the auto-commit vs inline |
| `SESSION_TTL_SECONDS` | `14400` | Redis session TTL (4h) |
| `REDIS_SESSION_KEY_PREFIX` | `roadmap:ai:session` | Session key prefix |
| `AGENT_SUMMARY_MODEL` | `gpt-4o-mini` | Summarizer model |
| `AGENT_SUMMARY_TRIGGER_MESSAGES` / `_KEEP_MESSAGES` / `_MAX_CHARS` | `40` / `30` / `4000` | Summarizer thresholds |
| `NEST_API_BASE_URL` | `http://localhost:8001/api` (prod: `https://api.proyekto.tech/api`) | Backend callback base |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | — | Session store |
| `AGENT_RESOLVE_CACHE_TTL_SECONDS` | `300` | Node-resolution cache |
| `REALTIME_WORKER_URL` / `REALTIME_PUBLISH_TOKEN` / `AGENT_REALTIME_TRACE_PUSH_ENABLED` | — / — / `false` | Optional AI-trace push (ship-dark) |

## Deploy

The agent ships to **Cloud Run** via `.github/workflows/agent-deploy.yml` on pushes
to `main` under `agent/**`. The image (`agent/Dockerfile`, `python:3.12-slim`) is
built from the **repo root** context so it can copy `schemas/` alongside `agent/app`
(the schema loader needs `<root>/schemas/roadmap-ai-operations.schema.json`). The
container runs `uvicorn app.main:app` on port 8080 (not `run.py`). Runtime footprint:
`--max-instances=3 --concurrency=10`. See
[Architecture → deploy topology](../02-architecture/deploy-topology.md#agent--cloud-run).

## Testing

Python tests run through a Node wrapper from the repo root:

```bash
node scripts/test_agent_unit.mjs                       # default suite
node scripts/test_agent_unit.mjs tests.test_v2_loop    # a single module
```

It resolves a Python interpreter (`AGENT_PYTHON_BIN` → `agent/venv/Scripts/python.exe`
→ `python`/`py`) and runs `python -m unittest` with `cwd=agent`. The default suite
covers the v2 loop, outcome mapping, sentinels, reasoning effort, streaming, the
operation contracts, the edit resolver, and session-store CAS.

> **Gotcha:** if a test module hangs, drop the flaky addition rather than looping on
> retries. And the shared contract test (`test_operation_contracts`) must stay green
> alongside `npm run check:roadmap-ai-schema` — see [operations-schema.md](./operations-schema.md).
