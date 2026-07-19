---
description: Run the right Proyekto test stack, routed by argument or by what changed
argument-hint: "[unit|web|backend|agent|realtime|e2e|all|<file path>]"
---

Run tests for: $ARGUMENTS

Routing rules (the /qa-tester skill holds full details - load it if writing new tests):

- **No argument**: infer changed units from `git diff --name-only` (plus staged) and run each changed unit's stack.
- **unit**: all four unit stacks - `cd web && npm test`, `cd backend && npm test`, `node scripts/test_agent_unit.mjs`, `cd realtime && npm test`. No e2e.
- **web / backend / agent / realtime**: that unit's stack only.
- **e2e**: backend `npm run test:e2e`; for Playwright confirm the dev server is on localhost:3000 and auth state exists (`npm run pw:auth`) before `npm run pw:test`.
- **all**: unit + e2e.
- **A file path**: run just that spec with the stack's single-spec quirk - backend: `cd backend && npx jest <path relative to backend/src/>`; web: `cd web && npx vitest run <path>`; agent: `node scripts/test_agent_unit.mjs tests.<module_name>`.

Rules: if an agent test hangs, delete it (standing rule - do not retry-loop). Report pass/fail counts, failing test names with error excerpts, and coverage gaps.
