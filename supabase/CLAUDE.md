# supabase/ - Migrations and edge functions

Local context for the database unit. Cross-cutting rules live in the root CLAUDE.md. The full authoring workflow is the /db-migration skill - use it for any schema work.

## Hard rules

- migrations/ is the source of truth for the DB schema (~241 timestamped files and counting).
- Tracked migrations are IMMUTABLE - they may already be applied. Never edit an existing migration (a hook blocks it); always create a NEW file: `YYYYMMDDHHMMSS_short_description.sql` (UTC timestamp).
- Latest-function-body rule: when redefining a SQL function, grep the function name across migrations/ and start from the body in the NEWEST migration that defines it. A stale copy once silently broke upsert_full_roadmap.
- New tables get their RLS policies in the same migration. This schema has a history of RLS-recursion incidents - before writing self-referential policies (profiles, project_access, team membership), review the past recursion-fix migrations.

## Applying migrations

- Hosted dev (`vyiedlwasdwmjbztqznl`): use `cd backend && npm run db:dev:apply` for repository migrations and the safe seed. For an exact production-schema baseline, use the confirmed `db:dev:mirror` command documented in the migrations workflow.
- PROD (Singapore, ref byvbnkpiselvvulsvxgo): apply via the Supabase MCP `apply_migration` tool only (auto-allowed - it hits prod directly with no confirmation step, so review the SQL before calling). Never use local credentials with `db push`; then confirm with `list_migrations` and check `get_advisors` for new lints.
- `supabase db reset` is permission-denied entirely - if truly needed for a local db, the user runs it themselves.

## Environment parity boundary

- The parity target is the normalized live `public` schema, including tables, columns, constraints, indexes, functions, triggers, grants, RLS enablement, and policies.
- Do not use migration-history equality as a substitute for catalog parity. The two hosted projects can have different migration records while producing the same live schema.
- The mirror is schema-only. Production rows, Auth users/sessions, Storage buckets/objects, database passwords and API keys, and Supabase dashboard/project configuration stay separate.
- Never copy production data or Auth identities into hosted dev as part of `db:dev:mirror`.

## Storage caveat

File storage still physically lives on the OLD Mumbai project until the R2 migration completes - storage-bucket policies and objects are NOT on the Singapore project. Do not assume storage and database share a project.

## Edge functions

There are none, deliberately. functions/ held 4 Deno functions (reset-password,
send-password-reset-email, send-invite-email, send-signup-email) that were dead code:
nothing invoked them, and outbound email had already moved to the backend's
MailerService (backend/src/common/mail/). Sources and deployments were removed
2026-08-03; recover from git history if a future function needs a starting point.

Email now lives entirely in the backend - see backend/src/modules/auth/email-otp.service.ts
(verification + password reset) and projects.service.ts (invites).
