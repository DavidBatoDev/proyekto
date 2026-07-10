# Migrations Workflow

> **Last updated:** 2026-07-09 · **Status:** current

The database schema is **migration-driven**: every change is a timestamped SQL file
in [`supabase/migrations/`](../../supabase/migrations/), and that folder is the
single source of truth (there are no hand-maintained schema dumps). This page is how
to author and apply them — including the Singapore-prod gotcha.

## File convention

- Name: `YYYYMMDDHHMMSS_snake_case_description.sql` — a 14-digit timestamp prefix +
  a descriptive slug. Files apply in lexical (= chronological) order.
- Early files use a real clock time (`20251211065452`); most later files pad the
  time to sequence intra-day steps (`120000`, `000010`, `000020`).
- **165 files** today, 2025-12-11 → 2026-07-08.

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

The Supabase CLI commands are run from `backend/` (per SETUP.md), though the
migrations physically live at repo-root `supabase/`:

```bash
npx supabase link --project-ref <ref>
npx supabase db push        # apply pending migrations to the linked project
npx supabase db reset       # dev only — rebuild the local DB from scratch
```

> **⚠️ Singapore-prod gotcha:** `supabase db push` **fails with a SASL auth error**
> against the live Singapore project (`byvbnkpiselvvulsvxgo`) — there's no local SG
> DB password, and `backend/.env`'s password is the old Mumbai project's. For prod
> SG, apply migrations with the **Supabase MCP `apply_migration`** tool instead.

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

Prod is the Supabase **Singapore** project, ref `byvbnkpiselvvulsvxgo`. Note that
`infra/README.md` still names the older Mumbai (dev) / Sydney (prod) refs — those are
stale. Storage is a separate story (files still on the Mumbai project pending the R2
cutover). See [Architecture → deploy topology](../02-architecture/deploy-topology.md)
and [Storage & Media](../08-storage-media/README.md).
