# Backend (NestJS API)

> **Last updated:** 2026-07-09 · **Status:** planned (stub)

The NestJS 11 API: architecture, the 24 feature modules, auth guards, conventions,
and the full HTTP surface. Supersedes the old `Backend-Docs/` set (corrected for
the current module list, `user_*` table names, and R2 uploads).

## Planned contents

| Doc | What's in it |
| --- | --- |
| `architecture.md` | Clean/repository architecture, DI, request lifecycle, response envelope |
| `project-structure.md` | Folder layout and per-module anatomy |
| `configuration.md` | Env validation, bootstrap, Supabase/Redis/R2 clients |
| `auth-and-guards.md` | `SupabaseAuthGuard`, `PersonaGuard`, `AdminGuard`, guest header |
| `modules.md` | All 24 feature modules, one section each |
| `patterns.md` | Repository pattern, DTO validation, DI tokens, status codes |
| `api-reference.md` | HTTP endpoints grouped by module |

_Scaffolded during the docs revamp; content lands in a later phase. See the
[docs index](../README.md) for build order._
