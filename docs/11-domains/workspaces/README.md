# Workspaces

> **Last updated:** 2026-09-22 · **Status:** current

A **workspace** is the top-level organizational and billing boundary: it owns teams and
projects, and `workspace_members` is the billable seat pool. It is deliberately **not** an
authorization layer. Project access is still `project_access` + `resolvePermissions`, exclusively,
and holding a workspace seat grants nothing inside any project — which is the only way the
marketplace half of the product survives a tenant tier, because a consultant delivering work on a
client's project has `project_access` there and no seat in that client's workspace.

> **Deployment state (2026-09-02).** Live in **both** environments, schema and code. Migrations
> were applied via the Supabase MCP `apply_migration` tool to hosted dev (`vyiedlwasdwmjbztqznl`)
> and production (`byvbnkpiselvvulsvxgo`) in order: the core tables, invites, the two
> `workspace_id` columns, the provisioning RPC, the general backfill, the Prodigitality seed (a
> no-op on dev), the `personal_projects` rename with its compatibility shim, and — once the
> workspace-aware backend revision was serving — the contraction
> `20260902130000_drop_personal_workspace_compat.sql`, which removed the shim. The backfill was
> re-run after the deploy to cover signups made during the window. Production after apply:
> 29 workspaces (28 personal + 1 organization), no unhomed team or project, no guest holding a
> seat. Code shipped in commits `edd59e03`..`672bd021` on `main`. URL handles (`/w/<slug>/`)
> followed on 2026-09-03. The workspace-scope AI-thread schema (`20260904090000`) was reported
> applied to dev and prod on 2026-09-05 (not verifiable from the repo — confirm with
> `list_migrations`); the consuming code is on `feat/ai-revamp`, not yet on `main`.

> **⚠️ Plan limits (2026-09-22): schema live in both environments, code not yet deployed.** The
> plan-limit layer described under [Plans & limits](#plans--limits) is implemented in the repo.
> Its two migrations (`20260922130000_harden_direct_table_writes.sql`, then
> `20260922120000_workspace_plan_limits.sql`) were applied via MCP `apply_migration` to hosted
> dev and to production (`byvbnkpiselvvulsvxgo`) on 2026-09-22, with identical function bodies.
> Production was backfilled the same day with four complimentary plans ("fit tier": the lowest
> tier covering what each workspace already used): Prodigitality Workspace and August Teleg's
> Workspace → Business, Juan Carlos Gan's Workspace and the QA delivery sandbox → Pro; the other
> 31 workspaces are Free. **Nothing is enforced in production until the backend and web
> revisions that carry the code are deployed.**

## The shape

```text
                            workspaces
                                |
    +--------------+------------+-------------+--------------------+
    |              |            |             |                    |
workspace_     workspace_   workspace_     teams              projects
members        invites      subscriptions  .workspace_id      .workspace_id
seat pool      email        plan scaffold  nullable           nullable
owner|admin|   invites,     1:1 with a     SET NULL           SET NULL
member         mirrors      workspace
               team_invites

                          project_access
             the ONLY project authorization path -- untouched:
        no workspace column, no workspace grant, no fan-out trigger
```

There is no `has_workspace_grant` column and no membership fan-out trigger. That is the single
most important fact on this page: the organizations proposal's fan-out design was **not** built.

## Tables

| Table | Holds |
| --- | --- |
| `workspaces` | `id`, `name` (1–120 chars, non-blank), `description` (≤2000), `avatar_url`, `slug` (**the URL handle**, `/w/<slug>/…`: NOT NULL, unique, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–60 chars, never uuid-shaped; filled by the `workspaces_slug_guard` trigger from the name on insert, so no insert path needs to know the rule), `created_by` (→ `profiles`, **ON DELETE SET NULL**, audit only), timestamps. **No `owner_id`**. Since `20260922120000` (dev and production, 2026-09-22) it also carries the four complimentary-plan columns — see [Complimentary plans](#complimentary-plans) |
| `workspace_slug_history` | `slug` **PK** → `workspace_id` (**CASCADE**), `replaced_at`. A renamed workspace's old handles, kept so old links redirect (GitHub model). Renaming back to an own old handle reclaims it; another workspace can never take it. RLS: members read their workspace's rows, which is how `previous_slugs` rides the membership list |
| `workspace_reserved_slugs` | `slug` **PK**, `note`. The single source of truth for handles a workspace may not take: everything that is a route name under `/w/<slug>/` (`settings`, `teams`, `dashboard`, `members`, `billing`, `time`, `my-logs`, …), every top-level route name, and the usual `admin`/`api`/`www`/`login`… set. Publicly readable |
| `workspace_members` | The seat pool. `workspace_id` + `user_id` + `role` (`owner` \| `admin` \| `member`) + `joined_at`, `UNIQUE (workspace_id, user_id)` |
| `workspace_subscriptions` | `workspace_id` **PK** (1:1), `plan` (`free` \| `pro` \| `business` \| `enterprise`), `status` (a provider-neutral vocabulary since `20260908120000`: `active` \| `trialing` \| `past_due` \| `canceled` \| `incomplete` \| `incomplete_expired` \| `unpaid` \| `paused` — each payment-provider adapter maps onto it), nullable `seat_limit`, period columns, `metadata` jsonb, and the provider projection — `billing_provider` (`stripe` \| `polar` \| `paddle`, NULL until first checkout), `provider_customer_id`, `provider_subscription_id`, `provider_subscription_item_id`, `provider_price_id`, `billing_interval`, `cancel_at_period_end`, `canceled_at`, `trial_end`, `provider_updated_at` (the webhook ordering key), `last_provider_event_id`. Still **no seat counter** |
| `workspace_invites` | Structural mirror of `team_invites` — both `invitee_id` and `invitee_email`, `role`, `status` (`pending`/`accepted`/`declined`/`cancelled`), plus a profile-insert reconciliation trigger |

Two facts the schema enforces by omission:

- **Ownership is `workspace_members.role = 'owner'`**, not an `owner_id` column — so a workspace
  can have several owners and there is exactly one place to look. `created_by` is audit metadata
  and goes null when the registrant's profile is deleted; the organization outlives the person.
- **Seats used is always `COUNT(workspace_members)`.** `workspace_subscriptions` deliberately has
  no seat-count column, so a stored counter cannot drift. `seat_limit IS NULL` means unlimited and
  nothing enforces it yet.

`teams.workspace_id` and `projects.workspace_id` are nullable, `ON DELETE SET NULL`, and
**permanently nullable** by design: deleting a workspace must not destroy marketplace projects,
contracts, or invoices, and guest-owned projects have no workspace until the guest converts. "New
writes always carry one" is enforced in the backend, not by a constraint.

## Roles

| Role | Can |
| --- | --- |
| `owner` | Everything, plus: delete the workspace, grant/revoke `owner`, and any future billing-only field |
| `admin` | Rename/describe/avatar the workspace, invite, cancel invites, manage non-owner members, read the subscription |
| `member` | Read the workspace, its member list and its [Usage](#the-usage-page) page; create teams and projects in it, within the plan's limits |

Guards:

- A workspace must keep at least one owner — the last owner can neither be demoted nor removed
  (`assertNotLastOwner`), because an ownerless workspace is unadministrable and still billable.
- Only an owner may change owner roles, so an admin cannot self-promote in one request.
- `WORKSPACE_ASSIGNABLE_ROLES` is `admin | member` — `owner` never arrives by invitation.
- `UpdateWorkspaceDto` fields are split into shared (`name`, `description`, `avatar_url`) and
  owner-only (empty today) tuples, with a type-level exhaustiveness check: adding a field without
  classifying it is a compile error, not a silent grant to admins.

**Workspace roles are not `share_role`.** They govern the organization surface (settings, members,
billing) and nothing inside a project.

## Where new work lands

`WorkspacesService.resolveWorkspaceForWrite(userId, explicitWorkspaceId?)` is the single definition
of which workspace a new team or project belongs to. Teams, projects, and guest-roadmap conversion
all call it rather than resolving a workspace themselves.

```text
explicit workspace_id given?
  yes -> caller must hold ANY workspace_members role there   -> that id
                              (else 403)
  no  -> caller's default workspace                          -> that id
         = earliest owner-role membership, ordered by
           (joined_at, workspace_id) -- no is_default flag
      -> none, and caller is a guest                         -> null (project stays unhomed)
      -> none, and caller is a real user                     -> provision_default_workspace()
```

Any role qualifies for an explicit target: membership is a seat pool, not a ladder, so any member
may create work in their own organization. The default rule — earliest owner-role membership — is
implemented identically three times (the RPC, the backfill migration, and the service), which is
why there is no `is_default` column to keep in sync.

## Provisioning and the required signup step

Signup now **requires** creating a workspace, with a server-side backstop behind it:

```text
/welcome deck                          backend
------------                           -------
slide 1  welcome
slide 2  capabilities
slide 3  workspace name  (REQUIRED) --> POST /api/workspaces   (create)
                                    or PATCH /api/workspaces/:id (rename)
slide 4  invite people (skippable) --> POST /api/workspaces/:id/invites
[theme slide only when featureFlags.themeSystem]

PATCH /api/auth/onboarding/complete
   1. provision_default_workspace(user)      <- FIRST
   2. provision_personal_project(user)       <- stamps projects.workspace_id
```

- The **order matters**: `provision_personal_project` places the personal project into the caller's
  default workspace, so the workspace must exist first.
- `provision_default_workspace` is idempotent and advisory-locked on **seed 1**
  (`provision_personal_project` owns seed 0, and `completeOnboarding` calls both in one request).
  It **rejects guests**. A nameless profile gets `My Workspace`, never `My's Workspace`.
- The deck's slide normally *renames* the server-provisioned default rather than creating a second
  one; it prefills from the oldest workspace the user **owns**, so mere membership in someone
  else's workspace is never renamed. If the lookup fails, or two saves fail, a "Skip for now"
  escape hatch appears — a required step the server cannot complete must not trap the user.
  > Note the two orderings are not identical: the deck picks the earliest `workspaces.created_at`,
  > while the default-workspace rule everywhere else is the earliest `workspace_members.joined_at`.
  > They agree for the ordinary case (one self-created workspace) and can diverge for a user who
  > owns several.
- `createWorkspace` compensates: if the owner-membership insert fails, the workspace row is deleted
  again, because a workspace nobody owns is invisible even to its creator.

**The deck's "create a team" step is gone.** Signup no longer creates a team, and the invite step
now invites people to the **workspace**, not to a team or to the personal project.

`20260902090400_backfill_workspaces.sql` gives every existing non-guest profile a workspace and
moves their owned teams and projects into it; every statement is guarded, so re-running is a no-op.
Guests are skipped — a converted guest project is placed in the *converting* user's workspace by
`ProjectsService.createProjectFromRoadmap`.

## `personal_workspaces` is now `personal_projects`

"Workspace" now names the organization tier, so the old one-to-one identity link was renamed to
what it always was — a project.

| Before | After |
| --- | --- |
| table `personal_workspaces` | table `personal_projects` |
| RPC `provision_personal_workspace` | RPC `provision_personal_project` |
| `PersonalWorkspaceService` | `PersonalProjectService` |
| project title `"<name>'s Workspace"` | project title `"<name>'s Space"` (nameless: `My Space`) |

Two things did **not** change:

- **`project_access.origin = 'personal_workspace'`** keeps its literal value. It is wired through
  `resolvePermissions` and its hand-maintained web mirrors and snapshots; renaming it is separate,
  deliberate work.
- `PATCH /api/auth/onboarding/complete` still returns `personal_workspace_id` as a **deprecated
  alias** of `personal_project_id`, so a client running the previous bundle keeps working.

The rename ships expand/contract: `20260902090500` renames the table and leaves a compatibility
`VIEW public.personal_workspaces` plus a wrapper `provision_personal_workspace(uuid)` that
delegates to the new function; `20260902130000_drop_personal_workspace_compat.sql` drops both, and
is applied per environment **only after** the new backend revision is live there.

## RLS

All writes are **service-role only** — the API is the authorization path. The policies exist so
direct-from-browser Supabase reads stay scoped:

| Table | SELECT | Other |
| --- | --- | --- |
| `workspaces` | any member | UPDATE for owner/admin, DELETE for owner; **no INSERT policy** |
| `workspace_members` | any member of that workspace | none (service role only) |
| `workspace_subscriptions` | owner/admin only — billing is not a plain member's business | none |
| `workspace_invites` | the invitee, or an owner/admin | UPDATE for the same set; **no INSERT policy** |

> **⚠️ The grants did not match that intent until the plan-limits migrations (2026-09-22).**
> `20260902090000` and `20260902090100` revoked only from `PUBLIC` and `anon`, and on hosted dev
> Supabase's default privileges had given `authenticated` full DML, so the UPDATE/DELETE policies
> were live over PostgREST with a user's own JWT. `20260922120000` revokes INSERT, UPDATE, DELETE
> and TRUNCATE on `workspaces` from `authenticated`. `20260922130000` revokes the same from `anon`
> and `authenticated` on `workspace_invites`, `workspace_members` and `workspace_subscriptions`
> (and on `team_invites` and `project_invites`). Before it, an invitee could repoint their own
> pending invite at any workspace with role `owner` and then accept it through the API, which
> takes `workspace_id` and `role` from the stored row. The policies stay in place as dormant
> documentation of who may write. Production keeps the old grants until the rollout.

Three `SECURITY DEFINER` helpers back those policies — `is_workspace_member`,
`can_manage_workspace`, `is_workspace_owner`. Policies **must** call them and never inline an
`EXISTS` over `workspace_members`, which is what keeps them from recursing. See
[Data → RLS & security](../../07-data-and-db/rls-and-security.md).

## Invites

`workspace_invites` mirrors `team_invites` deliberately — there was no reason to invent a second
invite shape. Behaviour worth knowing:

- Re-inviting the same address **refreshes the pending row in place** (two partial unique indexes:
  one per `(workspace_id, lower(invitee_email))`, one per `(workspace_id, invitee_id)`).
- Everyone gets an **email**, with or without an account; the in-app notification only fires when
  the invitee already has a profile.
- The notification type `workspace_invite_received` is seeded with **`email_eligible = false`** on
  purpose: `WorkspacesService` sends the mail itself, exactly as `TeamsService` does. Flipping the
  flag would send two emails.
- A suppressed (unsubscribed) address stops the **email**, not the **invitation** — the invite
  still waits in-app.
- A profile-insert trigger reconciles a pending email invite to the new profile id and notifies
  them; the deep link is `/teams/me/invites`, the combined received-invites inbox
  (team + project + workspace), not a workspace-specific page.

## HTTP surface

All routes carry `SupabaseAuthGuard` at the controller. Base `/api/workspaces`.

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/workspaces` | Any member — the switcher's list, with `my_role`, `member_count`, `plan` (and, with plan limits, `effective_plan`, `plan_source`, `is_discounted_free`, `discounted_plan`) |
| POST | `/api/workspaces` | Any authenticated user; creator becomes `owner` |
| GET | `/api/workspaces/me/invites` | The invitee |
| POST | `/api/workspaces/me/invites/:inviteId/respond` | The invitee only (`accepted` \| `declined`) |
| GET | `/api/workspaces/:id` | Any member; owner/admin additionally get `subscription` + `seats_used` |
| PATCH | `/api/workspaces/:id` | owner/admin |
| DELETE | `/api/workspaces/:id` | owner |
| GET | `/api/workspaces/:id/members` | Any member |
| PATCH | `/api/workspaces/:id/members/:userId` | owner/admin (owner role changes: owner only) |
| DELETE | `/api/workspaces/:id/members/:userId` | owner/admin, or self (leave) |
| POST | `/api/workspaces/:id/invites` | owner/admin |
| GET | `/api/workspaces/:id/invites` | Any member |
| DELETE | `/api/workspaces/:id/invites/:inviteId` | owner/admin |
| GET | `/api/workspaces/:id/ai-sessions` | Any member — the caller's **own** assistant threads in this workspace (`?archived=`, `?limit=`) |
| POST | `/api/workspaces/:id/ai-sessions` | Any member |
| GET | `/api/workspaces/:id/ai-sessions/:sessionId` | The thread's owner |
| PATCH | `/api/workspaces/:id/ai-sessions/:sessionId` | The thread's owner (title, archive, pin) |
| PUT | `/api/workspaces/:id/ai-sessions/:sessionId/agent-state` | The thread's owner — written by the agent as the user (its durable memory snapshot) |
| DELETE | `/api/workspaces/:id/ai-sessions/:sessionId` | The thread's owner |
| GET | `/api/workspaces/:id/ai-sessions/:sessionId/messages` | The thread's owner |
| POST | `/api/workspaces/:id/ai-sessions/:sessionId/messages` | The thread's owner (the web persists each turn; `metadata` is capped at 64 KB) |
| GET | `/api/workspaces/:workspaceId/usage` | Any member — the plan, its limits, and current usage (see [Plans & limits](#the-usage-page)); 404 for an unknown workspace, 403 for a non-member |
| GET | `/api/workspaces/:workspaceId/billing` | Owner or admin — plan, seats used vs billed, next invoice, payment method; with plan limits also `effective_plan`, `plan_source`, `complimentary`, `has_live_subscription` |
| POST | `/api/workspaces/:workspaceId/billing/checkout-session` | **Owner only** — `{ plan: pro\|business, interval: month\|year }`; relative return paths only. A plan ranked at or below an active complimentary plan is **409** `workspace_complimentary` |
| POST | `/api/workspaces/:workspaceId/billing/portal-session` | **Owner only** — the owning provider's customer portal |
| POST | `/api/platform-billing/webhooks/:provider` | Public; authenticated by the provider's signature over the raw body |
| POST | `/api/platform-billing/cron/reconcile` | Public; `CronSecretGuard` (`MEETINGS_CRON_SECRET`) |

`me/invites` is declared **before** the `:id` routes so Nest's matcher does not read `me` as a
workspace id. The eight `ai-sessions` routes live in `RoadmapsModule`
(`controllers/workspace-ai-sessions.controller.ts`), not in `WorkspacesModule`; see
[AI assistant](#ai-assistant) for the scope rules.

`POST /api/teams` (`CreateTeamDto`) and `POST /api/projects` (`CreateProjectDto`) accept an
optional `workspace_id`; omitting it means "the caller's default workspace". With plan limits,
both go through `resolveWorkspaceForCreate`, which runs the workspace's `projects` / `teams`
count check after the membership check (see [Plans & limits](#what-each-gate-blocks)). It is **deliberately
absent from `UpdateTeamDto`**: moving a team between organizations would have to carry its
projects, rates, and payouts with it, and that is not a rename. There is no move endpoint.

## Web surface

- **Switcher** — `WorkspaceSwitcher` in `SidebarContent`; the selection itself lives in
  `useWorkspaceStore` (per-user `localStorage`, key `proyekto_current_workspace:<userId>`), while
  the workspace list stays in TanStack Query. The selection is per-device on purpose, and it is
  **not** `profiles.settings.workspace_defaults` — that key already means the sidebar's default
  team/project and predates this tier.
- **URLs** — organizational pages live at `/w/<slug>/dashboard`, `/w/<slug>/teams/…`, and
  `/w/<slug>/settings{,/members,/usage,/billing}`. The `/w/$workspaceSlug` layout route resolves the slug
  against the caller's **own** membership list: a retired slug redirects to the current one with
  the rest of the path intact; an unknown or non-member slug is **not found** (never 403, so slugs
  cannot enumerate organizations). Bare `/dashboard`, `/teams/…`, and `/workspace/…` are
  permanent redirect stubs to the last-visited workspace (a bare `/teams/<id>/…` link prefers the
  team's own workspace), because persisted notification links and push payloads keep carrying
  them. Entity pages (`/project/**`) stay global. `/teams/me/invites` is personal and never gains
  the segment. See `docs/04-web/routing-and-access.md`.
- **URL handle** — the General settings page shows the handle; only an **owner** can change it
  (`PATCH /workspaces/:id { slug }`, owner-only via `WORKSPACE_OWNER_ONLY_UPDATE_FIELDS`). The
  database trigger validates it: reserved, taken, or another workspace's old handle → `23505` →
  **409** with the trigger's message; bad shape → `23514` → **400**. On success the page patches
  the cached list and moves to the new `/w/<slug>/settings`. Old handles keep redirecting.
- **Entering a workspace** — switching, creating, and accepting a workspace invite all go through
  `useEnterWorkspace`: remember the selection, reset the dashboard/teams caches (so the skeletons
  show instead of the previous workspace's rows), and navigate to `/w/<slug>/dashboard`.
- **Assistant** — the dashboard carries the Proyekto assistant as a rail, expanded to a
  full-screen overlay by `?assistant=full` on `/w/<slug>/dashboard` (the route owns the search
  param, so it survives a refresh). Threads are bound to the open workspace; see
  [AI assistant](#ai-assistant).
- **Billing is built but has no payment provider configured in production.**
  `/w/<slug>/settings/billing` shows the plan and seats in use; where a provider is configured it
  also shows what the provider is billing (when that differs), the estimated next invoice, the
  payment method and any dunning state, and owners can start a subscription through the
  provider's hosted checkout and manage everything else in its customer portal. Without provider
  credentials the page says no plans are available for purchase. Owner-only for the write paths,
  read-only for admins, invisible to members. The page deliberately never renders `seat_limit`
  (the provider's seat-cap column, enforced nowhere); the plan's member limit lives in the
  plan-limit matrix and is shown on the Usage page. A workspace on a complimentary plan gets no
  checkout for plans at or below it, but keeps the customer portal whenever it has a billing
  account. See [Billing](#billing) and [Plans & limits](#plans--limits).
- **Usage** — `/w/<slug>/settings/usage` (ships with the plan-limits deploy), readable by every
  member. See [The Usage page](#the-usage-page).
- **Scoping** — `groupByWorkspace` (`web/src/lib/workspaceScope.ts`) splits teams and projects
  three ways: in the open workspace → the main list; unhomed, or in a workspace the viewer is not a
  member of → **"Shared with you"**; in another workspace the viewer *does* belong to → hidden
  until they switch. With no workspace selected it falls back to one flat list, so an unresolved
  selection never reads as data loss. Consumed by `SidebarContent`, `ProjectsGrid`, `TeamsGrid`,
  and `DashboardWidgets`. The assistant's @-mention picker is the deliberate exception: it shows
  the third group too, because the agent can act on it (below).

## AI assistant

The dashboard's **Proyekto assistant** runs in **workspace scope**: an AI thread is bound to
the open workspace rather than to one roadmap, and the agent may read and edit any project,
roadmap, or team the caller can reach — including work shared into the caller from outside
the workspace. Consistent with everything above, **workspace membership is a discovery
boundary for the agent, not an authorization one**: every read and every commit the agent
makes goes to the backend as the user and passes the same per-roadmap / per-project checks
as a click in the UI (`project_access`, `can_view_roadmap`). Membership decides only which
workspace the thread belongs to and which **lane** an item is reported in.

```text
web dashboard  /w/<slug>/dashboard   (rail, or ?assistant=full)
   |
   |  threads:  /api/workspaces/:id/ai-sessions[...]           backend, member-only
   |  runs:     POST /agent/sessions {scope:{kind:"workspace", workspace_id}}
   v
agent  -- GET  /api/workspaces/:id            403 | 404 -> 404 SESSION_SCOPE_NOT_FOUND
       -- GET  /api/ai/context/overview?workspace_id=    projects, roadmaps, teams, laned
       -- GET  /api/ai/context/{roadmaps,search,tasks,knowledge-search,changes}
       -- POST /api/ai/context/resolve-refs              @-mentions, fail-closed per ref
       -- GET  /api/roadmaps/:id/ai/context/*  +  POST /api/roadmaps/:id/ai/commit
                                                  one commit per roadmap, as the user
```

| Lane | Meaning (`classifyAiContextLane`, `backend/src/modules/execution/ai-context/services/ai-context.service.ts`) |
| --- | --- |
| `current` | In the requested workspace (or, with no workspace requested, in any workspace the caller belongs to) |
| `other_workspace` | In another workspace the caller belongs to |
| `shared` | Unhomed, or in a workspace the caller is not a member of — reachable only through `project_access` |

Nothing accessible is ever dropped. That is the one place the assistant differs from
`groupByWorkspace`, which hides `other_workspace` items until the user switches: the
composer's @-mention picker orders candidates `current -> shared -> other_workspace` and
shows all three. A non-member `workspace_id` on `overview` is a **404**.

**Threads.** `roadmap_ai_sessions` gained a nullable `roadmap_id`, a `workspace_id`
(**`ON DELETE CASCADE`** — `SET NULL` would violate the one-of CHECK, and threads are
private per-user scratch), and `scope` (`roadmap` | `workspace`) with a CHECK that exactly
one of the two ids is set. `WorkspaceAiSessionsController` exposes the same eight routes
and DTOs as the roadmap controller through the same `RoadmapAiSessionsService`, generalized
on scope: a non-member gets **404** (never 403, matching `/w/<slug>` resolution), threads
are private per user (`user_id` equality on every read), and the scope filter means a
roadmap thread can never be read through the workspace route. Own-row `SELECT` RLS is
restored on `roadmap_ai_sessions` and `roadmap_ai_messages` for `authenticated`
(`user_id = auth.uid()` plus `can_view_roadmap` / `is_workspace_member` for whichever id is
set); all writes stay service-role. Durable history is `roadmap_change_history`, which now
carries the `session_id` and `run_id` that made each change.

**What applies directly.** In workspace scope a single-roadmap batch with no deletes and at
most `AGENT_DIRECT_EDIT_MAX_OPERATIONS=15` operations commits without confirmation; a
delete, a larger batch, or a batch spanning several roadmaps becomes a proposal the user
confirms, after which the agent commits **one change per roadmap** (its own revision token
and idempotency key each) and verifies. In a roadmap thread the focus roadmap applies
directly up to `AGENT_DIRECT_EDIT_MAX_OPERATIONS_FOCUS=90` operations, deletes included.
Both are agent tunables (`agent/app/core/config.py`), not feature flags.

**Not workspace-tier.** AI memories stay per roadmap (`roadmap_ai_memories.roadmap_id`).
Web details: [Web → AI assistant](../../04-web/ai-assistant.md); the run machine:
[Agent & Roadmap AI](../../05-agent-ai/README.md).

## Migrations

| File | Does |
| --- | --- |
| `20260902090000_workspaces_core.sql` | `workspaces`, `workspace_members`, `workspace_subscriptions`, the three helpers, RLS, grants |
| `20260902090100_workspace_invites.sql` | `workspace_invites`, RLS, the `workspace_invite_received` type, the reconciliation trigger |
| `20260902090200_add_workspace_id_to_teams_projects.sql` | `teams.workspace_id`, `projects.workspace_id` + indexes |
| `20260902090300_provision_default_workspace.sql` | The idempotent, advisory-locked provisioning RPC (service-role only) |
| `20260902090400_backfill_workspaces.sql` | Idempotent backfill of workspaces, subscriptions, and owned teams/projects |
| `20260902090450_seed_prodigitality_workspace.sql` | One hand-reviewed organizational seed: creates "Prodigitality Workspace" from the Prodigitality Services Inc. team (14 members with team roles and join dates carried over; the team and its 17 attached projects homed there). Keyed on team name + owner email; a no-op wherever that team does not exist (hosted dev). Must run AFTER the backfill so the owner's unrelated teams and projects stay in his personal workspace |
| `20260902090500_rename_personal_workspaces_to_personal_projects.sql` | The rename + compat view + wrapper function (expand) |
| `20260902130000_drop_personal_workspace_compat.sql` | Drops the view and wrapper (**contract — hold until the new backend revision is live**) |
| `20260908120000_workspace_billing_provider.sql` | The provider projection on `workspace_subscriptions` (`billing_provider` + `provider_*`), the widened `status` CHECK, partial UNIQUE indexes on `(billing_provider, customer id)` and `(billing_provider, subscription id)` (so two workspaces cannot share one subscription), the `billing_webhook_events` idempotency ledger keyed `(provider, event_id)` (RLS on with **zero policies** — service-role only, deliberately), and the `workspace_payment_failed` notification type. Applied to hosted dev and production 2026-09-22 |
| `20260904090000_ai_sessions_scope_and_context_rpcs.sql` | `roadmap_ai_sessions.workspace_id` (CASCADE) + `scope` with the one-of CHECK; own-row SELECT RLS on the two AI tables; `roadmap_change_history.session_id` / `run_id`; the three `ai_context_*` read RPCs behind the assistant's overview / search / tasks. Applied to hosted dev and production 2026-09-05 |
| `20260922120000_workspace_plan_limits.sql` | `plan_rank()`; `plan_limit_keys` + `plan_limits` with the 18-key × 4-plan seed (72 cells; re-runs never overwrite an admin edit); the four complimentary-plan columns on `workspaces` with their CHECKs and the `workspaces_discount_guard` trigger; the write revoke on `workspaces`; `platform_admin_audit_log`; the service-role read functions (`user_default_workspace_id`, `workspace_plan_state`, `workspace_usage_counts`, `workspace_largest_roadmaps`, `entitlement_subject`) and the audited admin writers (`admin_list_workspaces`, `admin_update_plan_limits`, `admin_set_workspace_comp`, `admin_clear_workspace_comp`). New tables: RLS on, **zero policies**. Applied to hosted dev and production 2026-09-22 |
| `20260922130000_harden_direct_table_writes.sql` | Closes the PostgREST paths around the plan gates and membership. (1) Revokes INSERT, UPDATE, DELETE and TRUNCATE from `anon`/`authenticated` on `workspace_invites`, `workspace_members`, `workspace_subscriptions`, `team_invites` and `project_invites`. (2) `SECURITY INVOKER` guard triggers keyed on `current_user`: `anon`/`authenticated` may not insert `projects` or `teams`, change their `workspace_id` (or `teams.is_personal`), change `roadmaps.project_id` or `owner_id`, or set or change `profiles.is_guest` / `guest_session_id`. (3) Revokes INSERT, UPDATE and TRUNCATE on `roadmap_epics`, `roadmap_features` and `roadmap_tasks` (SELECT for realtime and DELETE unchanged), and EXECUTE on `upsert_full_roadmap`, `link_roadmap_to_project` and `get_or_create_default_project`. Safe because the backend writes all of these as the service role and web, agent and realtime never write them through PostgREST. Independent of `20260922120000`. Applied to hosted dev and production 2026-09-22 |

## Billing

Per-seat subscriptions on the Linear model: every `workspace_members` row is one seat, and seats
used is always `COUNT(workspace_members)`. The backend module is
`backend/src/modules/shared/platform-billing/` ("platform" because *billing* already means the
contract billing period in the marketplace modules).

**Provider-neutral.** The payment provider sits behind the `BillingProvider` interface
(`providers/billing-provider.ts`); Stripe is the only adapter today
(`providers/stripe/stripe-billing.provider.ts`). Seat policy, webhook idempotency, the monotonic
write guard, "an unknown price never downgrades a plan", dunning and reconciliation live in the
neutral services and are written once. `BillingProviderRegistry.active()` is the provider new
checkouts use (`BILLING_PROVIDER`, default `stripe`); `get(row.billing_provider)` is the provider
that owns an existing subscription, so changing `BILLING_PROVIDER` never strands a paying workspace.
A provider is configured by its credentials alone — there is no feature flag.

| Seat change | Policy | Stripe spelling |
| --- | --- | --- |
| Monthly, add or remove | `next_invoice` — nothing charged or credited now | `none` |
| Annual, add | `charge_now` — prorated remainder invoiced immediately | `always_invoice` |
| Annual, remove | `credit_next_invoice` — credit to future invoices, never refunded | `create_prorations` |

Seat sync runs, bounded to ~2 s and never throwing, after an invite is accepted and after a member
is removed. `provision_default_workspace()` writes memberships inside Postgres where no hook can
see them, so the hourly reconcile cron (`POST /api/platform-billing/cron/reconcile`,
`MEETINGS_CRON_SECRET`) is required, not optional. Webhooks arrive at
`POST /api/platform-billing/webhooks/:provider`. Deleting a workspace is refused (409) while its
subscription is live.

Prices come from env per provider (`STRIPE_PRICE_PRO_MONTHLY` … `_BUSINESS_YEARLY`). The yearly
price is the annual charge (Pro 120.00/year), not the per-month figure `/pricing` displays.

## Plans & limits

> **⚠️ Built, not in production.** Implemented in the repo and applied to hosted dev on
> 2026-09-22. The production rollout (both migrations through MCP `apply_migration`, then the
> backend and web deploys) is pending. This section describes the repo and hosted dev.

A workspace's plan decides how much it may create and which features its writes may use. The
numbers live in the database, not in code: a super admin changes a limit at `/admin/plans`
without a deploy, and `/pricing` reads the same table through `GET /api/plans`, so the pricing
page cannot promise more or less than enforcement allows. Enforcement runs only in the backend,
in `EntitlementsService`
([`backend/src/modules/shared/entitlements/`](../../../backend/src/modules/shared/entitlements/)),
and like the rest of this tier it is **not an authorization layer**. Every check sits after the
caller's own permission check, so a non-member still gets 403/404 and learns nothing about the
plan, and passing a plan check grants nothing.

```text
write request
   |
   v
permission check (project_access / workspace role) --fails--> 403 / 404, plan never read
   |
   v
EntitlementsService
   |  scope   entitlement_subject(project|team|roadmap) -> workspace | unhomed | exempt
   |  plan    workspace_plan_state(workspace)              Redis 60 s
   |  limits  plan_limit_keys + plan_limits                 memo 15 s + Redis 300 s
   |  usage   workspace_usage_counts / ai_context_roadmap_counts   (finite limits only)
   v
allowed  |  403 { error: { code: 'plan_limit', ... } }  |  lookup error -> allowed (fail open)
```

### The limit keys

Seed values, as `20260922120000` inserts them. The live values are whatever `/admin/plans` last
saved. A NULL value means unlimited.

| Key | Kind | Free | Pro | Business | Enterprise | Enforced |
| --- | --- | --- | --- | --- | --- | --- |
| `members` | count | 10 | unlimited | unlimited | unlimited | yes |
| `projects` | count | 2 | 10 | unlimited | unlimited | yes |
| `teams` | count | 2 | 3 | unlimited | unlimited | yes |
| `roadmap_nodes_per_roadmap` | count | 250 | unlimited | unlimited | unlimited | yes |
| `ai_messages_monthly` | quota | 50 per workspace | 500 per seat | 2,000 per seat | unlimited ("Negotiated") | **no** |
| `deliverables` | feature | off | on | on | on | yes |
| `deliverable_review` | feature | off | on | on | on | yes |
| `change_requests` | feature | off | on | on | on | yes |
| `risks` | feature | off | on | on | on | yes |
| `decisions` | feature | off | on | on | on | yes |
| `custom_register_fields` | feature | off | off | off | on | **no** |
| `time_tracking` | feature | off | on | on | on | yes |
| `private_teams_guests` | feature | off | off | on | on | **no** |
| `roles_permissions` | feature | off | off | on | on ("Granular") | **no** |
| `activity_retention_days` | days | 7 | 90 | unlimited | unlimited | yes |
| `activity_export` | feature | off | off | off | on | **no** |
| `mcp_server` | feature | off | on | on | on ("Higher limits") | yes |
| `saml_scim` | feature | off | off | off | on | **no** |

What each count measures: `members` is `workspace_members` rows, plus pending invites at invite
time; `projects` includes archived projects and excludes personal projects (`personal_projects`);
`teams` includes archived teams and excludes personal teams (`is_personal`); nodes are epics +
features + tasks on one roadmap, milestones excluded. Counts ignore status on purpose, so
archiving cannot be used to dodge a limit. The quoted labels are `display_label` marketing copy,
which enforcement never reads. A key marked **no** is display-only: `/pricing` shows it, and no
write path checks it.

### Where the numbers live

| Place | Owns |
| --- | --- |
| `plan_limit_keys` | One row per key: `kind` (`count` \| `quota` \| `days` \| `feature`), `label`, `description`, `unit`, `group_key`, `sort_order` |
| `plan_limits` | One row per (plan, key): typed `int_value` (NULL = unlimited) or `bool_value`, `per_seat` (quotas only), `display_label` (≤ 40 chars), `updated_by`, `updated_at`. A composite FK pins each cell to its key's kind |
| `ENTITLEMENT_KEYS` ([`entitlement-keys.ts`](../../../backend/src/modules/shared/entitlements/entitlement-keys.ts)) | What only the code can know: whether a key is enforced, what it is counted against, and the editor's floor (`members` ≥ 1) |

Both tables have RLS enabled with **zero policies**, so only the service role reads them;
`/pricing` goes through the backend, which keeps `updated_by` out of anonymous reads.
`entitlement-keys.migration-parity.spec.ts` parses the migration and fails if a code key is not
seeded with the same kind for all four plans. At runtime, a code key missing from the database
reads as unlimited or enabled and logs `entitlements_drift missing_in_db=…`; a database key the
code does not know is display-only. New keys and cells arrive only through migrations, because
the admin writer is UPDATE-only, and re-running the seed never overwrites an admin edit.

**Editing.** `/admin/plans` (`PlanLimitsEditor`) is readable by any active admin and saves only
for a `super_admin` (`SuperAdminGuard`, listed after `AdminGuard`). `PUT /api/admin/plan-limits`
calls `admin_update_plan_limits`, which takes an advisory transaction lock, rejects the save with
**409** `plan_limits_stale` when someone saved after the editor loaded (`base_version` is the
newest `updated_at`), updates only existing cells, and writes one `plan_limits.updated` audit row
with before and after. It returns **400** for a kind mismatch, days below 1, members below 1,
`per_seat` on anything but a quota, an unknown key, a duplicate cell or an empty change. A save
that makes a cheaper plan more generous than the next plan up returns a warning and still saves.

The web keeps a copy of the seed, `DEFAULT_PLAN_LIMITS`
([`web/src/lib/planLimits.ts`](../../../web/src/lib/planLimits.ts)), pinned to the migration by a
test. `/pricing` ([`web/src/lib/pricing.ts`](../../../web/src/lib/pricing.ts)) renders from
`GET /api/plans` and uses the copy for the first frame and during an API outage.

### The effective plan

The rule is defined once, in the SQL function `workspace_plan_state`. TypeScript reads its
result and never re-derives it.

```text
comp_active = is_discounted_free AND (discounted_until IS NULL OR discounted_until > now())
paid        = subscription plan  while status IN (active, trialing, past_due)
              free               otherwise, or with no subscription row
effective   = the higher-ranked of (comp_active ? discounted_plan : free) and paid
plan_source = complimentary      when comp_active and the comp outranks paid
              subscription       when paid <> free   (a tie is subscription: they are paying)
              default            otherwise
```

Rank is `plan_rank()`: free 0, pro 1, business 2, enterprise 3, and an unknown plan ranks as
free. A complimentary plan therefore never downgrades a paying customer.

### Complimentary plans

Staff can give a workspace a plan for free (a "comp"). The state is four columns on
`workspaces`:

| Column | Holds |
| --- | --- |
| `is_discounted_free` | `boolean NOT NULL DEFAULT false`; a CHECK keeps it equal to `discounted_plan IS NOT NULL` |
| `discounted_plan` | `pro` \| `business` \| `enterprise` |
| `discounted_at` | When the comp started; kept when an existing comp is changed |
| `discounted_until` | When it ends; NULL means no end |

- **Why on `workspaces`.** Webhooks and the reconcile cron rewrite `workspace_subscriptions` and
  never touch `workspaces`, so a comp cannot be overwritten by the payment provider.
- **Who and why are not on the row.** Every member can read `workspaces.*`, so the actor and the
  note go to `platform_admin_audit_log` (`actor_id`, `action`, `target_type`, `target_id`,
  `before`, `after`, `note` ≤ 1000 chars), which no browser can read. Actions:
  `plan_limits.updated`, `workspace_comp.granted`, `workspace_comp.updated`,
  `workspace_comp.revoked`.
- **Granting and revoking.** A `super_admin` does it at `/admin/workspaces`
  (`PUT` / `DELETE /api/admin/workspaces/:id/comp`), which calls `admin_set_workspace_comp` or
  `admin_clear_workspace_comp`. Both lock the row and write an audit row only when something
  changed. Granting needs a note of 1–1000 chars, and `until` must be in the future. Revoking is
  idempotent.
- **Guarded.** The `workspaces_discount_guard` trigger rejects any `anon` or `authenticated`
  change to the four columns. It is a second line behind the write revoke on `workspaces`.
- **Money stays with the owner.** A comp never cancels a subscription; granting one over a live
  subscription returns the warning `workspace_has_live_subscription`. Billing offers checkout only
  for plans ranked above an active comp, and refuses the rest with **409**
  `workspace_complimentary`.
- **Lapsing.** Once `discounted_until` passes, the comp stops counting, but it stays on the row.
  The admin list's `comped` filter still shows it so staff can tidy it up.

### Which workspace decides

`entitlement_subject(kind, id)` answers which workspace's plan governs a write. It is read-only
and never provisions a workspace.

| Subject | Plan comes from |
| --- | --- |
| Project | `projects.workspace_id` |
| Team | `teams.workspace_id`: the team's own workspace, not a project's. In marketplace work the consultant's team and the client's project sit in different workspaces |
| Roadmap | Linked: its project's answer. Standalone: the owner's default workspace (`user_default_workspace_id`, the same earliest-owner-membership rule as [Where new work lands](#where-new-work-lands)) |

- **Unhomed** (no workspace, not exempt): Free limits. Workspace-scoped counts are skipped,
  because there is nothing to count.
- **Exempt:** a row owned by a guest with no workspace, and a create whose
  `resolveWorkspaceForWrite` returned null (a guest). Guests stay outside every limit until they
  convert. `20260922130000` stops users from setting `profiles.is_guest` (or
  `guest_session_id`) on themselves, which would otherwise make their own rows exempt, and stops
  them from moving projects, teams and roadmaps between workspaces over PostgREST, which would
  otherwise let them pick the plan that governs a row.

### Over the limit: block new, keep existing

No limit deletes or archives anything. A count check runs only when a write would grow a count,
so a workspace that ends up over a count limit (after a downgrade, a lapsed comp or an admin
edit) keeps everything and can keep editing it; only new creations are refused. Feature gates
work differently: on a plan without a feature, that feature's writes are refused and its reads
stay open ([What each gate blocks](#what-each-gate-blocks)).

- **Counts** (`members`, `projects`, `teams`): a create passes while `used + adding <= limit`.
- **Roadmap nodes** use the grandfather rule (`violatesGrandfatheredLimit`): a write is refused
  only when the new total is over the limit **and** above the previous total. An over-limit
  roadmap can be edited, reordered and shrunk; it cannot grow. A per-node create counts the stored
  total plus the nodes it adds. Moving a roadmap into another workspace (link, replace, or unlink
  to the owner's workspace) is judged from 0 against the destination's plan; a move within one
  workspace is never counted.
- **Members:** a new invite spends a seat when it is sent, so it is checked with pending invites
  counted. Refreshing an invite that is already pending is not checked. At accept time only real
  members count, and a refused accept leaves the invite pending, to accept again after an
  upgrade.
- An unlimited cell never runs a count query, so paid plans pay only for cached lookups.

### What each gate blocks

| Key | Blocked | Stays open |
| --- | --- | --- |
| `members` | Sending a new invite, and accepting one, at the cap | Refreshing a pending invite; accepting when already a member; creating a workspace; `provision_default_workspace`; removing members |
| `projects` | `createProject` and `createProjectFromRoadmap` (guest conversion), which covers MCP `project_create` | Personal-project provisioning; editing, archiving and deleting |
| `teams` | `createTeam` | Personal-team provisioning; everything on existing teams |
| `roadmap_nodes_per_roadmap` | Epic, feature and task create and clone; moving a feature to an epic on another roadmap (the feature and its tasks count against the destination); timer quick-create; AI commit and its preview (as a `PLAN_LIMIT` issue); undo and redo of AI changes; JSON patch; `POST /roadmaps/full`; linking, replacing and unlinking a roadmap across workspaces; template instantiate | Any write that does not grow the total |
| `deliverables`, `deliverable_review`, `change_requests`, `risks`, `decisions` | Every write on that register, deletes included. A deliverable with reviewers, submit, review and reviewer edits need both `deliverables` and `deliverable_review`; decision categories need `decisions` | Every read (list, get, candidates), so a downgraded workspace still sees everything it recorded |
| `time_tracking` (the team's workspace) | Turning time tracking on for a team; starting, manually creating, editing, deleting and commenting on time logs | Turning it off; pause, resume, stop and review, so running timers can wind down and payouts are not stranded; every read; logs with no team |
| `mcp_server` | Every MCP tool and resource call, reads included | Connecting and listing tools; the static MCP App shell; prompts. See [Backend → MCP](../../03-backend/mcp.md#plan-gate) |
| `activity_retention_days` | Nothing is blocked; older rows are hidden (below) | — |

### Activity retention: hide, not purge

`getRetentionCutoff` turns `activity_retention_days` into a cutoff of now minus that many days,
and three reads apply it as a lower bound:

- the project activity feed (`ActivityService`), whose list response carries
  `retention: { days, cutoff }` so the page can say why the feed stops;
- roadmap change history (`RoadmapAiService.listChangeHistory`);
- task history (`TasksService.getHistory`).

Nothing is deleted, so an upgrade shows the older rows again. The agent's run guard reads the
change log through the AI context API, which is deliberately not windowed.

### The error contract

A refusal is `PlanLimitException`: **403**, deliberately not 429 (the agent retries 429), 402
(MCP would flatten it to `INTERNAL`) or 409 (reserved for `STALE_REVISION`). `HttpExceptionFilter`
nests the payload under `error`:

```json
{
  "error": {
    "code": "plan_limit",
    "kind": "count",
    "limit_key": "projects",
    "label": "Projects",
    "limit": 2,
    "used": 2,
    "plan": "free",
    "upgrade_plan": "pro",
    "workspace_id": "…",
    "workspace_slug": "acme",
    "context": "create",
    "message": "Your Free plan includes 2 projects and this workspace has 2. Upgrade to Pro to add more.",
    "status": 403,
    "path": "/api/projects"
  }
}
```

| Field | Meaning |
| --- | --- |
| `kind` | `count` or `feature`; `limit` and `used` are null for a feature |
| `upgrade_plan` | The cheapest higher plan that would allow it, read from the live matrix; null means no plan does ("Contact sales") |
| `context` | `invite` \| `accept` \| `create` \| `full_state` \| `link` \| `enable` \| `write`; the web picks its copy from it |
| `message` | Plain copy that reads correctly for a non-member. The accept message names the workspace and asks the invitee to have an owner upgrade |

Where it surfaces: the web recognises it anywhere
([`web/src/lib/planLimitErrors.ts`](../../../web/src/lib/planLimitErrors.ts)), raises one
upgrade toast that links to the Usage page (`PlanLimitBridge`), and the members panel, the create
screens and a team's time-tracking settings show an inline `PlanLimitNotice`. MCP reports it as
`PLAN_LIMIT`. The AI commit preview reports it as a `PLAN_LIMIT` validation issue
([Operations schema](../../05-agent-ai/operations-schema.md)), and the agent treats `plan_limit`
as final: it explains the limit and never retries or works around it.

### Fail open

- Any non-HTTP error during an entitlement lookup (a repository error, or a table missing because
  the migration has not reached that database) is logged as `entitlements_lookup_failed` and the
  write is **allowed**. A broken lookup never blocks a customer. The MCP gate follows the same
  rule and logs `mcp_plan_gate_lookup_failed`; checkout's complimentary-plan check does too.
- A key missing from the database (drift) reads as unlimited or enabled.
- The display endpoints do not pretend. `GET /api/workspaces/:id/usage` answers **503**, which
  the page explains. `GET /api/plans` answers **503** with `Cache-Control: no-store`, so the edge
  never caches the failure, and the web falls back to `DEFAULT_PLAN_LIMITS`.

### Caching windows

| What | Where | Window | Refreshed by |
| --- | --- | --- | --- |
| Limit matrix | In-process memo, then Redis `cache:v1:entitlements:limit-matrix` | 15 s memo, 300 s Redis | An admin save clears this instance's memo and Redis, purges `/api/plans` at the edge, and repeats the invalidation 1.5 s later. Other instances pick it up when their memo expires (≤ 15 s) |
| Workspace plan state | Redis `cache:v1:entitlements:plan-state:ws:<id>` | 60 s | Deleted on a comp grant or clear, a billing webhook write and a reconcile correction. Checkout reads it fresh |
| MCP coarse gate: the user's workspace ids | Redis `cache:v1:entitlements:user-workspaces:user:<id>` | 60 s | Expiry, so a membership change can take up to 60 s. Each workspace's plan is read through the plan-state cache above, so a plan change applies as soon as that key is deleted |
| Roadmap scope | In-process memo in `RoadmapPlanLimitsService` | 30 s | Expiry |
| `GET /api/plans` | Cloudflare edge (`PUBLIC_EDGE_SHORT`) | `max-age` 60 s, `s-maxage` 300 s, `stale-while-revalidate` 60 s by default (env-overridable) | Purged on an admin save |
| Web plan matrix (`usePublicPlanLimits`) | TanStack Query | 5 min stale time | Refetch |

### The Usage page

`/w/<slug>/settings/usage` (`WorkspaceUsagePage`) is a tab in workspace settings, readable by
every member, and renders `GET /api/workspaces/:id/usage`:

- **Plan:** the effective plan and why (subscription, complimentary with its end date, or
  default). The billed plan and its status are in the payload for owners and admins only.
- **Meters** for members (pending invites counted, and the page says so), projects and teams.
  A meter turns to a warning from 80 %, then "at limit", then "over" for grandfathered usage.
- **Roadmaps:** the largest roadmap, and every roadmap near, at or over the node limit. A
  roadmap's name and project appear only when the viewer can open it; otherwise the page shows
  its size alone.
- **Features:** the enforced features only, each with "Included" or the cheapest plan that
  includes it. Display-only keys are left out, because they gate nothing yet.
- **Retention:** the activity window, worded as hidden, not deleted.
- **Upgrade:** only an owner gets the button; everyone else is told to ask an owner. A
  complimentary workspace, or one already on the top plan, gets no call to action.

### HTTP routes

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/plans` | Public, edge-cached. `{ plans, keys, limits, version }`; omits `enforced`, `updated_by` and drift |
| GET | `/api/workspaces/:workspaceId/usage` | Any member |
| GET | `/api/admin/plan-limits` | Any active admin: every cell with `updated_at` / `updated_by`, `enforced`, `version`, drift |
| PUT | `/api/admin/plan-limits` | `super_admin`: `{ changes[1..200], note?, base_version? }` |
| GET | `/api/admin/workspaces` | Any active admin: `?search=&filter=all\|comped\|paid\|free&page=&page_size=` (≤ 100), each row with usage, plan, comp and `over_limit` |
| GET | `/api/admin/workspaces/:id` | Any active admin: the row, its five largest roadmaps, and its last 20 audit entries |
| PUT | `/api/admin/workspaces/:id/comp` | `super_admin`: `{ plan, until?, note }` |
| DELETE | `/api/admin/workspaces/:id/comp` | `super_admin`: optional note in the body or `?note=` |

Every admin route carries `SupabaseAuthGuard` + `AdminGuard` and `no-store`. Their web pages are
`/admin/plans` and `/admin/workspaces`, where the edit controls appear only for a `super_admin`.

### Known limitations

- **Concurrent accepts can over-admit by one.** Two invitees accepting the last seat at the same
  moment can both pass the pre-check. A post-insert rank check removes the later joiner, but it
  ranks by `joined_at`, which is the transaction start rather than the commit order, so in a
  narrow window both stay.
- **Project and team creates are count-then-insert,** so two simultaneous creates at the cap can
  both land, one over the limit.
- **Untargeted MCP list tools** (`projects_list`, `search_everything`, `my_tasks_list`, room-keyed
  chat reads) get only the coarse gate: some workspace the user belongs to includes MCP.
- **Knowledge search is not windowed.** The knowledge index ingests `project_activity_log`, so
  the assistant's knowledge search and MCP `project_knowledge_search` can surface activity older
  than the plan's retention window.
- **AI messages are not metered.** `ai_messages_monthly` is published and not enforced.
- **Display-only keys:** `roles_permissions`, `private_teams_guests`, `activity_export`,
  `saml_scim` and `custom_register_fields` appear on `/pricing` and gate nothing.

## Code locations

- **Backend:** [`backend/src/modules/execution/workspaces/`](../../../backend/src/modules/execution/workspaces/) —
  service injects `SUPABASE_ADMIN` directly, no repository (the `teams` shape).
  Onboarding wiring: [`backend/src/modules/shared/auth/auth.service.ts`](../../../backend/src/modules/shared/auth/auth.service.ts).
- **Plan limits (backend):** [`backend/src/modules/shared/entitlements/`](../../../backend/src/modules/shared/entitlements/) —
  `EntitlementsCoreModule` (the service feature modules import) and the HTTP leaf
  `EntitlementsModule` (`/api/plans`, usage, the admin editors);
  [`roadmap-plan-limits.service.ts`](../../../backend/src/modules/execution/roadmaps/services/roadmap-plan-limits.service.ts)
  (node limit and retention for roadmap writes);
  [`delivery-plan-gate.ts`](../../../backend/src/modules/execution/delivery/delivery-plan-gate.ts);
  [`mcp-plan-gate.ts`](../../../backend/src/modules/shared/mcp/mcp-plan-gate.ts);
  [`super-admin.guard.ts`](../../../backend/src/common/guards/super-admin.guard.ts).
- **Plan limits (web):** [`web/src/lib/planLimits.ts`](../../../web/src/lib/planLimits.ts),
  [`web/src/lib/planLimitErrors.ts`](../../../web/src/lib/planLimitErrors.ts),
  `web/src/components/workspace/settings/WorkspaceUsagePage.tsx`,
  `web/src/components/billing/` (`PlanLimitNotice`, `PlanLimitBridge`),
  `web/src/components/admin/plans/`, `web/src/components/admin/workspaces/`.
- **Web:** `web/src/components/workspace/`, `web/src/routes/workspace/`,
  [`web/src/lib/workspaceScope.ts`](../../../web/src/lib/workspaceScope.ts),
  [`web/src/stores/workspaceStore.ts`](../../../web/src/stores/workspaceStore.ts),
  `web/src/services/workspaces.service.ts`, `web/src/hooks/useWorkspaceQueries.ts`.

## See also

- [Teams & Time](../teams-and-time/README.md) — what a team is, and why team membership is also not project access.
- [Data → schema overview](../../07-data-and-db/schema-overview.md) — the workspace tables in the wider schema.
- [Proposals → pricing tiers](../../13-proposals/pricing-tiers-and-add-ons.md) — the monetization design; its entitlement and limit phases (B1, B3) are the [Plans & limits](#plans--limits) layer above, and its AI metering and add-ons are still unbuilt.
- [Backend → MCP](../../03-backend/mcp.md#plan-gate) — the `mcp_server` gate in detail.
