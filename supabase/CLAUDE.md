# supabase/ - Migrations and edge functions

Local context for the database unit. Cross-cutting rules live in the root CLAUDE.md. The full authoring workflow is the /db-migration skill - use it for any schema work.

## Hard rules

- migrations/ is the source of truth for the DB schema (~192 timestamped files and counting).
- Tracked migrations are IMMUTABLE - they may already be applied. Never edit an existing migration (a hook blocks it); always create a NEW file: `YYYYMMDDHHMMSS_short_description.sql` (UTC timestamp).
- Latest-function-body rule: when redefining a SQL function, grep the function name across migrations/ and start from the body in the NEWEST migration that defines it. A stale copy once silently broke upsert_full_roadmap.
- New tables get their RLS policies in the same migration. This schema has a history of RLS-recursion incidents - before writing self-referential policies (profiles, project_access, team membership), review the past recursion-fix migrations.

## Applying migrations

- Local/dev: `cd backend && npx supabase db push` (CLI runs from backend/ even though migrations live here).
- PROD (Singapore, ref byvbnkpiselvvulsvxgo): `db push` FAILS with a SASL error - the local password on disk is the old Mumbai project's. Apply via the Supabase MCP `apply_migration` tool instead (auto-allowed - it hits prod directly with no confirmation step, so review the SQL before calling), then confirm with `list_migrations` and check `get_advisors` for new lints.
- `supabase db reset` is permission-denied entirely - if truly needed for a local db, the user runs it themselves.

## Storage caveat

File storage still physically lives on the OLD Mumbai project until the R2 migration completes - storage-bucket policies and objects are NOT on the Singapore project. Do not assume storage and database share a project.

## Edge functions

functions/ holds 4 Deno functions (reset-password, send-password-reset-email, send-invite-email, send-signup-email). Deploy via the Supabase MCP deploy_edge_function tool (ask-gated).
