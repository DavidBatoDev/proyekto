# Patterns & Conventions

## Repository Pattern

Every module with database access follows this structure:

### 1. Interface (contract)

```typescript
// payments.repository.interface.ts
export interface PaymentsRepository {
  findCheckpointById(id: string): Promise<PaymentCheckpoint | null>;
  fundEscrow(id: string): Promise<any>;
  // ...
}
```

### 2. Supabase Implementation

```typescript
// payments.repository.supabase.ts
@Injectable()
export class SupabasePaymentsRepository implements PaymentsRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async findCheckpointById(id: string) {
    const { data, error } = await this.db
      .from('payment_checkpoints')
      .select('*')
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data ?? null;
  }
}
```

### 3. Supabase error code convention

| Code | Meaning | Handling |
|---|---|---|
| `PGRST116` | Zero rows returned by `.single()` | Return `null` (don't throw) |
| Any other | Actual DB/network error | `throw new Error(error.message)` |

---

## DTO Validation

All request bodies use `class-validator` DTOs. The global `ValidationPipe` with `whitelist: true` automatically strips any fields not declared in the DTO.

```typescript
export class CreateRoadmapDto {
  @IsString() @MaxLength(200) name: string;
  @IsString() @IsOptional() description?: string;
  @IsUUID() @IsOptional() project_id?: string;
  @IsEnum(['draft', 'active', 'paused', 'completed', 'archived']) @IsOptional() status?: string;
}
```

**Rules:**
- All optional fields are decorated with `@IsOptional()`
- Enums always use string literal arrays in `@IsEnum([...])` — not TypeScript enums (avoids `import type` issues with `emitDecoratorMetadata`)
- Types used only as TypeScript type annotations in DTOs must use `import type`

---

## `import type` Rule

Because `tsconfig.json` has both `isolatedModules` and `emitDecoratorMetadata` enabled, **any interface or type used as a parameter type in a decorated method must be imported with `import type`**:

```typescript
// ✅ Correct
import type { AuthenticatedUser } from '../../common/interfaces/...';
import type { PaymentsRepository } from './repositories/...';

// ❌ Breaks compilation (TS1272)
import { AuthenticatedUser } from '../../common/interfaces/...';
```

---

## Symbol DI Token Convention

Tokens are defined in the **service file** (or controller for modules without a separate service), then imported by the module:

```typescript
// ✅ Token lives in payments.service.ts
export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');

// ✅ Module imports the token from the service
import { PAYMENTS_REPOSITORY } from './payments.service';
@Module({
  providers: [{ provide: PAYMENTS_REPOSITORY, useClass: SupabasePaymentsRepository }]
})
```

```typescript
// ❌ Circular reference: service imports token from module which imports service
export const PAYMENTS_REPOSITORY = Symbol('...');  // in payments.module.ts
import { PAYMENTS_REPOSITORY } from './payments.module';  // in payments.service.ts — circular!
```

---

## Authorization in Services

Owner/permission checks happen in the **service layer**, not the controller:

```typescript
// projects.service.ts
async update(id: string, dto: UpdateProjectDto, userId: string) {
  const existing = await this.repo.findById(id);
  if (!existing) throw new NotFoundException('Project not found');
  if (existing.owner_id !== userId) throw new ForbiddenException('Not the owner');
  return this.repo.update(id, dto);
}
```

Controllers only pass `user.id` — they never make authorization decisions.

---

## Bulk Operations (Reordering)

Position updates for epics, features, and tasks use parallel Supabase queries:

```typescript
async bulkReorder(roadmapId: string, dto: BulkReorderDto): Promise<void> {
  const updates = dto.items.map(item =>
    this.db
      .from('epics')
      .update({ position: item.position })
      .eq('id', item.id)
      .eq('roadmap_id', roadmapId),  // scope check prevents cross-roadmap moves
  );
  const results = await Promise.all(updates);
  for (const { error } of results) {
    if (error) throw new Error(error.message);
  }
}
```

---

## HTTP Status Codes

| Situation | Code | How |
|---|---|---|
| Successful creation | 201 | NestJS default for `@Post()` |
| Successful deletion/action | 204 | `@HttpCode(HttpStatus.NO_CONTENT)` |
| Successful non-CRUD action | 200 | `@HttpCode(HttpStatus.OK)` on `@Post()` |
| Not found | 404 | `throw new NotFoundException(...)` in service |
| Forbidden | 403 | `throw new ForbiddenException(...)` in service |
| Unauthorized | 401 | Thrown by `SupabaseAuthGuard` |
| Expired resource | 410 | `throw new GoneException(...)` (e.g. expired share link) |
| Validation failure | 400 | Automatic from `ValidationPipe` |

---

## Adding a New Module

1. Create the folder: `src/modules/my-feature/`
2. Add DTO: `dto/my-feature.dto.ts`
3. Add repository interface: `repositories/my-feature.repository.interface.ts`
4. Add Supabase implementation: `repositories/my-feature.repository.supabase.ts`
5. Add service with exported token:
   ```typescript
   export const MY_FEATURE_REPOSITORY = Symbol('MY_FEATURE_REPOSITORY');
   @Injectable() export class MyFeatureService { ... }
   ```
6. Add controller with `@UseGuards(SupabaseAuthGuard)`
7. Add module:
   ```typescript
   @Module({
     controllers: [MyFeatureController],
     providers: [
       MyFeatureService,
       { provide: MY_FEATURE_REPOSITORY, useClass: SupabaseMyFeatureRepository },
     ],
   })
   export class MyFeatureModule {}
   ```
8. Import into `app.module.ts`
9. Run `npx tsc --noEmit` to verify zero errors
