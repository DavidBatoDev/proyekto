# RLS & Security

> **Last updated:** 2026-08-12 · **Status:** current

Row-Level Security is **enabled broadly** (`ENABLE ROW LEVEL SECURITY` appears 91
times across 40 migrations — essentially every domain table), but it is **not the
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
| `can_view_roadmap` / `can_edit_roadmap` / `can_access_roadmap` | Roadmap access |
| `get_user_roadmap_effective_role(...)` | Roadmap role resolution |
| `project_chat_is_member`, `project_chat_role`, `project_chat_can_dm` | Chat access and persona from `project_access` |
| `is_admin()`, `is_project_member(project_id)` | Staff and project gates |
| `is_active_consultant(uid)` | Verified consultant enrollment: `consultant_profiles.status = 'verified'` |
| `is_active_freelancer(uid)` | Active public-pool enrollment: `freelancer_profiles.status = 'active'` |

Both enrollment predicates are `SECURITY DEFINER` with `search_path = public`.
They deliberately avoid `profiles`: querying `profiles` from its own policy recurses,
and querying the owner-readable enrollment tables as the caller would hide other
users' rows.

The `share_role` hierarchy is `owner > admin > editor > commenter > viewer`.
Finance RLS uses consultant-origin owner rows in `project_access`; explicit contract
owner/client branches remain in force where applicable.

## Triggers enforcing invariants

| Trigger | Enforces |
| --- | --- |
| `tg_project_team_members_sync_shares` | Curating a team member fans out to a `project_access` row |
| `tg_team_members_block_owner_delete` | You can't remove a team's owner |
| `tg_team_member_rates_check_consultant` | Team-member rates require an active consultant owner |
| `tg_project_teams_sync_primary` | Keeps a project's primary team consistent |
| `handle_new_user()` | Creates a `profiles` row when `auth.users` gains a row |

## Service-role write-only tables

Some tables are written **only** by the backend (service role); their RLS SELECT
policies are defense-in-depth allows, and there is no client write path:

- `consultant_profiles`, `freelancer_profiles` — owners may read their enrollment
  and admins may manage all rows, but authenticated callers get no direct INSERT or
  UPDATE policy. Approval and self-service go-live/pause use the service-role API.
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
