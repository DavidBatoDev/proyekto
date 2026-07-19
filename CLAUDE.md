# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Context

Proyekto is a managed work-delivery platform for digital projects: Clients fund the work, vetted Consultants lead delivery (the platform's differentiator), Freelancers execute, Admins govern the platform. One account can hold many roles, switched via active_persona; consultant-only surfaces are gated by the durable profiles.is_consultant_verified flag (not the active persona). Per-project access uses the share_role ladder: owner > admin > editor > commenter > viewer. Anonymous guests can build a roadmap before signup and migrate it to a real account.

Brand rule: the product is "Proyekto" in ALL user-facing copy - "Prodigy" and the prdigy/ folder name are legacy only.

Product docs: docs/01-product/. The docs/ tree (sections 00-12) is authoritative and source-verified; the setup guide is docs/00-getting-started/setup.md.

## Repository Layout

Proyekto is a monorepo with six deployable units. Each unit has its own CLAUDE.md with local commands, conventions, and gotchas - read it before working in that unit.

- web/ - React 19 + Vite + TanStack Router/Query/Table, MUI + Tailwind, Zustand, Lexical, XYFlow/dagre (roadmap canvas), Supabase client, Capacitor mobile. Dev port 3000, path alias @/* -> web/src/*. See web/CLAUDE.md.
- backend/ - NestJS 11 API. Supabase (data/auth) + Upstash Redis (throttler storage, agent caches). Deployed to Cloud Run as a Docker image (container starts backend/src/server.ts; backend/src/lambda.ts is an orphaned Vercel adapter, not deployed). 26 feature modules under backend/src/modules/ as of 2026-07 - the list drifts; `ls backend/src/modules` is the source of truth. See backend/CLAUDE.md.
- agent/ - Python 3.12 FastAPI AI agent powering roadmap AI. Entry: agent/run.py -> app.main:app (port 8010). The single brain is the v2 tool-calling loop in agent/app/core/v2/ over the OpenAI Responses API (OPENAI_MODEL_V2). Session state via Upstash Redis. Deployed to Cloud Run (Docker built from repo root). See agent/CLAUDE.md.
- realtime/ - Cloudflare Worker + Durable Objects carrying collaborative realtime (roadmap canvas + chat), replacing Supabase Realtime. Shipped dormant behind transport flags. Buckets: R2 proyekto-media / proyekto-private. See realtime/CLAUDE.md.
- supabase/ - migrations/ (source of truth for DB schema) and edge functions/. See supabase/CLAUDE.md.
- infra/ - Terraform (Supabase buckets, Cloudflare, GCP). Committed .tfstate - hands off. See infra/CLAUDE.md.
- scripts/ - Node .mjs benchmarks, validators, and the wrapper for agent Python tests.
- schemas/roadmap-ai-operations.json - shared contract between backend and agent for roadmap-edit operations.

## Common Commands

Per-unit commands live in each unit's CLAUDE.md (web/, backend/, agent/, realtime/, supabase/). Repo-root commands:

### Benchmarks / validation (repo root)
- node scripts/benchmark_resolve_lookup.mjs (supports --assert-warm-p95-ms=, --redis-chaos)
- node scripts/benchmark_roadmap_ai_commit.mjs (compares include_roadmap true vs false)
- node scripts/validate_agent_canary_matrix.mjs - runs the v2 canary (the v2 loop + shared contract unittests); non-zero exit on failure
- node scripts/test_agent_unit.mjs [tests.module ...] - agent Python tests

Scripts auto-load .env in order: cwd -> scripts/.env -> repo root .env -> backend/.env (or agent/.env for the agent runner). First value wins.

## Build and Push Policy

- Only run full build commands (for example, `npm run build`) when the current task includes pushing commits to a remote repository.
- For local edits and commit-only work, use focused tests, type checks, schema checks, and lint/format checks as appropriate, but do not run a full build.
- When a push is requested, run the relevant full builds after the changes are ready and before pushing.

## Engineering Rules

- Staged rollouts: user-visible features ship dark behind telemetry/feature flags and activate in phases (realtime transport flags are the model). Do not bundle activation with the initial land unless asked.
- CI is deploy-only - there are no PR test gates. Local checks (tests, typechecks, schema validators, the canary) are the only quality gate; the /deploy-preflight skill is the pre-push checklist.
- NEVER `supabase db push` to prod - it fails with SASL (stale local password) and the correct path is the Supabase MCP apply_migration tool. See supabase/CLAUDE.md.

## Architecture Notes

### Roadmap AI flow (cross-service)
The roadmap AI feature spans all three runtimes and is the most load-bearing cross-cutting concern:

1. *Web* sends user intent to *backend* roadmap AI endpoints (under backend/src/modules/roadmaps/).
2. *Backend* forwards to the Python *agent* over HTTP, carrying a session id; agent state is persisted in Upstash Redis via agent/app/core/session_store.py.
3. *Agent* runs a single tool-calling loop (agent/app/core/v2/) that emits roadmap operations conforming to schemas/roadmap-ai-operations.json.
4. *Backend* applies those operations to Supabase (via fast-json-patch where relevant) and returns either a full roadmap payload or a lean diff based on the include_roadmap flag - this lean path is a deliberate latency optimization and is benchmark-covered.
5. *Web* renders the canvas with XYFlow + dagre and supports optimistic UI for epic/feature/task operations.

The agent has a single brain: the v2 single-loop in agent/app/core/v2/ (one model via the OpenAI Responses API, OPENAI_MODEL_V2). There is no v1/v2 feature-flag matrix - AgentService.plan_message always runs the v2 loop. Tunables (see agent/app/core/config.py): AGENT_V2_MAX_TURNS, AGENT_V2_MAX_TOOL_CALLS, OPENAI_V2_MAX_OUTPUT_TOKENS, OPENAI_V2_REASONING_EFFORT, AGENT_ASYNC_AUTO_COMMIT_ENABLED, SESSION_TTL_SECONDS, AGENT_SUMMARY_MODEL/TRIGGER_MESSAGES/KEEP_MESSAGES/MAX_CHARS.

Memory architecture: the Redis session's memory-class state (pending plan, undo log, recents, conversation summary) is snapshotted fire-and-forget into roadmap_ai_sessions.metadata.agent_state and restored on rehydration, so TTL expiry loses nothing; long threads are compacted into metadata.conversation_summary (side-key compute, turn-start apply - see agent/app/core/v2/summarizer.py); durable per-roadmap preferences live in roadmap_ai_memories (shared across collaborators, chat-managed via the save_memory/forget_memory tools, injected as "# Memory notes").

When changing operation shapes, follow the /api-contract skill: update schemas/roadmap-ai-operations.json *and* run npm run check:roadmap-ai-schema from backend/ - the schema is consumed by both NestJS validation and the Python agent's contract tests (agent/tests/test_operation_contracts.py).

### Backend modules
Each feature module is self-contained (controllers/services/repositories/dto), wired in backend/src/app.module.ts. Repository pattern: interface + Supabase impl. Details and the critical lint gotcha: backend/CLAUDE.md.

### Web routing
TanStack Router file-based routes under web/src/routes/, split per persona. routeTree.gen.ts is generated - never hand-edit (hook-blocked). Details: web/CLAUDE.md.

## Claude Code Config Map

Project config lives in .claude/ (tracked in git, except settings.local.json).

Subagents (.claude/agents/): research (PM-tool/context gathering, tool-agnostic), opportunity-validator (adversarial idea stress-test), solutions-architect (cross-service design), code-reviewer (Proyekto review checklist, read-only), security-auditor (RLS/guards/JWT/guests, read-only), db-migration-specialist (schema work), debugger (cross-runtime tracing), technical-writer (docs/ maintenance).

Skills (slash-invocable): /qa-tester (all test stacks + Playwright), /api-contract (schema-change workflow), /db-migration (migration workflow), /perf-benchmark (benchmarks + canary), /deploy-preflight (pre-push checklist), /ui-audit (Playwright audit harness).

Commands: /review (working-diff review), /test (route to the right stack), /ship (pre-push pipeline), /plan-feature, /validate-idea, /debug, /sync-tickets, /docs-update.

Hooks: edits to routeTree.gen.ts, .tfstate, tracked migrations, and .env files are blocked; web/ and backend/ edits are auto-formatted (Biome / Prettier).

## Gotchas

- Shell is bash-on-Windows: use forward slashes and /dev/null, not NUL.
- Supabase CLI commands are invoked from backend/ but supabase/migrations/ lives at repo root.
- Unit-specific gotchas (web tsc-after-vite, backend Jest rootDir and lint --fix, agent hanging tests, etc.) live in each unit's CLAUDE.md.
