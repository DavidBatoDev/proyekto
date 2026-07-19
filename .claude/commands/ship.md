---
description: Pre-push pipeline - focused checks, per-unit full builds, canary, then commit and push
argument-hint: "[commit message]"
---

Ship the current work. Commit message (if provided): $ARGUMENTS

This is the ONLY quality gate - CI has no test jobs. Abort the pipeline on any red step; never push over a failure.

1. `git status` + `git diff --name-only` (incl. staged) - determine which units changed.
2. Load the **deploy-preflight** skill and run its per-unit matrix for exactly the changed units (full builds are justified here - this is push-tier work).
3. If schemas/ changed: `cd backend && npm run check:roadmap-ai-schema` + agent contract test. If agent/ or schemas/ changed: `node scripts/validate_agent_canary_matrix.mjs`.
4. If backend env vars were added: confirm they are in backend/src/config/env.validation.ts AND the deploy workflow secrets list (Cloud Run full-replaces secrets).
5. All green -> commit ($ARGUMENTS as the message, or write one describing the change; follow repo style from `git log`).
6. Push (this triggers the ask-gate - expected). Remind before pushing: a main push deploys web via Vercel immediately, and path-filtered workflows deploy backend/agent/realtime.
7. Report: steps run with results, commit hash, what the push will deploy.
