# AGENTS.md

Agent context for Proyekto - a monorepo with six deployable units: React 19 web SPA (web/), NestJS 11 API on Cloud Run (backend/), Python FastAPI AI agent on Cloud Run (agent/ - a single v2 tool-calling loop over the OpenAI Responses API), a dormant Cloudflare Worker + Durable Objects realtime service (realtime/), Supabase migrations + edge functions (supabase/), and Terraform (infra/). The shared backend<->agent contract lives at schemas/roadmap-ai-operations.json.

## Canonical guidance

Read the CLAUDE.md files - they are the maintained source of truth for agent guidance:

- CLAUDE.md (root) - product context, repo layout, build-and-push policy, cross-service architecture
- web/CLAUDE.md - commands, Biome, routing, theme tokens, Playwright, Capacitor
- backend/CLAUDE.md - commands, module conventions, guards, the lint --fix gotcha
- agent/CLAUDE.md - v2 loop layout, test wrapper, contract tests
- realtime/CLAUDE.md - dormant-behind-flags status, bindings, deploy policy
- supabase/CLAUDE.md - migration immutability, prod apply path
- infra/CLAUDE.md - Terraform state policy
- docs/CLAUDE.md - documentation conventions (docs/STYLE.md)

The setup guide is docs/00-getting-started/setup.md (root SETUP.md was deleted). Architecture: docs/02-architecture/.

## Skills (slash-invocable, in .claude/skills/)

- /qa-tester - write/run/triage tests across all four test stacks + Playwright e2e (moved from .agents/skills/qa-tester/)
- /api-contract - roadmap-ai-operations schema-change workflow
- /db-migration - migration authoring + prod apply workflow
- /perf-benchmark - benchmark suite + agent canary
- /deploy-preflight - pre-push checklist (CI has no test gates)
- /ui-audit - Playwright audit harness (routes/dark/hovers)

Commands (.claude/commands/): /review, /test, /ship, /plan-feature, /validate-idea, /debug, /sync-tickets, /docs-update.

## Hard rules (deliberately duplicated from the /qa-tester skill)

- Do not mock the database in backend integration tests (past incident: mock/prod divergence masked a broken migration).
- If node scripts/test_agent_unit.mjs hangs on a new test, delete the test rather than retrying.
