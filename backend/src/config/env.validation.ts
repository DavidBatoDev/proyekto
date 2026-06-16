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
