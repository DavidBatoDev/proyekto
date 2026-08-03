# Data & Database

> **Last updated:** 2026-08-03 · **Status:** current

The Supabase Postgres 15 database — its current schema (generated from the live
migrations, not stale dumps), how migrations are authored and applied, the identity
model, and the RLS/security posture. The schema is **migration-driven**:
[`supabase/migrations/`](../../supabase/migrations/) is the single source of truth.

> If you only read one page, read [schema-overview.md](./schema-overview.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [schema-overview.md](./schema-overview.md) | Tables by domain, enum vocabulary, the FK spine, key RPCs |
| [migrations-workflow.md](./migrations-workflow.md) | File convention, authoring style, applying (CLI + the SG-prod MCP gotcha) |
| [identity-vetting-model.md](./identity-vetting-model.md) | The `profiles` + `user_*` identity layer and the vetting flow |
| [rls-and-security.md](./rls-and-security.md) | RLS posture, authorization helpers, triggers, service-role tables |

## Glossary

| Term | Meaning |
| --- | --- |
| **Service role** | The RLS-bypassing Supabase key the backend runs as; authorization happens in the service layer. |
| **`project_access`** | The authorization source of truth — one row per (project, user) with a `share_role`. Renamed from `project_shares`. |
| **`upsert_full_roadmap`** | The RPC that atomically persists an entire roadmap tree; the AI-commit write path. |
| **`SECURITY DEFINER`** | A SQL function that runs with its owner's rights — used for authorization helpers to avoid RLS recursion. |
| **Dead table** | Dropped and never recreated (`payment_checkpoints`, `transactions`) but still referenced by vestigial code. |

## Code locations

- **Migrations:** [`supabase/migrations/`](../../supabase/migrations/) (196 files)
- **Edge functions:** none — the 4 Deno functions were dead code and were removed 2026-08-03; email is [`backend/src/common/mail/`](../../backend/src/common/mail/)
- **Repositories** (the only code that reads/writes tables): `backend/src/modules/**/repositories/`
