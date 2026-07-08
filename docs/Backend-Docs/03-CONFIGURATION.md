# Configuration & Environment

## Environment Validation

All required environment variables are validated at **startup** using `class-validator` in `src/config/env.validation.ts`. If any required variable is missing or invalid, the app **refuses to start** and prints a descriptive error.

```typescript
// src/config/env.validation.ts
class EnvironmentVariables {
  @IsEnum(Environment)   NODE_ENV: Environment = 'development';
  @IsNumber()            PORT: number = 3001;
  @IsUrl()               SUPABASE_URL: string;
  @IsString()            SUPABASE_ANON_KEY: string;
  @IsString()            SUPABASE_SERVICE_ROLE_KEY: string;
  @IsString()            CLIENT_URL: string = 'http://localhost:3000';
}
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | ✓ | `development` | Runtime environment: `development`, `production`, `test` |
| `PORT` | | `3001` | HTTP listen port |
| `SUPABASE_URL` | ✓ | — | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | ✓ | — | Public JWT — used in `SupabaseAuthGuard` to verify user tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | — | Service role — used in all repositories, bypasses RLS |
| `CLIENT_URL` | ✓ | `http://localhost:3000` | CORS allowed origin (your frontend URL) |

## `.env` Setup

```bash
cp backend/.env.example backend/.env
# then edit backend/.env with your Supabase project credentials
```

## Supabase Module

`src/config/supabase.module.ts` is decorated `@Global()`, making both clients available for injection anywhere without re-importing the module.

```typescript
// Two Symbol tokens exported for injection
export const SUPABASE_ADMIN  = Symbol('SUPABASE_ADMIN');   // service role client
export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');  // anon key client
```

### Injecting in a repository

```typescript
@Injectable()
export class PaymentsRepositorySupabase {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
  ) {}
}
```

### Injecting the anon client (auth guard only)

```typescript
@Inject(SUPABASE_CLIENT) private readonly supabaseClient: SupabaseClient,
```

## main.ts Bootstrap Configuration

```typescript
app.use(helmet());                    // Security headers
app.use(compression());               // Gzip responses
app.enableCors({ origin: CLIENT_URL, credentials: true });
app.setGlobalPrefix('api');           // All routes: /api/*
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,                    // Strip unknown fields
  forbidNonWhitelisted: true,         // 400 on unknown fields
  transform: true,                    // Auto-cast to DTO types
  transformOptions: { enableImplicitConversion: true },
}));
app.useGlobalFilters(new HttpExceptionFilter());
app.useGlobalInterceptors(new ResponseInterceptor());
```
