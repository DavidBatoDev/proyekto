# Authentication & Guards

> **Last updated:** 2026-07-09 · **Status:** current

Auth is entirely **guard-based** — there is no Express auth middleware. Guards are
applied **per-controller** with `@UseGuards(...)` (there is no global `APP_GUARD`),
and the authenticated user is attached to `request.user`. The primary guard,
`SupabaseAuthGuard`, verifies the Supabase JWT **locally** (fast, no network) with a
fallback to a Supabase call, and also accepts a guest-session header.

## The guards

| Guard | File | Gates on |
| --- | --- | --- |
| `SupabaseAuthGuard` | `supabase-auth.guard.ts` | A valid Supabase JWT **or** a valid `x-guest-user-id` header |
| `AdminGuard` | `admin.guard.ts` | An active row in `admin_profiles` for the user |
| `ConsultantOnlyGuard` | `consultant-only.guard.ts` | `profiles.is_consultant_verified` (a capability flag, **not** active persona) |
| `CronSecretGuard` | `cron-secret.guard.ts` | A constant-time match of the `x-cron-secret` header against `MEETINGS_CRON_SECRET` |
| `PersonaGuard` | `persona.guard.ts` | `profiles.active_persona` ∈ `@Personas(...)` — **defined but not used by any controller today** |

> **⚠️ Note:** the older docs claimed `PersonaGuard` gated many routes. It exists and
> works, but **no controller currently applies it**; persona-scoped behavior is
> enforced inside services. `ConsultantOnlyGuard` is what actually gates the
> consultant-only marketplace routes. Two more guards come from outside `common/`:
> `ThrottlerGuard` (`@nestjs/throttler`, on guest endpoints) and `OtaPublishGuard`
> (`mobile-updates/`, gates CI bundle registration).

## SupabaseAuthGuard flow

```
  request
    │  @Public() on the route?  ──► allow (skip auth)
    │
    │  Authorization: Bearer <jwt>?
    │     ├─ verifyTokenLocally(jwt)         HS256 with SUPABASE_JWT_SECRET  (fast, no network)
    │     │     valid   → request.user = { id: sub, email }
    │     │     expired → 401
    │     │     bad-sig → fall through ↓
    │     └─ supabaseClient.auth.getUser(jwt)   network fallback (GoTrue)
    │            valid → request.user ; else → 401
    │
    │  x-guest-user-id: <session>?
    │     └─ profiles WHERE guest_session_id = X AND is_guest = true AND created_at > now()-30d
    │            found → request.user = { id, is_guest: true, guest_session_id }
    │
    └─ neither → 401 "No valid authentication provided"
```

Key detail: the **fast path** is a local `jwt.verify(token, SUPABASE_JWT_SECRET,
{ algorithms: ['HS256'] })`. If `SUPABASE_JWT_SECRET` is set and verification
succeeds, no call is made to Supabase — this is the latency win over the old
"always call `auth.getUser`" approach. A bad signature falls back to the network
`getUser`; an expired-but-valid token is rejected outright.

Guests get in via `x-guest-user-id`: a `profiles` row with `is_guest = true`, matched
by `guest_session_id`, and only within a 30-day window. This lets anonymous users
build a roadmap before signing up. See [Feature Domains → Guests](../11-domains/README.md).

## AdminGuard

Runs after `SupabaseAuthGuard`. Looks up `admin_profiles WHERE user_id = request.user.id
AND is_active = true`, selecting `access_level`, and **attaches `request.adminProfile`**
for the handler. Applied per-route on the admin console (e.g. application approval,
role grants, matchmaking). `GET /api/admin/me` deliberately runs *without* it so any
user can check whether they're an admin.

## Decorators

| Decorator | File | Purpose |
| --- | --- | --- |
| `@CurrentUser()` | `current-user.decorator.ts` | Injects `request.user` (`AuthenticatedUser`) into a handler param |
| `@Public()` | `public.decorator.ts` | Marks a route so `SupabaseAuthGuard` skips it |
| `@Personas(...)` | `personas.decorator.ts` | Sets the personas `PersonaGuard` reads (`client\|freelancer\|consultant\|admin`) |
| `@RawResponse()` | `raw-response.decorator.ts` | Return the payload verbatim (skip the `{ data }` envelope) |
| `@SetCachePolicy(...)` | `cache-policy.decorator.ts` | Attach a `Cache-Control` preset for `CachePolicyInterceptor` |

## The authenticated user

```ts
// common/interfaces/authenticated-request.interface.ts
interface AuthenticatedUser {
  id: string;
  email?: string;
  is_guest?: boolean;          // set on the guest-header path
  guest_session_id?: string;
}
interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  adminProfile?: unknown;      // attached by AdminGuard
}
```

Handlers read it via `@CurrentUser()`; services take `userId` and do the actual
authorization (owner/permission checks) — controllers never decide access. See
[patterns.md](./patterns.md#authorization-in-services).

## Applying auth to a new route

```ts
@Controller('widgets')
@UseGuards(SupabaseAuthGuard)          // class-level: everything requires auth
export class WidgetsController {
  @Get()                               // authed
  list(@CurrentUser() user: AuthenticatedUser) { … }

  @Get('public')
  @Public()                            // opt out of auth for this route
  listPublic() { … }

  @Post('admin-only')
  @UseGuards(AdminGuard)               // stack an extra guard
  adminAction() { … }
}
```
