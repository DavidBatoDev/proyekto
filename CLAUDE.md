# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

Proyekto is a monorepo with four deployable units. Note: SETUP.md refers to an api/ directory â€” the backend now lives in backend/. Treat SETUP.md as partially stale for paths.

- web/ â€” React 19 + Vite + TanStack Router/Query/Table, MUI + Tailwind, Zustand, Lexical, XYFlow/dagre (roadmap canvas), Supabase client. Dev port 3000, path alias @/* â†’ web/src/*.
- backend/ â€” NestJS 11 API. Supabase (data/auth) + Upstash Redis (throttler storage, agent caches). Deployed to Vercel (backend/vercel.json, backend/src/lambda.ts). Feature modules under backend/src/modules/ (auth, users, profile, projects, roadmaps, roadmap-shares, payments, admin, consultants, applications, uploads, guests, marketplace, notifications, project-time, chat).
- agent/ â€” Python 3 FastAPI AI agent (LangChain/LangGraph + OpenAI) powering roadmap AI. Entry: agent/run.py â†’ app.main:app. Orchestration lives in agent/app/core/orchestration/ (planning, react, edits, context). Session state via Upstash Redis.
- supabase/ â€” migrations/ (source of truth for DB schema) and edge functions/ (password reset, signup email).
- infra/ â€” Terraform for Supabase storage buckets / provisioning.
- scripts/ â€” Node .mjs benchmarks and a wrapper for agent Python tests.
- schemas/roadmap-ai-operations.json â€” shared contract between backend and agent for roadmap-edit operations.

## Common Commands

### Web (cd web)
- npm run dev â€” Vite on port 3000
- npm run build â€” Vite build + tsc typecheck
- npm test â€” Vitest (single run); vitest for watch
- npm run check / lint / format â€” Biome

### Backend (cd backend)
- npm run dev â€” nest start --watch
- npm run build â€” nest build
- npm test â€” Jest (config inline in package.json, rootDir is src/, picks up *.spec.ts)
- npx jest path/to/file.spec.ts â€” run a single spec
- npm run test:e2e â€” Jest using backend/test/jest-e2e.json
- npm run lint â€” ESLint (auto-fix)
- npm run check:roadmap-ai-schema â€” validates the shared JSON schema in schemas/

### Agent (cd agent)
- pip install -r requirements.txt (venv lives at agent/venv/)
- python run.py â€” runs FastAPI via uvicorn, reload in dev
- Python tests are invoked via the Node wrapper from repo root: node scripts/test_agent_unit.mjs [tests.module_name ...]. If autodetect fails, set AGENT_PYTHON_BIN=agent\\venv\\Scripts\\python.exe.

### Supabase (run from backend/ per SETUP.md, though migrations physically live at repo-root supabase/)
- npx supabase link --project-ref <ref>
- npx supabase db push â€” apply migrations
- npx supabase db reset â€” dev-only

### Benchmarks / validation (repo root)
- node scripts/benchmark_resolve_lookup.mjs (supports --assert-warm-p95-ms=, --redis-chaos)
- node scripts/benchmark_roadmap_ai_commit.mjs (compares include_roadmap true vs false)
- node scripts/validate_agent_canary_matrix.mjs â€” runs strict-canary and react-compat env profiles against targeted agent unittests; non-zero exit on failure

Scripts auto-load .env in order: cwd â†’ scripts/.env â†’ repo root .env â†’ backend/.env (or agent/.env for the agent runner). First value wins.

## Architecture Notes

### Roadmap AI flow (cross-service)
The roadmap AI feature spans all three runtimes and is the most load-bearing cross-cutting concern:

1. *Web* sends user intent to *backend* roadmap AI endpoints (under backend/src/modules/roadmaps/).
2. *Backend* forwards to the Python *agent* over HTTP, carrying a session id; agent state is persisted in Upstash Redis via agent/app/core/session_store.py.
3. *Agent* runs a ReAct-style planning/execution loop (agent/app/core/orchestration/{planning,react,edits}) that emits roadmap operations conforming to schemas/roadmap-ai-operations.json.
4. *Backend* applies those operations to Supabase (via fast-json-patch where relevant) and returns either a full roadmap payload or a lean diff based on the include_roadmap flag â€” this lean path is a deliberate latency optimization and is benchmark-covered.
5. *Web* renders the canvas with XYFlow + dagre and supports optimistic UI for epic/feature/task operations (recent commits are entirely in this area â€” see feat(roadmap-optimistic-operations), feat(roadmap-ai), feat(planner-summary)).

Feature-flag env vars controlling agent behavior (validated by validate_agent_canary_matrix.mjs): AGENT_HYBRID_REACT_ENABLED, AGENT_DRAFT_GRAPH_ENABLED, AGENT_STRICT_PREVIEW_FINGERPRINT, AGENT_REACT_MAX_ATTEMPTS, MAX_EDIT_TOOL_TURNS. Legacy aliases still accepted for one release: AGENT_EDIT_PLANNER_MAX_ATTEMPTS, AGENT_EDIT_PLANNER_REPAIR_RETRIES.

When changing operation shapes, update schemas/roadmap-ai-operations.json *and* run npm run check:roadmap-ai-schema from backend/ â€” the schema is consumed by both NestJS validation and the Python agent's contract tests (agent/tests/test_operation_contracts.py).

### Backend module conventions
NestJS is wired in backend/src/app.module.ts. Each feature module is self-contained (controller/service/repository). Global concerns:
- config/env.validation.ts validates env via validateEnv at boot.
- config/supabase.module.ts provides Supabase clients (anon + service role).
- ThrottlerModule uses a custom ThrottlerStorageRedisService backed by Upstash.
- backend/src/lambda.ts is the Vercel serverless entry; main.ts is the standalone entry.

### Web routing
TanStack Router with file-based routes under web/src/routes/. routeTree.gen.ts is generated â€” don't hand-edit. Route trees split per persona (admin/, client/, consultant/, freelancer/, profile/, project/, roadmap/).

## Gotchas

- Shell is bash-on-Windows: use forward slashes and /dev/null, not NUL.
- SETUP.md references api/ â€” the directory is actually backend/. Supabase CLI commands still get invoked from backend/ but supabase/migrations/ lives at repo root.
- web/ build runs tsc after vite build; type errors will fail the build even if Vite succeeds.
- Jest rootDir for backend is src/ â€” pass paths relative to backend/src/ (or absolute) when running a single spec.