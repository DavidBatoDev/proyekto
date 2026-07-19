---
name: deploy-preflight
description: Pre-push and pre-deploy checklist - the build-and-push policy, per-unit full builds, canary, schema check, and CI secrets gotchas. Use before pushing commits or when preparing a deploy.
---

# Skill: Deploy Preflight

CI is deploy-only - there are NO PR test gates. This checklist IS the quality gate. (Policy: full builds only when pushing; local work uses focused checks.)

## Per-changed-unit matrix

Determine changed units via `git diff --name-only` against the push base, then run the matching column:

| Unit changed | Required before push |
|---|---|
| web/ | `cd web && npm run check && npm test && npm run build` (tsc runs after Vite and fails the build on type errors) |
| backend/ | `cd backend && npm test && npm run build`; plus `npm run test:e2e` if module wiring changed; verify touched files with `npx eslint <files>` (NO --fix) |
| agent/ | `node scripts/test_agent_unit.mjs` (full) + `node scripts/validate_agent_canary_matrix.mjs` |
| realtime/ | `cd realtime && npm run typecheck && npm test` |
| schemas/ | `cd backend && npm run check:roadmap-ai-schema` + `node scripts/test_agent_unit.mjs tests.test_operation_contracts` + canary |
| supabase/ | review via /db-migration (immutability, latest-function-body, RLS) |

## CI / deploy gotchas

- **Cloud Run secrets are FULL-REPLACED on every deploy**: a new env var must be added to the SECRETS/env list in `.github/workflows/backend-deploy.yml` (or agent-deploy.yml) or it silently vanishes on the next deploy. Also register backend vars in `backend/src/config/env.validation.ts`.
- **Pushing web/ changes to main = deploying web**: the web app deploys via Vercel git integration on push. There is no separate web release step.
- backend/, agent/, realtime/ deploy via their GitHub Actions workflows on push to main (path-filtered). Realtime is NEVER deployed locally.
- Mobile OTA publishing is gated on the repo variable OTA_PUBLISH_ENABLED; Android store builds happen only on v*.*.* tags.
- Deploys of dormant/flag-gated features are safe by design - but confirm the flag really is off before pushing anything that changes flag defaults.

## Final gate

All matrix steps green -> commit -> push (the push itself is ask-gated). Any red step aborts the pipeline - never push over a failure.
