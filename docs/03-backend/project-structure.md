# Project Structure

> **Last updated:** 2026-07-09 · **Status:** current

Where everything lives under `backend/src/`. Two things to internalize: **global
concerns sit in `config/` and `common/`**, and **every feature is a self-contained
folder under `modules/`** with the same internal shape.

## Top level

```
backend/
  Dockerfile              two-stage node:22-alpine build; starts `node dist/server`
  package.json            Jest config is inline; rootDir is src/
  eslint.config.mjs       flat config (recommendedTypeChecked + prettier)
  src/
    server.ts             Cloud Run entry — initTracing() then ./main
    main.ts               Nest bootstrap (middleware, prefix, pipe, filter, interceptors)
    tracing.ts            OpenTelemetry → Google Cloud Trace
    lambda.ts             orphaned Vercel/serverless adapter — NOT deployed
    app.module.ts         root module: infra + 24 feature modules, Throttler
    app.controller.ts     GET / health ("status":"ok"), excluded from /api prefix
    config/               global infra providers (see below)
    common/               cross-cutting utilities (see below)
    modules/              the 24 feature modules
```

## `config/` — global infra providers

| File | Provides |
| --- | --- |
| `env.validation.ts` | `validateEnv` — class-validator schema for all env vars |
| `supabase.module.ts` | `SUPABASE_ADMIN` (service role) + `SUPABASE_CLIENT` (anon), fetch-timeout wrapped |
| `redis.module.ts` + `redis.tokens.ts` | `UPSTASH_REDIS_CLIENT` (nullable) + the cache services |
| `r2.module.ts` | `R2_CLIENT` (S3 SDK → Cloudflare R2) + `R2_CONFIG` (buckets, base URL) |
| `throttler-storage.service.ts` | `ThrottlerStorageRedisService` (Redis or in-memory) |

All four modules are `@Global()`, so their tokens inject anywhere without a
per-module import. See [configuration.md](./configuration.md).

## `common/` — cross-cutting utilities

```
common/
  guards/         supabase-auth · admin · persona · cron-secret · consultant-only
  decorators/     @CurrentUser · @Public · @Personas · @SetCachePolicy · @RawResponse
  interceptors/   request-timeout · request-logging · cache-policy · response
  filters/        http-exception.filter.ts  ({ error } envelope)
  cache/          redis-data-cache · cloudflare-cache-purge · redis-cache-invalidation
                  · redis-cache.keys · cache-policy (Cache-Control presets)
  interfaces/     authenticated-request.interface.ts (AuthenticatedUser)
  entities/       domain type barrel (Project, ResourceFolder, …)
  pipes/          (empty — validation is the global ValidationPipe)
```

See [auth-and-guards.md](./auth-and-guards.md) for the guards/decorators and
[architecture.md](./architecture.md) for the interceptor/filter chain.

## `modules/` — feature module anatomy

Each feature module is a folder with a consistent internal shape:

```
modules/<feature>/
  <feature>.module.ts             wiring: controllers + providers + { provide: TOKEN, useClass }
  <feature>.controller.ts         HTTP routes + @UseGuards
  <feature>.service.ts            business logic + authorization; exports the Symbol DI token
  dto/                            class-validator request DTOs
  repositories/
    <feature>.repository.interface.ts   the contract
    <feature>.repository.supabase.ts    the Supabase implementation
```

Variations you'll see (all intentional):

- **Multiple controllers per module** — `roadmaps/` has 9 (`roadmaps`, `epics`,
  `features`, `tasks`, `task-extras`, `milestones`, `roadmap-patch`, `roadmap-ai`,
  `roadmap-ai-sessions`); `chat/` has 4; `teams/` has 3.
- **Co-located service** — `uploads/`, `applications/`, and `guests/` define their
  `*Service` inside the controller file (no separate service file).
- **No repository** — `consultants/`, `marketplace/`, `notifications/` query
  Supabase directly from the service; `realtime/` and `audit/` have no tables at all.
- **Sub-modules** — `projects/` nests `authorization/` and `access-sync/`.

The full inventory is in [modules.md](./modules.md); the HTTP surface is in
[api-reference.md](./api-reference.md).

## Naming conventions

- Files: `kebab-case.ts`; classes: `PascalCase`; DI tokens: `SCREAMING_SNAKE` `Symbol`s.
- Repository interface `FooRepository`, Supabase impl `SupabaseFooRepository`.
- Types used as parameter types in decorated methods are imported with
  `import type` (required by `isolatedModules` + `emitDecoratorMetadata`) — see
  [patterns.md](./patterns.md).
