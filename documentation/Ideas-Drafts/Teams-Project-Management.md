# Linear-style Teams refactor (Teams + Projects as siblings)

## Context

Today every project has a flat `project_shares` table that mixes client
stakeholders and the consultant's delivery crew, and `project_member_time_rates`
hangs off that mixed list. Because the project owner (often the client) gets
admin on the project, they can also see and edit the consultant's hourly rates
— a control that should belong to the consultant, not the buyer.

Linear/Figma solve this by separating **Teams** (who executes) from
**Projects** (what's delivered). We're adopting the same shape:

- **Teams** are global, reusable groupings owned by any user. Anyone can
  create a team — but rate/billing fields on `team_members` only become
  writable when the team owner is `is_consultant_verified = true`
  (per-feature gate).
- **Projects** keep their existing identity but gain a **primary team** and
  an optional list of **contributor teams** (m2m). Both clients and
  consultants can attach teams.
- **Time rates move to `team_members`** and are managed by the team owner
  (or an admin within the team). `project_member_time_rates` is dropped.
- **`project_shares` stays** as the per-project access list, but team
  members reach it via a curation step. Attaching a team makes its members
  *available* to add to the project; the project admin picks which ones
  (defaults to "all selected" so simple cases stay one-click). The picked
  set lives in a new `project_team_members` table and the trigger fans it
  out to `project_shares`. Direct shares remain for clients / individuals
  who aren't on a team.

This makes the control story clean: a client owning a project still has full
access to deliverables, but cannot see or edit the consultant's rate card,
because rates aren't on anything the client owns. It also avoids two
serious footguns: a new hire on the consultant's team is **not** auto-added
to in-flight client projects, and a project admin can drop a team member
from their own project without needing the team owner's involvement.

## Decided design (from Q&A)

- **Q1 Team owner:** anyone, with a per-feature consultant gate
- **Q2 Project↔Team:** primary team + optional contributor teams
- **Q3 Team scope:** global, reusable across projects
- **Q4 Consultant gate:** per-feature (rates only appear/writable when team
  owner is consultant-verified)
- **Q5 Shares source:** team-attached + per-project curation. Attaching a
  team exposes its roster; project admin picks which members participate
  (`project_team_members`). Selection trigger fans out to `project_shares`.
  Direct shares allowed for clients / individuals not on any team.
- **Q6 Rates:** team-level only — drop `project_member_time_rates`

### Why curation, not auto-fan-out (Option B over Option A)

Walked through scenarios; the deciding ones:
- **New hire footgun**: A would auto-share new team joiners into every
  in-flight client project, including chats. B requires explicit add.
- **Client autonomy**: A blocks the project owner from removing a team
  member without the team owner's cooperation. B lets the project admin
  curate freely.
- **Migration cleanliness**: B's backfill maps 1:1 from existing
  `project_shares` → `project_team_members`. A would have to
  reverse-engineer team rosters from per-project share patterns.
- **Overlap & sub-teams**: B handles "2 from team X, 1 from team Y" and
  same-person-on-two-teams without merge rules.

A's only real win is conceptual neatness ("team = unit"), which loses
immediately to the consultant-agency reality where the same crew serves
heterogeneous client projects.

## Schema changes (new migration `2026_05_07_*_teams.sql`)

### New tables

```sql
create table teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete restrict,
  name text not null,
  description text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Block deletion while attached to any project; admin must detach
-- explicitly so the consequences (mass share removal) are visible.
-- Enforced via FK on project_teams.team_id below (on delete restrict).

create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner','admin','member')),
  -- billing (consultant teams only; nullable on non-consultant teams)
  hourly_rate numeric(12,2),
  currency text,
  custom_id text,
  start_date date,
  end_date date,
  joined_at timestamptz default now(),
  unique (team_id, user_id)
);

create table project_teams (
  project_id uuid not null references projects(id) on delete cascade,
  team_id uuid not null references teams(id) on delete restrict,
  is_primary boolean not null default false,
  default_role text not null default 'editor'
    check (default_role in ('admin','editor','commenter','viewer')),
  attached_by uuid references profiles(id),
  attached_at timestamptz default now(),
  primary key (project_id, team_id)
);
-- 'on delete restrict' on team_id makes team deletion fail loudly while
-- the team is attached to any project. Detach first, then delete.
-- 'on delete cascade' on project_id is fine; deleting a project should
-- clean up its team attachments.

-- only one primary team per project
create unique index project_teams_one_primary
  on project_teams (project_id) where is_primary;

-- Per-project curation: which members of an attached team actually
-- participate in this project. Source of truth for team-derived shares.
create table project_team_members (
  project_id uuid not null references projects(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null
    check (role in ('admin','editor','commenter','viewer')),
  -- per-(project, team, user) capability override on top of role preset.
  -- The sync trigger composes project_shares.capabilities as
  -- ROLE_DEFAULTS[role] merged with this overrides object. Storing it
  -- here means the trigger can deterministically rewrite
  -- project_shares.capabilities from project_team_members without
  -- clobbering admin tweaks.
  capabilities jsonb not null default '{}'::jsonb,
  added_by uuid references profiles(id),
  added_at timestamptz default now(),
  primary key (project_id, team_id, user_id),
  -- enforce that (project_id, team_id) is actually attached
  foreign key (project_id, team_id)
    references project_teams(project_id, team_id) on delete cascade,
  -- enforce that (team_id, user_id) is actually a team member; cascade
  -- removal so leaving a team automatically drops them from all projects
  foreign key (team_id, user_id)
    references team_members(team_id, user_id) on delete cascade
);
```

### Owner protection on team_members

```sql
-- Block deletion of the owner's own team_members row; ownership must be
-- transferred (out of scope v1) or the team deleted instead.
create or replace function tg_team_members_block_owner_delete()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from teams t
             where t.id = old.team_id and t.owner_id = old.user_id) then
    raise exception 'Cannot remove team owner; transfer ownership first';
  end if;
  return old;
end $$;
create trigger team_members_block_owner_delete
  before delete on team_members
  for each row execute function tg_team_members_block_owner_delete();
```

`team_members` needs a uniqueness target for that composite FK to bind
to: add `unique (team_id, user_id)` (already in the DDL above).

### Adjustments to existing tables

- `projects.primary_team_id uuid references teams(id)` — denormalized
  pointer for fast lookups; kept in sync with `project_teams.is_primary`
  via trigger. **Nullable** — personal workspace projects never get a
  team and stay null forever. Every consumer must handle the null case.
- `project_shares` — **PK changes** from `(project_id, user_id)` to
  `(project_id, user_id, origin)` so a user can hold multiple rows on
  one project (one direct + one or more `team:<id>` rows). Migration
  must drop the old PK, add the new one, and any code that upserts
  `(project_id, user_id)` must include `origin` in the conflict target.
- `project_member_time_rates` is replaced by `team_members` rate fields
  PLUS a per-log rate snapshot — see `task_time_logs` below. Table is
  legacy and gets dropped in migration B.
- `task_time_logs` (current schema, confirmed in
  `documentation/Databases_Tables_Versions/2026_05_06_1606-db.sql:513`):
  fields `id, project_id, task_id, member_user_id, started_at,
  ended_at, duration_seconds, status, reviewed_by, reviewed_at,
  review_note, source, created_at, updated_at`. **No rate column today
  — billable amount is computed at read time by joining
  `project_member_time_rates`.** Migration A adds:
  - `rate_snapshot numeric NOT NULL DEFAULT 0 CHECK (rate_snapshot >= 0)`
  - `currency_snapshot text NOT NULL DEFAULT 'USD'`
  Backfill: for each existing row, find the matching
  `project_member_time_rates` row by `(project_id, member_user_id)`
  whose `start_date`/`end_date` window covers `started_at::date`
  (fall back to the most-recent rate if no temporal match), copy
  `hourly_rate` and `currency`. After backfill, drop the defaults so
  future inserts must supply the snapshot explicitly. Service writes
  future logs reading `team_members.hourly_rate` for the consultant
  whose primary team owns the project (or the project's primary team
  member matching `member_user_id`).

### Drops (in a follow-up migration after backfill verifies)

- `project_member_time_rates` — replaced by `team_members.hourly_rate` /
  `currency` / `custom_id` / `start_date` / `end_date`.
- `projects.consultant_id` becomes redundant (the primary team's owner is
  the consultant). Keep the column for one release with a sync trigger,
  drop in the follow-up.

### Backfill (same migration)

Reference for legacy `project_member_time_rates` shape (
`documentation/Databases_Tables_Versions/2026_05_06_1606-db.sql:258`):
fields `id, project_id, project_member_id, member_user_id, hourly_rate,
currency, custom_id, start_date, end_date, created_at, updated_at`.
The `project_member_id` column points at the now-defunct
`project_members` table — ignore it; use `member_user_id` as the join
key throughout backfill.

For each existing project:
1. Find the consultant (`projects.consultant_id` if present, else look up
   the share with `origin='consultant_match'`).
2. If that consultant doesn't already own a team, create one named
   `"<Consultant Display Name>'s Team"`. Insert every consultant-side
   member who has *ever* shared with this consultant (union across all
   their projects) into `team_members`.
3. Copy each member's most recent (by `updated_at`) row from
   `project_member_time_rates` for that consultant's projects into the
   matching `team_members` row (`hourly_rate, currency, custom_id,
   start_date, end_date`). If a member has different rates across
   projects, pick the most-recent and log a warning row to a temporary
   `team_rate_backfill_conflicts` table for manual review — these are
   the cases where the agency had per-project pricing that the
   team-level model can't represent natively.
4. Insert into `project_teams (project_id, team_id, is_primary=true,
   default_role='editor')`.
5. For *this* project specifically, insert into `project_team_members`
   exactly the consultant-side members who already had a share on this
   project — preserving each one's existing role. This is the 1:1 map
   from current state to the new curation table; no over- or
   under-sharing happens at the cutover.
6. Set `projects.primary_team_id`.
7. Direct shares (clients, individual stakeholders) stay as-is in
   `project_shares` with their existing origin.
8. Backfill `task_time_logs.rate_snapshot` / `currency_snapshot` from
   `project_member_time_rates` joined on `(project_id, member_user_id)`
   with temporal match on `started_at::date BETWEEN start_date AND
   end_date` (fall back to most-recent rate when no temporal window
   matches). After this step, `task_time_logs` is self-contained for
   billing purposes.

A second migration (after verification window) drops
`project_member_time_rates` and `projects.consultant_id`.

### Sync triggers

- `project_team_members` insert/update/delete → upsert/delete the
  matching `project_shares` row with `origin = 'team:<team_id>'` and
  `role` = the curation row's role. This is the **only** path that
  team-derived shares enter `project_shares`.
- `team_members` delete → cascades into `project_team_members` via FK,
  which cascades into `project_shares`. Leaving a team removes the user
  from every project that team was on.
- `team_members` insert → does NOT auto-fan-out. New team joiners only
  appear on projects after a project admin (or auto-bulk-add at attach
  time) adds them to `project_team_members`. This is the intentional
  "no surprise access" property.
- `project_teams` delete → cascades into `project_team_members` (and
  thus `project_shares`). Detaching a team removes all its derived
  shares on that project.
- `project_teams` insert → does not auto-populate; the attach API call
  is responsible for bulk-inserting the chosen members into
  `project_team_members` (defaults to all team members; UI offers a
  multi-select).
- `project_teams.is_primary` change → updates `projects.primary_team_id`.
- `team_members.hourly_rate` write — RAISE EXCEPTION if the team owner is
  not `is_consultant_verified`. Enforced in DB so the gate is real even
  if a service-role caller tries to bypass it.

### Conflict rules (multi-source shares)

`project_shares` PK is `(project_id, user_id, origin)`. A user can hold:
- one direct row (`origin in ('owner','invite','consultant_match', ...)`)
- one team-derived row per attached team containing them
  (`origin = 'team:<team_id>'`)

`resolvePermissions(callerId, projectId)`:
1. Selects all rows for `(projectId, callerId)`.
2. Computes effective role = max across rows by role hierarchy
   (`viewer < commenter < editor < admin`).
3. Computes effective capabilities = OR-union of each row's
   `capabilities` JSONB.
4. Returns the merged object in the same shape as today; callers don't
   change.

Removing one source row (e.g., team-derived) leaves the others intact.

### Re-attach behavior

Detaching a team cascades through `project_team_members` (rows
deleted, not soft-deleted). Re-attaching the same team is a fresh
decision: the attach API call defaults `member_user_ids` to the team's
*current* roster. No memory of the prior selection is preserved.

## Backend changes

### New module: `backend/src/modules/teams/`
- `teams.controller.ts` — REST: list/create/update/delete teams owned by
  caller, list members, add/remove members, set rates (consultant gate
  enforced via `is_consultant_verified` check on the owner).
- `teams.service.ts` — CRUD + the consultant-persona gate around rate
  writes. Returns 403 `MissingPermissionException` with
  `requiredRole='consultant'` when a non-consultant tries to write rates.
- `teams.repository.ts` — Supabase queries.

### Project module updates
- New endpoints under `projects.controller.ts`:
  - `POST /projects/:id/teams` — attach team. Body includes
    `member_user_ids: string[]` (defaults to "all current team members"
    when omitted) so the curation rows are inserted atomically with the
    attachment.
  - `DELETE /projects/:id/teams/:teamId` — detach team (cascades shares).
  - `PATCH /projects/:id/teams/:teamId` — default_role / is_primary.
  - `POST /projects/:id/teams/:teamId/members` — add a curated member
    `{ user_id, role? }` (role defaults to `project_teams.default_role`).
  - `DELETE /projects/:id/teams/:teamId/members/:userId` — remove from
    this project only (team membership untouched).
  - `PATCH /projects/:id/teams/:teamId/members/:userId` — change role.
  - `GET /projects/:id/teams/:teamId/available-members` — lists team
    members not yet curated onto this project, for the picker UI.
- `projects.service.ts`:
  - When a project is created and the creator is a consultant, auto-create
    or auto-attach their personal team as primary.
  - `assertCanManageMembers` for time rates now delegates to
    `teams.service.assertCanEditTeamMember` (owner of the relevant team
    or `team_members.role in ('owner','admin')` on that team) — clients
    no longer pass even if they're project admin.
- Time-rate endpoints (`project-time` module) — read rates from
  `team_members` joined through `project_teams`, not from
  `project_member_time_rates`. Writes go through the teams service.

### Authorization layer
- `project-authorization.service.ts` `resolvePermissions` keeps its
  return shape but now reads multiple rows per `(project, user)` and
  merges them (role-max + capability OR-union). The `origin` field
  becomes the audit trail surfaced to the UI.
- New permission path `team.manage_rates` (already aliased today via
  `time.manage_rates`) — keep `time.manage_rates` as the path but check
  it against team membership instead of project role for projects with a
  primary team.

## Frontend changes

### New routes
- `/teams` — list teams the user owns or belongs to.
- `/teams/$teamId` — team detail: members, rates (consultant gate),
  attached projects.
- `/teams/$teamId/members` — member matrix (role + rate columns; rate
  column hidden for non-consultant owner).

### Project settings
- New tab `Teams` under `/project/$projectId/settings/`:
  - Lists primary team + contributor teams with attach/detach controls.
  - Each attached team expands to show its **curated members on this
    project**, with an "Add member from team" picker (lists team members
    not yet on the project) and per-row remove / role-change controls.
  - Attach-team flow: pick team → multi-select members (all checked by
    default) → confirm. One-click "attach with everyone" stays as the
    happy path.
- Existing `/permissions?memberId=` editor still works for any share row
  regardless of origin; the row's `origin` chip just shows where it came
  from (`team:<name>` vs `direct`).
- Time rates UI moves from project-settings to the team detail page. The
  project's time logs page reads rates from the joined view; no UI for
  editing rates lives under the project anymore.

### Services
- `web/src/services/teams.service.ts` — new, mirrors backend.
- `web/src/services/project.service.ts` — add `attachTeam`, `detachTeam`,
  `updateProjectTeam`. Remove time-rate write methods (read-only path
  remains for displaying rates inside time logs).

### Reuse, don't duplicate
- Permission catalog (`permissionCatalog.ts`) needs no new paths; the
  consultant gate is a profile-level check (`is_consultant_verified`),
  not a project permission.
- `RequireProjectAccess` keeps gating project routes; new
  `RequireConsultantPersona` wrapper for team rate UI.
- `extractApiErrorMessage` handles the new 403s automatically because
  the backend uses `MissingPermissionException`.

## Migration sequence

1. **Migration A** (additive): create `teams`, `team_members`,
   `project_teams`, add `projects.primary_team_id`, install sync
   triggers, run backfill. Old `project_member_time_rates` and
   `projects.consultant_id` still present and read.
2. **Backend deploy**: ship the teams module + updated project endpoints.
   Time-rate writes go to `team_members`; reads union both tables for
   one release (team_members wins on conflict).
3. **Frontend deploy**: ship `/teams` routes + project Teams tab. Old
   per-project rate UI hidden behind a feature flag for one release.
4. **Verification window**: monitor for stragglers in the union read
   path. Fix any backfill misses.
5. **Migration B** (cleanup): drop `project_member_time_rates`, drop
   `projects.consultant_id`, remove union read path.

## Edge case decisions (locked in above, summarized)

| Case | Decision |
| --- | --- |
| Same user via two attached teams | `project_shares` PK = `(project_id, user_id, origin)`; resolver unions |
| Per-row capability overrides | Live on `project_team_members.capabilities`; trigger composes |
| Historical rate semantics | Snapshot rate onto each time-log row at insert |
| Team deletion while attached | `on delete restrict` — must detach first |
| Re-attach memory | Fresh slate; no soft-delete |
| Primary vs contributor default_role | Both default to `editor`; primary flag is identity only |
| Cross-team roster visibility within a project | Visible (names + roles); rates stay team-gated |
| Personal workspace projects | `primary_team_id` stays null forever; all consumers handle null |
| Removing the team owner from team_members | Blocked by trigger; must transfer ownership (out of scope v1) |

## Out of scope

- Team-level chat / channels (chat stays project-scoped).
- Team-level billing rollups across projects — separate feature, depends
  on this refactor.
- Org / workspace concept above teams — not needed yet.
- Team ownership transfer UI/API — owner row protected by trigger; v1
  workaround is delete-and-recreate-team.

## Critical files to modify

- `supabase/migrations/2026_05_07_*_teams.sql` (new) — schema + backfill
- `supabase/migrations/2026_05_*_drop_project_member_time_rates.sql` (new, follow-up)
- `backend/src/modules/teams/` (new module)
- `backend/src/modules/projects/projects.service.ts` — attach/detach team, auto-primary on create
- `backend/src/modules/projects/projects.controller.ts` — new team endpoints
- `backend/src/modules/projects/authorization/project-authorization.service.ts` — origin handling
- `backend/src/modules/project-time/` — read rates from team_members
- `web/src/services/teams.service.ts` (new)
- `web/src/services/project.service.ts` — attach/detach team methods
- `web/src/routes/teams/` (new route tree)
- `web/src/routes/project/$projectId/settings/teams.tsx` (new tab)

## Verification

1. `cd backend && npx supabase db reset` then `npx supabase db push` —
   migration A applies cleanly on a fresh DB.
2. On a staging copy of prod, run the backfill and spot-check 10
   projects: every member who had a row in `project_member_time_rates`
   has the same rate on `team_members`, and every project has a
   `primary_team_id` set.
3. `cd backend && npm test` — all passing including new
   `teams.service.spec.ts` and updated `project-time.service.spec.ts`.
4. `cd web && npm run build` — TS clean.
5. Manual flow:
   - As a consultant: create a team of 5, attach to Project X with all
     members selected → 5 share rows appear with origin `team:<id>`.
   - Attach the same team to Project Y but uncheck 2 members → only 3
     share rows appear on Y; X is unchanged.
   - Add a 6th person to the team → they do NOT appear on X or Y until
     a project admin curates them in. (No-surprise-access verified.)
   - From Project X's Teams tab, remove one member → their share on X
     disappears; their team membership and Y participation untouched.
   - Remove the same person from the team entirely → cascades through
     `project_team_members` and removes them from every project they
     were curated onto.
   - As a client owning a project: open settings, verify rates panel is
     gone; Teams tab shows attached teams; can detach a team and curate
     its members on the project but cannot edit rates.
   - As a non-consultant team owner: rate field hidden in UI; direct API
     write returns 403 with `requiredRole='consultant'`.
   - User has both a direct share (admin) and a team-derived share
     (viewer) on the same project → effective access is admin
     (role-max). Removing the team-derived row leaves the direct share
     intact.
