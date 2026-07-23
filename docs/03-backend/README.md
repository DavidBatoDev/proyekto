# Backend (NestJS API)

> **Last updated:** 2026-07-23 · **Status:** current

The NestJS 11 API — the system's single writer to Postgres and the hub every other
service talks to. It's organized as one root module importing 27 self-contained
feature modules, each a **controller → service → repository** stack, running as the
Supabase service role with authorization enforced in the service layer.

> If you only read one page, read [architecture.md](./architecture.md). For the
> cross-service picture, see [Architecture](../02-architecture/README.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [architecture.md](./architecture.md) | Layers, request lifecycle, response envelope, DI, cross-cutting concerns |
| [project-structure.md](./project-structure.md) | Folder layout, `config/` + `common/`, module anatomy, naming |
| [configuration.md](./configuration.md) | Env-var reference, the Supabase/Redis/R2 clients, throttler |
| [auth-and-guards.md](./auth-and-guards.md) | `SupabaseAuthGuard` (local JWT verify + guest), the guard set, decorators |
| [patterns.md](./patterns.md) | Repository pattern, Symbol DI tokens, `import type`, DTOs, status codes |
| [modules.md](./modules.md) | The 27 feature modules — purpose, tables, dependencies |
| [api-reference.md](./api-reference.md) | Every HTTP route, grouped by module |
| [mcp.md](./mcp.md) | First-party read-only MCP server — endpoint, auth, scopes, tool catalog, PATs |

## Glossary

| Term | Meaning |
| --- | --- |
| **Service role** | The `SUPABASE_ADMIN` client; bypasses RLS, so the service layer is the authorization gate. |
| **Repository** | The only code that touches Supabase — an interface + Supabase impl behind a `Symbol` DI token. |
| **Response envelope** | `{ data }` on success, `{ error: { message, status, … } }` on failure (global interceptor/filter). |
| **`@Public()`** | Opts a route out of `SupabaseAuthGuard`. |
| **Co-located service** | A module (`uploads`, `applications`, `guests`) whose `*Service` lives in the controller file. |

## Code locations

- **Modules:** [`backend/src/modules/`](../../backend/src/modules/)
- **Global infra:** [`backend/src/config/`](../../backend/src/config/)
- **Cross-cutting:** [`backend/src/common/`](../../backend/src/common/)
- **Bootstrap:** [`backend/src/server.ts`](../../backend/src/server.ts), [`main.ts`](../../backend/src/main.ts), [`app.module.ts`](../../backend/src/app.module.ts)
