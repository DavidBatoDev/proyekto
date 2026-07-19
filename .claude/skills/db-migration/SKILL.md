---
name: db-migration
description: Author and apply Supabase migrations safely - immutability, the latest-function-body rule, RLS recursion checks, and the prod apply path via MCP. Use for any DB schema change.
---

# Skill: DB Migration

This is the canonical migration workflow. The db-migration-specialist agent reads this file; keep it the single source of truth.

## Authoring

- New file: `supabase/migrations/YYYYMMDDHHMMSS_short_description.sql` (UTC timestamp, later than every existing file).
- NEVER edit a tracked migration - it may already be applied; a PreToolUse hook blocks such edits. Fix-forward with a new migration.
- Use idempotency guards (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS`) where they don't hide real errors.

## Latest-function-body rule (incident-derived)

When a migration redefines a SQL function:
1. Grep the function name across `supabase/migrations/`.
2. Open the NEWEST migration that defines it.
3. Start your new definition from THAT body, then apply your change.
A stale copy once silently reverted behavior in `upsert_full_roadmap`.

## RLS

- Every new table gets its RLS policies in the same migration (this schema is RLS-first; a missing policy = data leak or total lockout).
- The schema has a history of RLS-recursion incidents. Before writing policies that reference the same or mutually-referencing tables (profiles, project_access, team membership), review past recursion-fix migrations (grep `recursion` / `rls` in migration filenames) and prefer security-definer helper functions where those fixes established them.
- Verify policies after apply: read-only `SELECT * FROM pg_policies WHERE tablename = '...'` via the Supabase MCP execute_sql tool.

## Applying

| Target | How |
|---|---|
| Local/dev DB | `cd backend && npx supabase db push` (CLI runs from backend/) |
| PROD (Singapore, ref byvbnkpiselvvulsvxgo) | Supabase MCP `apply_migration` ONLY. `db push` FAILS with SASL - the password on disk belongs to the old Mumbai project. |

After a prod apply: confirm with MCP `list_migrations`, then run `get_advisors` (security + performance) and address new lints.

## Caveats

- Storage is still physically on the OLD Mumbai project until the R2 migration completes - storage-bucket policies/objects are not on the Singapore project.
- `supabase db reset` is permission-denied in sessions; if a local reset is truly needed, the user runs it.
- Progress/date rollups (feature -> epic -> milestone -> roadmap) are implemented in Postgres functions - schema changes around epics/features/tasks usually mean touching those functions (latest-body rule applies).
- Significant schema changes deserve a docs note (docs/07-data-and-db/ counts and schema overview drift fast).
