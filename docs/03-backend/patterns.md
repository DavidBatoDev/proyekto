# Patterns & Conventions

> **Last updated:** 2026-07-09 · **Status:** current

The rules every backend module follows. Learn these once and each of the ~24
modules reads the same way. All evergreen and verified against the current code.

## Repository pattern

Every module with database access splits into an **interface** (the contract) and a
**Supabase implementation**, injected through a `Symbol` DI token.

```ts
// repositories/payments.repository.interface.ts
export interface PaymentsRepository {
  findCheckpointById(id: string): Promise<PaymentCheckpoint | null>;
  fundEscrow(id: string): Promise<PaymentCheckpoint>;
}

// repositories/payments.repository.supabase.ts
@Injectable()
export class SupabasePaymentsRepository implements PaymentsRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async findCheckpointById(id: string) {
    const { data, error } = await this.db
      .from('payment_checkpoints').select('*').eq('id', id).single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data ?? null;
  }
}
```

Repositories are the **only** code that calls Supabase. Services depend on the
interface, never the implementation.

### Supabase error-code convention

| Code | Meaning | Handling |
| --- | --- | --- |
| `PGRST116` | `.single()` returned zero rows | Return `null` — don't throw |
| anything else | Real DB/network error | `throw new Error(error.message)` |

## Symbol DI token convention

The token is declared in the **service file** (or the controller, for modules with
a co-located service), then imported by the module — never the other way around, or
you get a circular reference.

```ts
// ✅ token lives in payments.service.ts
export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');

// payments.module.ts
import { PAYMENTS_REPOSITORY } from './payments.service';
@Module({
  providers: [
    PaymentsService,
    { provide: PAYMENTS_REPOSITORY, useClass: SupabasePaymentsRepository },
  ],
})
export class PaymentsModule {}

// inject it
constructor(@Inject(PAYMENTS_REPOSITORY) private readonly repo: PaymentsRepository) {}
```

## `import type` rule

`tsconfig` enables `isolatedModules` **and** `emitDecoratorMetadata`, so any
interface/type used as a **parameter type in a decorated method** must be imported
with `import type` — otherwise compilation fails (TS1272). It's a compiler
constraint, not an ESLint rule, so `tsc` is what catches it.

```ts
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import type { PaymentsRepository } from './repositories/payments.repository.interface';
```

## DTO validation

Request bodies are `class-validator` DTOs. The global `ValidationPipe`
(`whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`) strips unknown
fields, rejects extras, and coerces types.

```ts
export class CreateRoadmapDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() @IsOptional() description?: string;
  @IsUUID() @IsOptional() project_id?: string;
  @IsEnum(['draft', 'active', 'paused', 'completed', 'archived']) @IsOptional() status?: string;
}
```

- Optional fields carry `@IsOptional()`.
- Enums use **string-literal arrays** in `@IsEnum([...])`, not TS `enum`s (avoids
  `emitDecoratorMetadata` import pitfalls).

## Authorization in services

Owner/permission checks live in the **service**, never the controller. Controllers
pass `user.id`; services decide.

```ts
async update(id: string, dto: UpdateProjectDto, userId: string) {
  const existing = await this.repo.findById(id);
  if (!existing) throw new NotFoundException('Project not found');
  if (existing.owner_id !== userId) throw new ForbiddenException('Not the owner');
  return this.repo.update(id, dto);
}
```

Because the backend runs as the Supabase **service role**, this service-layer check
is the real gate; RLS is defense-in-depth.

## Bulk reorder

Position updates (epics/features/tasks) run as parallel scoped updates — the extra
`.eq(parentId)` prevents cross-parent moves.

```ts
const updates = dto.items.map((item) =>
  this.db.from('roadmap_epics')
    .update({ position: item.position })
    .eq('id', item.id)
    .eq('roadmap_id', roadmapId));         // scope guard
const results = await Promise.all(updates);
for (const { error } of results) if (error) throw new Error(error.message);
```

## HTTP status codes

| Situation | Code | How |
| --- | --- | --- |
| Created | 201 | Nest default for `@Post()` |
| Action, no body | 204 | `@HttpCode(HttpStatus.NO_CONTENT)` |
| Non-CRUD action | 200 | `@HttpCode(HttpStatus.OK)` on `@Post()` |
| Validation failure | 400 | Automatic from `ValidationPipe` |
| Unauthorized | 401 | `SupabaseAuthGuard` |
| Forbidden | 403 | `throw new ForbiddenException(...)` in service |
| Not found | 404 | `throw new NotFoundException(...)` in service |
| Stale revision | 409 | e.g. roadmap AI commit `revision_token` mismatch |
| Gone / deprecated | 410 | `throw new GoneException(...)` (retired assign/unassign routes) |

## Adding a module

1. `modules/<feature>/` with `dto/`, `repositories/{interface,supabase}.ts`.
2. Service exports the token: `export const FEATURE_REPOSITORY = Symbol('FEATURE_REPOSITORY')`.
3. Controller with `@UseGuards(SupabaseAuthGuard)`.
4. Module wires `{ provide: FEATURE_REPOSITORY, useClass: SupabaseFeatureRepository }`.
5. Import it into `app.module.ts`.
6. `npx tsc --noEmit` (the build typechecks; there's no separate lint gate you should run repo-wide — use `npx eslint <files>`).
