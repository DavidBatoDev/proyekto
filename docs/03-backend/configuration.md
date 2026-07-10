# Configuration

> **Last updated:** 2026-07-09 · **Status:** current

All environment variables are **validated at boot** by `validateEnv`
([`config/env.validation.ts`](../../backend/src/config/env.validation.ts)) using
class-validator — the process refuses to start on a missing required var or a
malformed value. This page is the env reference plus how the shared clients
(Supabase, Redis, R2) are provided. For *where* these values come from in
production (Secret Manager vs `--set-env-vars`), see
[Architecture → deploy topology](../02-architecture/deploy-topology.md).

## Environment variables

Grouped as they appear in the validation schema. Required = the app won't boot
without it; everything else has a default or is optional.

### Runtime & server

| Var | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `PORT` | `3001` | 8080 in the Cloud Run container |
| `REQUEST_TIMEOUT_MS` | `25000` | Global request timeout → 408 |
| `SLOW_REQUEST_THRESHOLD_MS` | `1500` | Logs a warning past this |
| `SUPABASE_FETCH_TIMEOUT_MS` | `12000` | Wraps every Supabase client fetch |
| `CORS_ORIGINS` | `localhost:3000,5173` | Comma-separated allowed origins |
| `CLIENT_URL` / `PUBLIC_API_URL` | — | Frontend origin / public API base |

### Supabase (required)

| Var | Notes |
| --- | --- |
| `SUPABASE_URL` | Project URL (validated `@IsUrl`) |
| `SUPABASE_ANON_KEY` | Anon client (JWT verification fallback) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role client (bypasses RLS) |
| `SUPABASE_JWT_SECRET` | *Optional* — enables **local** HS256 JWT verify (fast path) |

### Cloudflare R2 (required — file storage)

| Var | Default |
| --- | --- |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | — (required) |
| `R2_PUBLIC_BUCKET` | `proyekto-media` |
| `R2_PRIVATE_BUCKET` | `proyekto-private` |
| `R2_PUBLIC_BASE_URL` | `https://cdn.proyekto.tech` |

### Upstash Redis (optional — degrades gracefully)

| Var | Notes |
| --- | --- |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | If absent, `UPSTASH_REDIS_CLIENT` is `null` and caches/throttler fall back to in-memory |
| `REDIS_DATA_CACHE_ENABLED` + `REDIS_CACHE_*_TTL_SECONDS`, `REDIS_CACHE_TTL_JITTER_PERCENT` | Data-cache tuning |

### HTTP cache policy

`CACHE_PUBLIC_MAX_AGE_SECONDS`, `CACHE_PUBLIC_S_MAX_AGE_SECONDS`,
`CACHE_PUBLIC_STALE_WHILE_REVALIDATE_SECONDS`, `CACHE_PRIVATE_MAX_AGE_SECONDS`,
`CACHE_PRIVATE_STALE_WHILE_REVALIDATE_SECONDS` — feed the `Cache-Control` presets
used by `@SetCachePolicy`.

### Cloudflare cache purge (optional)

`CLOUDFLARE_PURGE_ENABLED` (default off), `CLOUDFLARE_ZONE_ID`,
`CLOUDFLARE_PURGE_API_TOKEN`, `CLOUDFLARE_PURGE_TIMEOUT_MS`.

### Realtime — Durable Objects (optional, ship-dark)

`REALTIME_WORKER_URL`, `REALTIME_PUBLISH_TOKEN`, `REALTIME_PUBLISH_TIMEOUT_MS`.
Publishing is a no-op unless both URL and token are set. See
[Realtime](../06-realtime/README.md).

### Firebase / FCM push (optional)

`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`,
`FIREBASE_USE_ADC` (keyless via Application Default Credentials on Cloud Run),
`PUSH_SEND_TIMEOUT_MS`. See [Mobile → push](../09-mobile/README.md).

### Email, AI, and misc

| Var | Notes |
| --- | --- |
| `OPENAI_API_KEY` | Roadmap-AI title/metadata generation (backend side) |
| `GMAIL_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` / `GMAIL_FROM_EMAIL` | Transactional email (required) |
| `ROADMAP_AI_AUTO_TITLE_ENABLED` | Auto-title AI sessions |
| `JITSI_BASE_URL` | Default `https://meet.jit.si` (meetings video) |
| `MEETINGS_CRON_SECRET` | Shared secret for the reminder cron endpoint |
| `OTA_PUBLISH_TOKEN` | Guards the mobile OTA bundle-registration endpoints |
| `ENABLE_CLOUD_TRACE`, `CLOUD_TRACE_SAMPLE_RATIO`, `OTEL_SERVICE_NAME` | Tracing |

## Shared clients

### Supabase (`config/supabase.module.ts`, `@Global`)

Two clients, both wrapped with a `withFetchTimeout()` custom fetch:

| Token | Client | Use |
| --- | --- | --- |
| `SUPABASE_ADMIN` | Service role, no session persistence | Repositories — the default data client (bypasses RLS) |
| `SUPABASE_CLIENT` | Anon key | `SupabaseAuthGuard` JWT `getUser` fallback |

Both are `Symbol` tokens; inject with `@Inject(SUPABASE_ADMIN)`.

### Redis (`config/redis.module.ts`, `@Global`)

`UPSTASH_REDIS_CLIENT` is `new Redis({ url, token })` — or **`null`** if either
credential is missing. Every consumer (throttler storage, `RedisDataCacheService`)
checks for null and degrades to in-memory / bypass, so local dev works without Redis.

### R2 (`config/r2.module.ts`, `@Global`)

- `R2_CLIENT` — an AWS S3 v3 `S3Client` pointed at
  `https://<account>.r2.cloudflarestorage.com`, `region: 'auto'`, path-style, with
  checksum flags set to `WHEN_REQUIRED` (R2 rejects the SDK's default flexible checksums).
- `R2_CONFIG` — `{ publicBucket, privateBucket, publicBaseUrl }`.

Used by [`uploads/`](./modules.md) to route public buckets over
`cdn.proyekto.tech` and private buckets (`identity_documents`, `payout_proofs`)
behind presigned GETs.

### Throttler storage (`config/throttler-storage.service.ts`)

`ThrottlerStorageRedisService` uses Upstash when present (pipeline `incr`+`ttl`,
separate block key), else an in-memory map — so rate limiting works in every
environment.

## Local setup

A first-run guide belongs in [Getting Started](../00-getting-started/README.md)
(planned). The short version: `cd backend`, copy `.env.example` → `.env`, fill the
required Supabase / R2 / Gmail values, `npm install`, `npm run dev`
(`http://localhost:3001/api`).
