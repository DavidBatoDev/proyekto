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
