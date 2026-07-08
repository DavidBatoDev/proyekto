# Data & Database

> **Last updated:** 2026-07-09 · **Status:** planned (stub)

The Supabase Postgres schema — generated fresh from the live migrations (not the
old hand-dumped snapshots) — plus the migrations workflow, the identity/vetting
model, and RLS posture.

## Planned contents

| Doc | What's in it |
| --- | --- |
| `schema-overview.md` | Current schema, generated from `supabase/migrations/` (source of truth) |
| `migrations-workflow.md` | Authoring and applying migrations (Supabase CLI + MCP for Singapore prod) |
| `identity-vetting-model.md` | The `user_*` identity/vetting tables |
| `rls-and-security.md` | Row-level security posture and service-role boundaries |

_Scaffolded during the docs revamp; content lands in a later phase. See the
[docs index](../README.md) for build order._
