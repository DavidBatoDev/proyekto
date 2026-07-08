# Architecture Overview

## Pattern: Clean Architecture with Repository DAL

Every feature module follows a strict 4-layer stack:

```
HTTP Request
     │
     ▼
┌─────────────────────┐
│     Controller      │  Receives HTTP, validates params, calls service
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│      Service        │  Business logic, authorization checks, orchestration
└──────────┬──────────┘
           │  (injects via Symbol token — no Supabase code here)
           ▼
┌─────────────────────┐
│ Repository Interface│  TypeScript contract (DAL abstraction)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Supabase Repository │  Concrete implementation — all DB calls live here
└──────────┬──────────┘
           │
           ▼
     Supabase DB
```

### Why this matters

- **Services never import `@supabase/supabase-js`** — all database logic is isolated in `*.repository.supabase.ts` files
- Swapping the database (e.g. to Prisma) only requires new `*.repository.prisma.ts` files — no service changes
- Unit testing services only requires mocking the repository interface

---

## Dependency Injection Strategy

Each module defines a **Symbol token** in its service file and uses it to bind the concrete repository:

```typescript
// payments.service.ts
export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENTS_REPOSITORY) private readonly repo: PaymentsRepository,
  ) {}
}

// payments.module.ts
import { PAYMENTS_REPOSITORY } from './payments.service';
@Module({
  providers: [
    PaymentsService,
    { provide: PAYMENTS_REPOSITORY, useClass: SupabasePaymentsRepository },
  ],
})
```

This prevents circular imports (module → service → module) and keeps the token co-located with its consumer.

---

## Global Infrastructure

```
AppModule
  ├── ConfigModule          (isGlobal: true — available everywhere)
  ├── ThrottlerModule       (100 req / 60 s)
  ├── SupabaseModule        (@Global — SUPABASE_ADMIN + SUPABASE_CLIENT tokens)
  └── [12 Feature Modules]
```

### Supabase Clients

Two clients are provided globally via `SupabaseModule`:

| Token | Key Used | RLS | Purpose |
|---|---|---|---|
| `SUPABASE_ADMIN` | `SUPABASE_SERVICE_ROLE_KEY` | Bypassed | All repository DB operations |
| `SUPABASE_CLIENT` | `SUPABASE_ANON_KEY` | Enforced | JWT verification in `SupabaseAuthGuard` |

---

## Request Lifecycle

```
Incoming Request
       │
       ▼
  helmet()           — Security headers
  compression()      — Gzip
       │
       ▼
  ThrottlerGuard     — Rate limit check (100/60s)
       │
       ▼
  SupabaseAuthGuard  — JWT or guest session validation
       │
       ▼
  PersonaGuard       — (if @Personas() decorator present)
  AdminGuard         — (if route requires admin)
       │
       ▼
  ValidationPipe     — DTO validation (whitelist, forbidNonWhitelisted, transform)
       │
       ▼
  Controller method
       │
       ▼
  ResponseInterceptor — Wraps result in { data: ... }
       │           (or HttpExceptionFilter on error → { error: { message, status, path, timestamp } })
       ▼
  HTTP Response
```

---

## Response Envelope

### Success
```json
{
  "data": { ... }
}
```

### Error
```json
{
  "error": {
    "message": "Roadmap not found",
    "status": 404,
    "path": "/api/roadmaps/abc",
    "timestamp": "2026-03-01T12:00:00.000Z"
  }
}
```
