# Backend Architecture

> **Last updated:** 2026-07-09 · **Status:** current

The backend is a **NestJS 11** application organized as one root `AppModule` that
imports ~24 self-contained feature modules plus four global infra modules. Every
feature follows the same **controller → service → repository** split: controllers
do HTTP, services own business logic and **authorization**, and repositories are the
only code that touches Supabase. It runs as the Supabase **service role**, so
row-level security is defense-in-depth — the real gate is the service layer.

> The backend is the single writer to Postgres and the hub of the system: the web
> app calls it for all CRUD, the AI agent calls back into it for roadmap context
> and commits, and it fans realtime events out to the Cloudflare Worker.

## Layers

| Layer | Responsibility | Rule |
| --- | --- | --- |
| **Controller** | HTTP surface — routes, guards, DTO binding | Never makes authorization decisions; passes `user.id` down |
| **Service** | Business logic + **authorization** (owner/permission checks) | Throws `NotFound`/`Forbidden`; orchestrates repositories |
| **Repository** | Data access — the only place that calls Supabase | Interface + Supabase impl behind a `Symbol` DI token |

See [patterns.md](./patterns.md) for the repository/DI conventions and
[modules.md](./modules.md) for the per-module breakdown.

## Request lifecycle

```
  HTTP request
     │  helmet · compression · CORS (from CORS_ORIGINS)         [main.ts middleware]
     ▼
  Guard   SupabaseAuthGuard / AdminGuard / … (per-controller @UseGuards)
     │    attaches request.user  (401/403 on failure)           [common/guards]
     ▼
  ValidationPipe   whitelist + forbidNonWhitelisted + transform  [global, main.ts]
     ▼
  Controller  →  Service  (authz + logic)  →  Repository  →  Supabase (service role)
     │                                                             │
     ▼                                                             ▼
  ResponseInterceptor wraps the result as { data: … }        HttpExceptionFilter
                                                             catches errors → { error }
```

Interceptors are registered globally in `main.ts` in this order — **timeout →
logging → cache-policy → response**:

| Interceptor | Does |
| --- | --- |
| `RequestTimeoutInterceptor` | Aborts after `REQUEST_TIMEOUT_MS` (default 25 s) → 408 |
| `RequestLoggingInterceptor` | Logs `METHOD url -> status (Nms)`; warns past `SLOW_REQUEST_THRESHOLD_MS` (1.5 s) |
| `CachePolicyInterceptor` | Applies `@SetCachePolicy` `Cache-Control` + weak ETags; 304 on `If-None-Match` |
| `ResponseInterceptor` | Wraps every result as `{ data }` (opt out with `@RawResponse`) |

## Response envelope

Uniform, enforced globally:

```jsonc
// success — ResponseInterceptor (common/interceptors/response.interceptor.ts)
{ "data": { /* handler return value */ } }

// error — HttpExceptionFilter (common/filters/http-exception.filter.ts)
{ "error": { "message": "…", "status": 403, "path": "/api/…", "timestamp": "…" } }
```

Validation errors join class-validator messages with `; `; extra body fields (e.g.
`validation_issues`, `code`) are preserved as `extras`. External contracts that must
return a raw shape (the Capgo OTA endpoints) opt out with `@RawResponse()`.

## Dependency injection

- **Global infra modules** (imported once, available everywhere):
  `SupabaseModule` (`SUPABASE_ADMIN`, `SUPABASE_CLIENT`), `RedisModule`
  (`UPSTASH_REDIS_CLIENT`, nullable), `R2Module` (`R2_CLIENT`, `R2_CONFIG`),
  plus the global `RealtimePublisher` and `Audit` modules.
- **Repository tokens** are `Symbol`s declared in each service file and bound
  `{ provide: TOKEN, useClass: SupabaseImpl }` — see [patterns.md](./patterns.md).
- No global `APP_GUARD`/`APP_INTERCEPTOR` providers: guards are applied
  per-controller via `@UseGuards`, and interceptors/filters are constructed in
  `main.ts` bootstrap.

## Cross-cutting concerns

- **Rate limiting** — `ThrottlerModule` at 100 requests / 60 s, backed by
  `ThrottlerStorageRedisService` (Upstash; falls back to in-memory when Redis is absent).
- **Config** — validated at boot by `validateEnv` (class-validator). See
  [configuration.md](./configuration.md).
- **Tracing** — `server.ts` calls `initTracing()` before `main` so Google Cloud
  Trace / OpenTelemetry auto-instrumentation loads first (`ENABLE_CLOUD_TRACE`,
  service `proyekto-backend`).
- **Caching** — a Redis data cache (`RedisDataCacheService.rememberJson`) and a
  Cloudflare edge cache with purge (`CloudflareCachePurgeService`). See
  [Runbooks → Cloudflare cache](../12-runbooks/README.md).

## Bootstrap & entry points

| File | Role |
| --- | --- |
| [`backend/src/server.ts`](../../backend/src/server.ts) | Cloud Run container entry — tracing, then `main` |
| [`backend/src/main.ts`](../../backend/src/main.ts) | Nest bootstrap — middleware, prefix, pipe, filter, interceptors, listen |
| [`backend/src/app.module.ts`](../../backend/src/app.module.ts) | Root module — imports infra + feature modules, Throttler config |
| `backend/src/lambda.ts` | Orphaned Vercel/serverless adapter — **not deployed** |

## See also

- [project-structure.md](./project-structure.md) · [configuration.md](./configuration.md)
  · [auth-and-guards.md](./auth-and-guards.md) · [patterns.md](./patterns.md)
  · [modules.md](./modules.md) · [api-reference.md](./api-reference.md)
- [Architecture → system overview](../02-architecture/system-overview.md) for the cross-service picture.
