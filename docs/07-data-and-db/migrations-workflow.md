# Migrations Workflow

> **Last updated:** 2026-09-06 · **Status:** current

The database schema is **migration-driven**: every change is a timestamped SQL file
in [`supabase/migrations/`](../../supabase/migrations/), and that folder is the
single source of truth (there are no hand-maintained schema dumps). This page is how
to author and apply them — including the Singapore-prod gotcha.

## File convention

- Name: `YYYYMMDDHHMMSS_snake_case_description.sql` — a 14-digit timestamp prefix +
  a descriptive slug. Files apply in lexical (= chronological) order.
- Early files use a real clock time (`20251211065452`); most later files pad the
  time to sequence intra-day steps (`120000`, `000010`, `000020`).
- **335 tracked files** today, 2025-12-11 → 2026-09-04, before the pending
  `20260906090000` file described under [Applying migrations](#applying-migrations)
  (the working tree holds one more uncommitted file from a separate change - see
  the note there).

## Authoring style

Migrations are written to be **idempotent and re-runnable**:

```sql
CREATE TABLE IF NOT EXISTS foo (...);
ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar text;

DO $$ BEGIN
  CREATE TYPE thing_status AS ENUM ('a','b');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
```

Multi-step refactors are wrapped in `BEGIN; … COMMIT;`. When rebuilding a SQL
function, **copy the newest defining migration's body** — reviving a stale copy has
broken `upsert_full_roadmap` before. Enable RLS and add policies in the same
migration that creates a table (see [rls-and-security.md](./rls-and-security.md)).

## Applying migrations

Hosted environments use separate projects:

| Environment | Project ref | Apply path |
| --- | --- | --- |
| Development | `vyiedlwasdwmjbztqznl` | Supabase MCP `apply_migration`, or the guarded repo script below |
| Production | `byvbnkpiselvvulsvxgo` | Supabase MCP `apply_migration` **only** |

The audited path for both hosted projects is the Supabase MCP `apply_migration`
tool: review the SQL, apply to dev, then to prod, then `list_migrations` and
`get_advisors` on both.

### Applied through MCP

The two 2026-09-04 files were applied this way to hosted dev **and** production on
2026-09-05 (reported by the operator; application state is not visible from the
repository — confirm with `list_migrations`):

| Migration | What it does |
| --- | --- |
| `20260904090000_ai_sessions_scope_and_context_rpcs.sql` | `roadmap_ai_sessions` scope/`workspace_id`, restored own-row RLS on the two AI tables, `roadmap_change_history.session_id`/`run_id`, the three `ai_context_*` RPCs |
| `20260904090100_search_knowledge_chunks_projects.sql` | multi-project knowledge retrieval RPC |

Both are `BEGIN; … COMMIT;` and re-runnable (`IF NOT EXISTS`, `DROP … IF EXISTS`,
`CREATE OR REPLACE`). See [schema-overview.md](./schema-overview.md) and
[rls-and-security.md](./rls-and-security.md) for the resulting state.

### Pending through MCP

`20260906090000_upsert_full_roadmap_task_assignees.sql` (the multi-assignee AI edit
change, 2026-09-06) takes the same path - dev first, then prod - and must be applied
**before** the backend that passes `p_actor_id` deploys (backend -> agent -> web).
Treat it as unapplied until `list_migrations` on both refs says otherwise.

> **Not part of this change:** the working tree also holds a second uncommitted
> migration, `20260906120000_time_tracking_without_consultant.sql`, from another
> in-flight change. It is not covered by the multi-assignee steps below and is
> documented by its own change when that lands.

| Step | What it does |
| --- | --- |
| `DROP FUNCTION IF EXISTS public.upsert_full_roadmap(uuid, uuid, jsonb, boolean, timestamptz)`, then `CREATE` the 6-arg version | Adds a trailing `p_actor_id uuid DEFAULT NULL`; a bare `CREATE OR REPLACE` would leave the 5-arg overload behind. Body copied from `20260809120000_restore_feature_status.sql` (latest-function-body rule); only the task loop changes. No migration has ever put a `GRANT`/`REVOKE` on this function, so there is nothing to re-apply |
| Task loop | Reads a task's `assignee_ids` array (deduped, order kept), writes `roadmap_tasks.assignee_id` from its first element, and reconciles `roadmap_task_assignees` (`DELETE` what is not in the set, `INSERT ... ON CONFLICT DO NOTHING` with `assigned_by = COALESCE(p_actor_id, p_owner_id)`). A scalar-only `assignee_id` reconciles only when it differs from the stored column or the task is new |
| Backfill (before the trigger exists) | Inserts the missing `roadmap_task_assignees` row for every task whose column names a user with no join row (74 production rows when authored) and sets a NULL column from the first join row where rows exist, so the "column = primary, join table = membership" invariant holds for pre-existing data. Idempotent |
| `ai_context_list_tasks` rebuild | Same body as `20260904090000`, with the assignee aggregate ordered `(a.assignee_id = t.assignee_id) DESC, a.assigned_at, a.assignee_id` so the stored primary comes first |
| `roadmap_task_assignees_touch_roadmap` | `AFTER INSERT OR DELETE` trigger on the join table (`SECURITY DEFINER`, `search_path = public, pg_temp`, mirroring `touch_roadmap_from_task_change`) that bumps `roadmaps.updated_at`; `EXECUTE` on `touch_roadmap_from_task_assignee_change()` is revoked from `PUBLIC`, `anon` and `authenticated` |

Re-runnable: `DROP ... IF EXISTS` before both the function and the trigger,
`CREATE OR REPLACE FUNCTION` for the trigger function and the rebuilt RPC, guarded
inserts/updates for the backfill. Semantics are in
[schema-overview.md](./schema-overview.md#key-rpcs) and
[Agent -> operations schema](../05-agent-ai/operations-schema.md#task-assignees).

### The dev-sync script

> **⚠️ There are no `npm run db:dev:*` scripts.** No `package.json` in the repo
> defines `db:dev:check`, `db:dev:apply`, or `db:dev:mirror` (older docs and
> CLAUDE.md files named them; those references were removed on 2026-09-05). The
> real entry point is the repo-root script.

[`scripts/sync_supabase_dev.mjs`](../../scripts/sync_supabase_dev.mjs) has three
modes and hard-codes the two refs (`PROD_REF`, `DEV_REF`); it refuses every
mutating target except the development ref:

```bash
node scripts/sync_supabase_dev.mjs check     # normalized public-schema parity, prod vs dev
node scripts/sync_supabase_dev.mjs apply     # pending repository migrations + safe seed -> dev
node scripts/sync_supabase_dev.mjs mirror --confirm-dev-ref=vyiedlwasdwmjbztqznl
```

`apply` dry-runs and then applies all pending repository migrations plus the safe
`supabase/seed.sql` to the explicit dev ref. It does not mutate production.

`mirror` is the exact, destructive production-schema baseline. It takes dev schema
and data backups in the operating system's temporary
directory, generates a live `public`-schema delta from dev to prod, and applies it
to dev in single-transaction passes. It verifies normalized schema dumps after
each pass. It never copies production rows or auth users, but tables rebuilt to
match production lose their development rows. Docker Desktop must be running.
Delete retained backup artifacts after validation because the data dump may
contain sensitive development records.

### What parity means

After a successful `check` or `mirror`, the normalized live `public` schemas
match. This covers tables, columns, constraints, indexes, functions, triggers,
grants, RLS enablement, and policies.

The environments intentionally remain separate in every other respect:

| Resource | Relationship after schema mirror |
| --- | --- |
| `public` schema | Matches production |
| Application rows | Separate; production rows are not copied |
| Auth users and sessions | Separate |
| Storage buckets and objects | Separate and not handled by this script |
| Migration-history records | May differ; live catalog parity is authoritative |
| Database passwords and API keys | Separate per project |
| Auth, networking, backups, secrets, and dashboard settings | Separate per project |
| Supabase-managed PostgreSQL patch build | May differ while Supabase rolls out updates |

Do not describe `mirror` as a full database clone. It is a `public`-schema
baseline operation. Copying production data, Auth identities, Storage objects, or
project configuration requires a separate, explicitly authorized workflow.

The script requires `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_DB_PASSWORD`, and
`SUPABASE_DEV_DB_PASSWORD` in the process environment or ignored `scripts/.env`
(it shells out to `npx --yes supabase …`; `SUPABASE_POSTGRES_IMAGE` overrides the
Postgres image `mirror` diffs against). Use URL-safe database passwords because
schema diffs connect through Supabase pooler URLs.

The Supabase CLI commands are run from `backend/` (see the
[setup guide](../00-getting-started/setup.md)), though the migrations physically
live at repo-root `supabase/`:

```bash
npx supabase link --project-ref <ref>
npx supabase db push        # apply pending migrations to the linked project
npx supabase db reset       # dev only — rebuild the local DB from scratch
```

> **⚠️ Singapore-prod rule:** never use local `supabase db push` against the live
> Singapore project (`byvbnkpiselvvulsvxgo`), even when a database password is
> available. Apply production migrations through the audited **Supabase MCP
> `apply_migration`** workflow only.

## Generating types

The web + backend TypeScript types are generated from the live schema:

```bash
npx supabase gen types typescript --project-id <ref> > <output>
```

(Also available via the Supabase MCP `generate_typescript_types`.)

## After a schema change

- If a change affects the shared roadmap operations contract, also update
  [`schemas/roadmap-ai-operations.json`](../../schemas/roadmap-ai-operations.json)
  and run `npm run check:roadmap-ai-schema` from `backend/` — see
  [Agent & Roadmap AI](../05-agent-ai/README.md).
- Update [schema-overview.md](./schema-overview.md) if you add/drop a table or enum.

## Where the DB lives

Prod is the Supabase **Singapore** project, ref `byvbnkpiselvvulsvxgo`; hosted
development is `vyiedlwasdwmjbztqznl`. Note that
`infra/README.md` still names the older Mumbai (dev) / Sydney (prod) refs — those are
stale. Storage is a separate story (files still on the Mumbai project pending the R2
cutover). See [Architecture → deploy topology](../02-architecture/deploy-topology.md)
and [Storage & Media](../08-storage-media/README.md).
