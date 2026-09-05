# RLS & Security

> **Last updated:** 2026-09-05 · **Status:** current

Row-Level Security is **enabled broadly** (`ENABLE ROW LEVEL SECURITY` appears 157
times across 78 migrations — essentially every domain table), but it is **not the
primary authorization gate**. The backend connects as the Supabase **service role**,
which bypasses RLS, and enforces access in the TypeScript service layer. RLS is
defense-in-depth for any direct/anon reads.

> **The model in one line:** the backend authorizes in code (service role); RLS
> mirrors those rules so a leaked anon key can't read what it shouldn't; hard
> invariants live in SQL functions and triggers.

## Why authorization is in the service layer

Early on, expressing project/roadmap access purely as RLS policy subqueries caused
**infinite RLS recursion** (a policy on table A querying table B whose policy queries
A). Several migrations exist purely to fix it —
`20251211223000_fix_rls_recursion.sql`,
`20260504000040_fix_project_shares_rls_recursion.sql`, and others. The resolution
was to push authorization into `SECURITY DEFINER` helper functions and the service
layer, keeping RLS policies simple. See
[Backend → patterns](../03-backend/patterns.md#authorization-in-services).

## Authorization helper functions

Policies and the service layer share these SQL helpers (all `SECURITY DEFINER`):

| Function | Answers |
| --- | --- |
| `get_user_project_role(uid, project_id) → share_role` | Canonical project role |
| `can_view_roadmap(uid, rmp)` / `can_edit_roadmap(uid, rmp)` | Roadmap access — the owner, or a role from `get_user_roadmap_effective_role` (which consults `roadmap_shares` first, so the SQL predicate is slightly **wider** than the backend's owner-or-`project_access` check). The older `can_access_roadmap` was **dropped** with `CASCADE` by `20260504000020` and must not be reintroduced |
| `get_user_roadmap_effective_role(...)` | Roadmap role resolution |
| `project_chat_is_member`, `project_chat_role`, `project_chat_can_dm` | Chat access and persona from `project_access` |
| `is_admin()`, `is_project_member(project_id)` | Staff and project gates |
| `is_active_consultant(uid)` | Verified consultant enrollment: `consultant_profiles.status = 'verified'` |
| `is_active_talent(uid)` | Active public-pool enrollment: `talent_profiles.status = 'active'` |
| `is_workspace_member(p_workspace_id, p_user_id)`, `can_manage_workspace`, `is_workspace_owner` | Workspace standing — **organization surface only, never project access**. Note the argument order differs from `can_view_roadmap(uid, rmp)` |

Both enrollment predicates are `SECURITY DEFINER` with `search_path = public`.
They deliberately avoid `profiles`: querying `profiles` from its own policy recurses,
and querying the owner-readable enrollment tables as the caller would hide other
users' rows.

The three workspace predicates follow the same rule for the same reason: the
`workspaces` / `workspace_members` / `workspace_subscriptions` / `workspace_invites`
policies **must** call them rather than inlining an `EXISTS` over `workspace_members`,
which would recurse. All four tables are write-nowhere for `authenticated` — every
INSERT/UPDATE/DELETE goes through `WorkspacesService` on the service role. Their
`owner`/`admin`/`member` vocabulary is **not** `share_role` and grants nothing inside a
project.

The `share_role` hierarchy is `owner > admin > editor > commenter > viewer`.
Finance RLS uses consultant-origin owner rows in `project_access`; explicit contract
owner/client branches remain in force where applicable. Contract SELECT also admits the
durable `consultant_user_id` seat, which keeps a severed row readable after its project FK
has been set to null.

## Triggers enforcing invariants

| Trigger | Enforces |
| --- | --- |
| `tg_project_team_members_sync_shares` | Curating a team member fans out to a `project_access` row |
| `tg_team_members_block_owner_delete` | You can't remove a team's owner |
| `tg_team_member_rates_check_consultant` | Team-member rates require an active consultant owner |
| `tg_project_teams_sync_primary` | Keeps a project's primary team consistent |
| `trg_contracts_lock_parties` | Prevents consultant/client party changes after a contract reaches signed, active, ended, or cancelled; there is no service-role bypass |
| `handle_new_user()` | Creates a `profiles` row when `auth.users` gains a row |

`sign_contract_and_flip` is a service-role-only `SECURITY DEFINER` RPC. It row-locks the
contract and calls `is_active_consultant` inside the signing transaction before stamping a
party or flipping status, closing the gap between an application-layer enrollment check and
the database write.

## AI thread tables

`roadmap_ai_sessions` and `roadmap_ai_messages` are the one place a CASCADE drop
silently deleted policies. `20260416120000` created four policies per table over
`can_access_roadmap` and granted DML to `authenticated`; `20260504000020` dropped
`can_access_roadmap … CASCADE`, taking every dependent policy with it — so until
2026-09 both tables had RLS **enabled with zero policies** (`authenticated` saw no
rows) while `anon` and `authenticated` still held live INSERT/UPDATE/DELETE grants.
[`20260904090000_ai_sessions_scope_and_context_rpcs.sql`](../../supabase/migrations/20260904090000_ai_sessions_scope_and_context_rpcs.sql)
restores the intended posture:

| Policy | Table | Rule |
| --- | --- | --- |
| `roadmap_ai_sessions_select` | `roadmap_ai_sessions` | `FOR SELECT TO authenticated`: `user_id = auth.uid()` **and** (`roadmap_id IS NULL OR can_view_roadmap(auth.uid(), roadmap_id)`) **and** (`workspace_id IS NULL OR is_workspace_member(workspace_id, auth.uid())`) — own row, and still allowed to see the thread's target |
| `roadmap_ai_messages_select` | `roadmap_ai_messages` | `FOR SELECT TO authenticated`: `EXISTS` the parent session under the same predicate |
| `roadmap_ai_sessions_service_role`, `roadmap_ai_messages_service_role` | both | `FOR ALL TO service_role USING (true) WITH CHECK (true)` — the house pattern |

Alongside the policies the migration runs
`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER … FROM anon, authenticated`
on both tables: there is **no write policy**, only the service-role backend writes
(mirroring `roadmap_change_history`). The SELECT grant from `20260416120000` stays;
the row filter is what gates visibility. Two consequences worth knowing:
`roadmap_ai_messages.metadata` (the agent's `refs` and run views) is readable by the
owner's JWT, and the `can_view_roadmap` predicate is a shade wider than the
backend's own check (see the helper table). Nothing in `web/src` queries these tables
directly, so the policies are defense-in-depth. The same migration re-adds the
`mode` CHECK with `plan_proposal` — the DTO had shipped it for months against a
`chat | edit_plan` constraint.

## Service-role-only RPCs

The three `ai_context_*` read functions (`ai_context_roadmap_counts`,
`ai_context_search_nodes`, `ai_context_list_tasks`) are `SECURITY INVOKER` over a
`uuid[]` of roadmap ids and carry
`REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`.
Authorization is application-level: callers pass only ids that came out of
`RoadmapAuthorizationService.filterViewableRoadmapIds` or the owner-union-`project_access`
roadmap list, and withholding EXECUTE means a JWT can never use them as a lateral
read path. See [Backend → AI context API](../03-backend/ai-context-api.md).

`search_knowledge_chunks_projects` (and its single-project sibling) has **no**
explicit revoke — Postgres's default EXECUTE-to-`PUBLIC` applies — but it is
`SECURITY INVOKER` over `ai_knowledge_chunks`, which has RLS enabled with
**intentionally no policies**, so a JWT caller gets zero rows and only the
service-role backend (which enforces the accessible project set in
`AiContextKnowledgeService`) gets results.

## Service-role write-only tables

Some tables are written **only** by the backend (service role); their RLS SELECT
policies are defense-in-depth allows, and there is no client write path:

- `roadmap_ai_sessions`, `roadmap_ai_messages` — own-row SELECT only; see
  [AI thread tables](#ai-thread-tables).
- `roadmap_change_history` — member-read SELECT over `can_view_roadmap(auth.uid(), roadmap_id)`
  plus a `service_role` policy, no DML path for `authenticated`
  (`20260727090000`). Since `20260904090000` it also carries the agent-run
  attribution `session_id` / `run_id`.

- `consultant_profiles`, `talent_profiles` — owners may read their enrollment
  and admins may manage all rows, but authenticated callers get no direct INSERT or
  UPDATE policy. Approval and self-service go-live/pause use the service-role API.
- `marketplace_categories`, `marketplace_subcategories` — the curated taxonomy itself.
  Both are **public-read, write-nowhere**: a single `*_public_read` SELECT policy for
  `anon` and `authenticated`, and no INSERT/UPDATE/DELETE policy at all, so only
  `service_role` (and migrations) can write.
- `consultant_subcategories` — membership. Public-read under
  `public.is_active_consultant(user_id)` rather than a plain `true`, which is what makes
  suspending a consultant remove them from every category page **without any membership
  row being deleted**. No longer write-nowhere: `20260818120100` added the owner-write
  policy (`user_id = auth.uid() AND public.is_active_consultant(auth.uid())`) plus a
  `BEFORE INSERT` cap trigger at 5 rows, and `20260818120200` gave that trigger a
  per-user `pg_advisory_xact_lock` so two concurrent inserts cannot both read a stale
  count and overshoot the cap.
- `project_activity_log` — the audit trail (service-role writes only), fed via the
  `@Global` `AuditService`. Domains append their own dotted actions; e.g. roadmap AI
  commit/rollback of a project-linked roadmap writes `roadmap.committed` /
  `roadmap.rolled_back` here.
- `user_stats` — updated on project completion, never by the user.
- `payouts` / payout mutations — go through `create_payout_and_mark_paid` /
  `void_payout_and_revert`.
- `mcp_personal_access_tokens`, `mcp_oauth_grants` — owners get **SELECT** +
  **DELETE** only; issuance, refresh-token rotation, and `last_used_at`
  bookkeeping all go through the service-role backend. `mcp_oauth_clients` has
  **only** a `service_role` policy — it belongs to no user (written by an
  unauthenticated RFC 7591 registration call), so RLS denies `authenticated`
  outright. See [Backend → MCP](../03-backend/mcp.md#storage).

## Owner-only tables (no public read)

- `marketplace_survey_responses`, `marketplace_survey_categories` — the marketplace
  intake survey (`20260819100000`). A single `*_owner_all` policy per table,
  `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())`, and **no `anon`
  policy at all**: unlike the taxonomy and the service catalog, nothing here is a public
  listing — it is what one person said about themselves. Deliberately *not* gated on
  `is_active_consultant`, because everyone takes the survey and gating a personalization
  row on a capability is the first step back towards an account role. A 3-row cap trigger
  on the categories table copies the advisory-lock shape from
  `tg_consultant_subcategories_cap`.

  `marketplace_survey_responses.intents` must never appear in a policy, a guard, or a
  route loader — `profiles.settings->'onboarding'->'intent'` held the same shape and was
  deleted with `profiles.role`. `scripts/check_survey_is_not_authz.mjs` enforces this and
  fails the build on a violation.

## Secrets & keys

- The **anon key** is public (shipped in the web bundle) and is subject to RLS.
- The **service-role key** bypasses RLS and lives only in backend secrets (Secret
  Manager) — never in the client. See
  [Architecture → deploy topology](../02-architecture/deploy-topology.md).
- JWT verification: the backend verifies Supabase JWTs **locally** (HS256 via
  `SUPABASE_JWT_SECRET`) with a `getUser` fallback — see
  [Backend → auth & guards](../03-backend/auth-and-guards.md).

## Practical guidance

- New table? Enable RLS in the same migration, add a minimal SELECT policy for
  members, and enforce real access in the service. Don't write recursive policy
  subqueries — call a `SECURITY DEFINER` helper.
- Never expose the service-role key to the client or to the agent; the agent reaches
  data only through backend endpoints it's authorized to call.
