# AGENTS.md

Agent context for Proyekto — a monorepo with React 19 web (web/), NestJS backend (backend/), Python FastAPI AI agent (agent/), and Supabase (supabase/).

Note: `SETUP.md` references an `api/` directory — the backend is actually `backend/`. Treat `SETUP.md` as stale for paths.


## Repository layout

- web/ — React 19 + Vite + TanStack Router/Query/Table, MUI + Tailwind, Zustand, Lexical, XYFlow/dagre. Dev port 3000. Path alias @/* → web/src/*.
- backend/ — NestJS 11. Supabase (data/auth) + Upstash Redis. Feature modules under backend/src/modules/. Deployed to Vercel.
- agent/ — Python 3 FastAPI AI agent (LangChain/LangGraph + OpenAI). Entry: agent/run.py. State via Upstash Redis.
- supabase/migrations/ — source of truth for DB schema.
- schemas/roadmap-ai-operations.json — shared contract between backend and agent.

## Common commands

### Web (cd web)
npm run dev          # Vite dev server on port 3000
npm run build        # Vite build + tsc typecheck
npm test             # Vitest single run
npm run check        # Biome lint + format check

### Backend (cd backend)
npm run dev          # nest start --watch
npm run build        # nest build
npm test             # Jest (rootDir = src/)
npx jest path/to/file.spec.ts   # single spec
npm run test:e2e     # e2e suite
npm run lint         # ESLint auto-fix
npm run check:roadmap-ai-schema

### Agent (cd agent)
python run.py        # FastAPI via uvicorn
node scripts/test_agent_unit.mjs [module]   # run from repo root

## Architecture notes

### Roadmap AI flow
1. Web → backend roadmap AI endpoints (backend/src/modules/roadmaps/).
2. Backend → Python agent over HTTP; session state in Upstash Redis.
3. Agent runs ReAct loop, emits operations per schemas/roadmap-ai-operations.json.
4. Backend applies ops to Supabase, returns full payload or lean diff (include_roadmap flag).
5. Web renders with XYFlow + dagre, supports optimistic UI.

When changing operation shapes: update schemas/roadmap-ai-operations.json and run npm run check:roadmap-ai-schema from backend/.

### Web routing
TanStack file-based routes under web/src/routes/. routeTree.gen.ts is generated — do not hand-edit. Route trees split by persona: admin/, client/, consultant/, freelancer/, profile/, project/, roadmap/.

### Backend modules
Each feature module is self-contained (controller/service/repository). ThrottlerModule uses a custom ThrottlerStorageRedisService backed by Upstash.

## Gotchas

- Shell is bash-on-Windows: use forward slashes and /dev/null, not NUL.
- web/ build runs tsc after vite build — type errors fail the build.
- Jest rootDir for backend is src/ — pass paths relative to backend/src/ when targeting a single spec.
- Do not mock the database in backend integration tests (past incident: mock/prod divergence masked a broken migration).
- If node scripts/test_agent_unit.mjs hangs, remove the flaky test rather than retrying.

## Skills

- /qa-tester — QA Tester: write and run tests across all layers. See .agents/skills/qa-tester/SKILL.md.