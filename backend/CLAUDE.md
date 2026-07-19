# backend/ - NestJS 11 API

Local context for the backend unit. Cross-cutting rules live in the root CLAUDE.md.

## Commands (run from backend/)

- npm run dev - nest start --watch (port 3001, global prefix /api)
- npm test - Jest (config inline in package.json, rootDir is src/, picks up *.spec.ts)
- npx jest path/to/file.spec.ts - single spec. Jest rootDir is src/ - pass paths RELATIVE TO backend/src/ (or absolute).
- npm run test:e2e - Jest via test/jest-e2e.json
- npm run check:roadmap-ai-schema - validates the shared schema in schemas/ (run after any contract change)
- npm run check:roadmap-templates
- npm run build - nest build (push-tier only, per root Build and Push Policy)

## CRITICAL lint gotcha

`npm run lint` runs ESLint with --fix over ALL of src/ - it will rewrite files you never touched. To verify specific files, use `npx eslint <files>` WITHOUT --fix. Never use `npm run lint` as a check.

## Module conventions

- 26 feature modules under src/modules/ (the list drifts - `ls src/modules` is the source of truth). Each module: controllers/, services/, repositories/, dto/ subfolders plus *.module.ts, wired in src/app.module.ts.
- Repository pattern: interface (`*.repository.interface.ts`) + Supabase impl (`*.repository.supabase.ts`). Update both together.
- DTOs use class-validator. The global ValidationPipe runs whitelist + forbidNonWhitelisted - any request field not declared on the DTO makes the request 400. New fields MUST be added to the DTO.
- ResponseInterceptor wraps every response in an envelope - controllers return raw data; never hand-wrap responses.
- Guards: SupabaseAuthGuard (default auth), ConsultantOnlyGuard (verified-consultant surfaces, keyed on profiles.is_consultant_verified, not the active persona). Every new route needs a guard unless it is deliberately public.

## Entry points and config

- src/server.ts is the Cloud Run container entry (tracing + main.ts); src/main.ts is the standalone bootstrap. src/lambda.ts is an ORPHANED Vercel adapter - ignore it, do not extend it.
- src/config/env.validation.ts validates env at boot - new env vars must be registered there AND added to the SECRETS/env list in .github/workflows/backend-deploy.yml. Cloud Run deploys FULL-REPLACE secrets: a var missing from the workflow silently disappears on the next deploy.
- Supabase clients (anon + service role) come from src/config/supabase.module.ts; Upstash Redis via src/config/redis.module.ts (also backs the throttler).

## Supabase CLI

The CLI is invoked from backend/ (npx supabase ...), but migrations live at repo-root supabase/. Read supabase/CLAUDE.md BEFORE touching migrations - prod apply does not go through the CLI.

## Testing rule

Do not mock the database in integration tests - use real Supabase or a test schema (past incident: mock/prod divergence masked a broken migration). Mock only at system boundaries.
