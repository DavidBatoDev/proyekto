import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsOptional()
  @IsNumber()
  PORT: number = 3001;

  @IsOptional()
  @IsNumber()
  REQUEST_TIMEOUT_MS: number = 25000;

  @IsOptional()
  @IsNumber()
  SLOW_REQUEST_THRESHOLD_MS: number = 1500;

  @IsOptional()
  @IsNumber()
  SUPABASE_FETCH_TIMEOUT_MS: number = 12000;

  @IsOptional()
  @IsString()
  ENABLE_CLOUD_TRACE?: string;

  @IsOptional()
  @IsString()
  CLOUD_TRACE_SAMPLE_RATIO?: string;

  @IsOptional()
  @IsString()
  OTEL_SERVICE_NAME?: string;

  @IsOptional()
  @IsString()
  OTEL_DEBUG_LOGS?: string;

  @IsUrl({ require_tld: false })
  SUPABASE_URL: string;

  @IsString()
  SUPABASE_ANON_KEY: string;

  @IsString()
  SUPABASE_SERVICE_ROLE_KEY: string;

  // Cloudflare R2 storage (S3-compatible). Public assets are served from
  // R2_PUBLIC_BUCKET over the R2_PUBLIC_BASE_URL custom domain; private objects
  // (identity documents) live in R2_PRIVATE_BUCKET with no public access.
  @IsString()
  R2_ACCOUNT_ID: string;

  @IsString()
  R2_ACCESS_KEY_ID: string;

  @IsString()
  R2_SECRET_ACCESS_KEY: string;

  @IsOptional()
  @IsString()
  R2_PUBLIC_BUCKET: string = 'proyekto-media';

  @IsOptional()
  @IsString()
  R2_PRIVATE_BUCKET: string = 'proyekto-private';

  @IsOptional()
  @IsString()
  R2_PUBLIC_BASE_URL: string = 'https://cdn.proyekto.tech';

  // Supabase project JWT secret (Settings > API > JWT Settings). When set, the
  // auth guard verifies access tokens locally (HS256) instead of making a
  // network call to GoTrue on every request. Optional: if unset, the guard
  // falls back to the slower network verification, so auth keeps working.
  @IsOptional()
  @IsString()
  SUPABASE_JWT_SECRET?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS: string = 'http://localhost:3000,http://localhost:5173';

  @IsOptional()
  @IsUrl({ require_tld: false })
  UPSTASH_REDIS_REST_URL: string;

  @IsOptional()
  @IsString()
  UPSTASH_REDIS_REST_TOKEN: string;

  @IsString()
  CLIENT_URL: string = 'http://localhost:3000';

  @IsOptional()
  @IsString()
  PUBLIC_API_URL?: string;

  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsString()
  GMAIL_CLIENT_ID: string;

  @IsString()
  GMAIL_CLIENT_SECRET: string;

  @IsString()
  GMAIL_REFRESH_TOKEN: string;

  @IsOptional()
  @IsString()
  GMAIL_FROM_EMAIL?: string;

  @IsOptional()
  @IsString()
  ROADMAP_AI_AUTO_TITLE_ENABLED?: string;

  @IsOptional()
  @IsNumber()
  CACHE_PUBLIC_MAX_AGE_SECONDS?: number;

  @IsOptional()
  @IsNumber()
  CACHE_PUBLIC_S_MAX_AGE_SECONDS?: number;

  @IsOptional()
  @IsNumber()
  CACHE_PUBLIC_STALE_WHILE_REVALIDATE_SECONDS?: number;

  @IsOptional()
  @IsNumber()
  CACHE_PRIVATE_MAX_AGE_SECONDS?: number;

  @IsOptional()
  @IsNumber()
  CACHE_PRIVATE_STALE_WHILE_REVALIDATE_SECONDS?: number;

  @IsOptional()
  @IsString()
  REDIS_DATA_CACHE_ENABLED?: string;

  @IsOptional()
  @IsNumber()
  REDIS_CACHE_PUBLIC_TTL_SECONDS?: number;

  @IsOptional()
  @IsNumber()
  REDIS_CACHE_AUTH_TTL_SECONDS?: number;

  @IsOptional()
  @IsString()
  REDIS_CACHE_DEBUG_HEADERS?: string;

  @IsOptional()
  @IsNumber()
  REDIS_CACHE_MARKETPLACE_INDEX_TTL_SECONDS?: number;

  @IsOptional()
  @IsNumber()
  REDIS_CACHE_TTL_JITTER_PERCENT?: number;

  @IsOptional()
  @IsString()
  CLOUDFLARE_PURGE_ENABLED?: string;

  @IsOptional()
  @IsString()
  CLOUDFLARE_ZONE_ID?: string;

  @IsOptional()
  @IsString()
  CLOUDFLARE_PURGE_API_TOKEN?: string;

  @IsOptional()
  @IsNumber()
  CLOUDFLARE_PURGE_TIMEOUT_MS?: number;

  // Realtime (Cloudflare Durable Objects) fan-out. When both URL + token are
  // set, the backend publishes collaborative-feature events to the Worker;
  // unset = dormant (no-op), so the feature can ship dark.
  @IsOptional()
  @IsString()
  REALTIME_WORKER_URL?: string;

  @IsOptional()
  @IsString()
  REALTIME_PUBLISH_TOKEN?: string;

  @IsOptional()
  @IsNumber()
  REALTIME_PUBLISH_TIMEOUT_MS?: number;

  // Firebase Admin (FCM) push notifications. When all three are set, the backend
  // sends pushes to registered device tokens via firebase-admin; unset = push is
  // a no-op (dev/CI/tests), so the rest of the app is unaffected. FIREBASE_PRIVATE_KEY
  // is the service-account PEM; store it with literal "\n" escapes (un-escaped at runtime).
  @IsOptional()
  @IsString()
  FIREBASE_PROJECT_ID?: string;

  @IsOptional()
  @IsString()
  FIREBASE_CLIENT_EMAIL?: string;

  @IsOptional()
  @IsString()
  FIREBASE_PRIVATE_KEY?: string;

  // Keyless auth: when 'true' (and FIREBASE_PROJECT_ID is set, with no key pair),
  // the backend authenticates to FCM via Application Default Credentials —
  // Workload Identity on Cloud Run or `gcloud auth application-default login`
  // locally. Use this when org policy blocks downloadable service-account keys.
  @IsOptional()
  @IsString()
  FIREBASE_USE_ADC?: string;

  // Upper bound (ms) on the FCM send awaited inside notification creation, so a
  // slow/failing push never blocks the action that created the notification.
  @IsOptional()
  @IsNumber()
  PUSH_SEND_TIMEOUT_MS?: number;

  // Shared bearer secret guarding the self-hosted OTA publish endpoints
  // (/api/mobile-updates/bundles*). Only CI needs it; the public check/stats
  // endpoints work without it. Unset = publishing is closed (guard denies all).
  @IsOptional()
  @IsString()
  OTA_PUBLISH_TOKEN?: string;

  // Base URL for auto-generated no-auth video rooms (meeting scheduling). Each
  // Jitsi meeting gets a unique room under this host. Unset = the public
  // meet.jit.si instance, so the feature works with no secrets or config.
  @IsOptional()
  @IsString()
  JITSI_BASE_URL: string = 'https://meet.jit.si';

  // Shared secret guarding the scheduler-triggered meeting reminder endpoint
  // (POST /api/meetings/cron/reminders, sent as the `x-cron-secret` header).
  // Unset = the endpoint denies all callers (reminders simply aren't delivered).
  @IsOptional()
  @IsString()
  MEETINGS_CRON_SECRET?: string;

  // ── Knowledge pipeline (roadmap AI RAG) — ships dark ────────────────────────
  // Gates the write-path outbox hooks and the ingest run itself. Unset/false =
  // zero footprint: no outbox rows are written and runIngest() short-circuits.
  @IsOptional()
  @IsString()
  KNOWLEDGE_INGEST_ENABLED?: string;

  // Shared secret guarding the scheduler-triggered knowledge ingest endpoint
  // (POST /api/knowledge/cron/ingest, sent as the `x-cron-secret` header).
  // Unset = the endpoint denies all callers.
  @IsOptional()
  @IsString()
  KNOWLEDGE_INGEST_SECRET?: string;

  // ── Google Calendar / Meet OAuth (per-user; meeting scheduling Phase 5) ─────
  // All optional so the feature ships dark: unless GOOGLE_OAUTH_ENABLED==='true'
  // AND the client id/secret are present, the Google Meet option is hidden and
  // nothing changes. Distinct from the GMAIL_* / GOOGLE_* credentials the mailer
  // uses — do NOT reuse those names here.
  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_ENABLED?: string;

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_SECRET?: string;

  // Must equal the redirect URI registered on the Google OAuth client, e.g.
  // https://api.proyekto.tech/api/meetings/google/callback (note the /api prefix).
  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_REDIRECT_URI?: string;

  // Base64-encoded 32-byte AES-256-GCM key encrypting stored refresh tokens at
  // rest. Unset (or wrong length) = tokens stored in plaintext (dev only).
  @IsOptional()
  @IsString()
  GOOGLE_TOKEN_ENC_KEY?: string;

  // ── Model Context Protocol (MCP) server — ships dark ────────────────────────
  // Master kill switch for the first-party Proyekto MCP server. Unless set to
  // 'true', the /mcp endpoint returns 503 and the PAT issuance endpoints deny
  // all callers, so the module lands cold and is activated in a later step.
  @IsOptional()
  @IsString()
  MCP_ENABLED?: string;

  // Upper bound on rows returned by a single paginated MCP read tool. Optional;
  // the module falls back to a conservative built-in default when unset.
  @IsOptional()
  @IsNumber()
  MCP_MAX_PAGE_SIZE?: number;
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
