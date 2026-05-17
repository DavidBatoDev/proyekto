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

  @IsUrl({ require_tld: false })
  SUPABASE_URL: string;

  @IsString()
  SUPABASE_ANON_KEY: string;

  @IsString()
  SUPABASE_SERVICE_ROLE_KEY: string;

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
  OPENAI_API_KEY?: string;

  @IsOptional()
  @IsString()
  ROADMAP_AI_AUTO_TITLE_ENABLED?: string;
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
