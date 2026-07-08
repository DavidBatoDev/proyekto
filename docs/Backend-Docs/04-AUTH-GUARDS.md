# Authentication & Guards

## Overview

Authentication is handled entirely through NestJS Guards. There is no Express middleware — all auth logic lives in `src/common/guards/`.

| Guard | File | Applied |
|---|---|---|
| `SupabaseAuthGuard` | `supabase-auth.guard.ts` | Globally on all routes (via `@UseGuards`) |
| `PersonaGuard` | `persona.guard.ts` | Per-controller or per-route with `@Personas()` |
| `AdminGuard` | `admin.guard.ts` | Per-route on admin-only endpoints |

---

## SupabaseAuthGuard

**File**: `src/common/guards/supabase-auth.guard.ts`

### Flow

```
Request arrives
      │
      ├─ @Public() metadata? → allow (return true)
      │
      ├─ Authorization: Bearer <token>?
      │     → supabaseClient.auth.getUser(token)
      │     → attach { id, email } to req.user
      │     → allow
      │
      ├─ x-guest-user-id header?
      │     → query profiles WHERE guest_session_id = X AND is_guest = true
      │     → attach guest profile as req.user
      │     → allow
      │
      └─ None? → 401 UnauthorizedException
```

### Authentication Methods

#### 1. JWT Bearer (authenticated users)

```http
GET /api/auth/profile
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

The token is validated against Supabase using the anon key client (`SUPABASE_CLIENT`). The Supabase user object is attached to `req.user`.

#### 2. Guest session (unauthenticated users)

```http
GET /api/guests/pending/:sessionId
x-guest-user-id: my-session-uuid
```

A guest profile is looked up in the `profiles` table by `guest_session_id`. Allows guests to interact with roadmaps before registering.

#### 3. Public routes (no auth)

```typescript
@Get('token/:shareToken')
@Public()               // ← skips SupabaseAuthGuard entirely
getByToken(...) {}
```

---

## PersonaGuard

**File**: `src/common/guards/persona.guard.ts`

Checks `profiles.active_persona` against the allowed persona(s) specified by `@Personas()`.

```typescript
// Usage in a controller
@Get('vetting')
@UseGuards(PersonaGuard)
@Personas('client')      // ← only 'client' persona can access
getVetting(...) {}
```

If the user's `active_persona` doesn't match → `403 ForbiddenException`.

---

## AdminGuard

**File**: `src/common/guards/admin.guard.ts`

Checks the `admin_profiles` table for an active admin record for the current user.

```typescript
@Delete('applications/:id')
@UseGuards(AdminGuard)
deleteApplication(...) {}
```

- Queries `admin_profiles WHERE user_id = req.user.id AND is_active = true`
- On match: attaches `adminProfile` to `req.adminProfile` and allows
- On failure: `403 ForbiddenException`

---

## Decorators

### `@CurrentUser()`

`src/common/decorators/current-user.decorator.ts`

Extracts the authenticated user from `req.user` in a controller method parameter.

```typescript
@Get('profile')
getProfile(@CurrentUser() user: AuthenticatedUser) {
  return this.authService.getProfile(user.id);
}
```

### `@Public()`

`src/common/decorators/public.decorator.ts`

Marks a route as publicly accessible — `SupabaseAuthGuard` will skip validation.

```typescript
@Get('consultants')
@Public()
listConsultants() {}
```

### `@Personas(...personas)`

`src/common/decorators/personas.decorator.ts`

Sets metadata consumed by `PersonaGuard`.

```typescript
@Post('projects')
@UseGuards(PersonaGuard)
@Personas('client', 'consultant')
createProject(...) {}
```

---

## AuthenticatedUser Interface

`src/common/interfaces/authenticated-request.interface.ts`

```typescript
export interface AuthenticatedUser {
  id: string;
  email?: string;
  // For guests:
  is_guest?: boolean;
  guest_session_id?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  adminProfile?: any;
}
```
