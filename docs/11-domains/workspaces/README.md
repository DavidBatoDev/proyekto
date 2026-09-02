# Workspaces

> **Last updated:** 2026-09-03 · **Status:** shipped (in production since 2026-09-02; URL handles added 2026-09-03)

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
> seat. Code shipped in commits `edd59e03`..`672bd021` on `main`.

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
| `workspaces` | `id`, `name` (1–120 chars, non-blank), `description` (≤2000), `avatar_url`, `slug` (**the URL handle**, `/w/<slug>/…`: NOT NULL, unique, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–60 chars, never uuid-shaped; filled by the `workspaces_slug_guard` trigger from the name on insert, so no insert path needs to know the rule), `created_by` (→ `profiles`, **ON DELETE SET NULL**, audit only), timestamps. **No `owner_id`** |
| `workspace_slug_history` | `slug` **PK** → `workspace_id` (**CASCADE**), `replaced_at`. A renamed workspace's old handles, kept so old links redirect (GitHub model). Renaming back to an own old handle reclaims it; another workspace can never take it. RLS: members read their workspace's rows, which is how `previous_slugs` rides the membership list |
| `workspace_reserved_slugs` | `slug` **PK**, `note`. The single source of truth for handles a workspace may not take: everything that is a route name under `/w/<slug>/` (`settings`, `teams`, `dashboard`, `members`, `billing`, `time`, `my-logs`, …), every top-level route name, and the usual `admin`/`api`/`www`/`login`… set. Publicly readable |
| `workspace_members` | The seat pool. `workspace_id` + `user_id` + `role` (`owner` \| `admin` \| `member`) + `joined_at`, `UNIQUE (workspace_id, user_id)` |
| `workspace_subscriptions` | `workspace_id` **PK** (1:1), `plan` (`free` \| `pro` \| `business` \| `enterprise`), `status` (`active` \| `trialing` \| `past_due` \| `canceled`), nullable `seat_limit`, period columns, `metadata` jsonb |
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
| `member` | Read the workspace and its member list; create teams and projects in it |

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
| GET | `/api/workspaces` | Any member — the switcher's list, with `my_role`, `member_count`, `plan` |
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

`me/invites` is declared **before** the `:id` routes so Nest's matcher does not read `me` as a
workspace id.

`POST /api/teams` (`CreateTeamDto`) and `POST /api/projects` (`CreateProjectDto`) accept an
optional `workspace_id`; omitting it means "the caller's default workspace". It is **deliberately
absent from `UpdateTeamDto`**: moving a team between organizations would have to carry its
projects, rates, and payouts with it, and that is not a rename. There is no move endpoint.

## Web surface

- **Switcher** — `WorkspaceSwitcher` in `SidebarContent`; the selection itself lives in
  `useWorkspaceStore` (per-user `localStorage`, key `proyekto_current_workspace:<userId>`), while
  the workspace list stays in TanStack Query. The selection is per-device on purpose, and it is
  **not** `profiles.settings.workspace_defaults` — that key already means the sidebar's default
  team/project and predates this tier.
- **URLs** — organizational pages live at `/w/<slug>/dashboard`, `/w/<slug>/teams/…`, and
  `/w/<slug>/settings{,/members,/billing}`. The `/w/$workspaceSlug` layout route resolves the slug
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
- **Billing is a placeholder.** It renders the plan label and seats-used and nothing else — there
  is no payment processor, no checkout, and no enforcement anywhere in the product.
- **Scoping** — `groupByWorkspace` (`web/src/lib/workspaceScope.ts`) splits teams and projects
  three ways: in the open workspace → the main list; unhomed, or in a workspace the viewer is not a
  member of → **"Shared with you"**; in another workspace the viewer *does* belong to → hidden
  until they switch. With no workspace selected it falls back to one flat list, so an unresolved
  selection never reads as data loss. Consumed by `SidebarContent`, `ProjectsGrid`, `TeamsGrid`,
  and `DashboardWidgets`.

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

## Code locations

- **Backend:** [`backend/src/modules/execution/workspaces/`](../../../backend/src/modules/execution/workspaces/) —
  service injects `SUPABASE_ADMIN` directly, no repository (the `teams` shape).
  Onboarding wiring: [`backend/src/modules/shared/auth/auth.service.ts`](../../../backend/src/modules/shared/auth/auth.service.ts).
- **Web:** `web/src/components/workspace/`, `web/src/routes/workspace/`,
  [`web/src/lib/workspaceScope.ts`](../../../web/src/lib/workspaceScope.ts),
  [`web/src/stores/workspaceStore.ts`](../../../web/src/stores/workspaceStore.ts),
  `web/src/services/workspaces.service.ts`, `web/src/hooks/useWorkspaceQueries.ts`.

## See also

- [Teams & Time](../teams-and-time/README.md) — what a team is, and why team membership is also not project access.
- [Data → schema overview](../../07-data-and-db/schema-overview.md) — the workspace tables in the wider schema.
- [Proposals → pricing tiers](../../13-proposals/pricing-tiers-and-add-ons.md) — the unbuilt monetization layer this scaffold anticipates.
