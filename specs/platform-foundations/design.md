# Platform Foundations — Design

## Why this spec exists

Concrete architecture and code structure for the Platform Foundations
refactor. Companion to:

- `requirements.md` — *what* we're building and *why*
- `tasks.md` — the implementation backlog

Code paths cited here may be in either "shipped" or "planned" state — see
`tasks.md` for status. Where two designs are in flight (e.g., legacy
`project_members` + new `project_shares` co-existing during slice 2), this
doc describes the **target** state with notes on what's interim.

---

## High-level architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          web (React)                             │
│                                                                  │
│  Homepage (/)               /consultant (landing)                │
│       ↓                            ↓                             │
│  /auth/signup ←──── lane=client_freelancer | consultant ────→    │
│       ↓ (4-step wizard: Lane → Account → Profile → Verify)       │
│       ↓                                                          │
│   email verify                                                   │
│       ↓                                                          │
│   completeOnboarding() → backend writes lane + persona +         │
│                          provisions personal workspace            │
│       ↓                                                          │
│   ┌───────────────────────────────────┐                          │
│   │ lane === 'consultant'?            │                          │
│   ├──→ /consultant/apply (5-step)     │                          │
│   └──→ /welcome (4-slide deck)        │                          │
│              ↓                                                   │
│         /dashboard                                               │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                       backend (NestJS)                           │
│                                                                  │
│  AuthModule ←─ imports ─→ ProjectsModule                         │
│      │                          │                                │
│   AuthService              PersonalWorkspaceService              │
│      ↓                          ↓                                │
│   AuthRepository           projects table                        │
│      ↓                     project_members → project_shares      │
│   profiles table              (slice 2 migration)                │
│                                                                  │
│  All endpoints use SupabaseAuthGuard for JWT verification.       │
│  Marketplace surfaces additionally use ConsultantOnlyGuard       │
│  (capability-based, checks is_consultant_verified).              │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                       Supabase (PostgreSQL)                      │
│                                                                  │
│  RLS policies enforce row-level access. Service-layer guards     │
│  in the backend mirror these so unauthorized requests fail at    │
│  the API boundary before hitting the DB.                         │
│                                                                  │
│  Authoritative for: profiles, projects, project_shares,          │
│  project_invites, consultant_applications, roadmap_*,            │
│  user_*, etc.                                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Persona & capability data model

### Storage

| Field | Table | Type | Purpose |
|---|---|---|---|
| `active_persona` | `profiles` | enum (`client | freelancer | consultant | admin`) | UI mode / dashboard routing only |
| `is_consultant_verified` | `profiles` | boolean | **Capability flag.** Source of truth for marketplace gates and the consultant surface |
| `settings.onboarding.lane` | `profiles.settings` JSONB | `'client_freelancer' | 'consultant'` | Recorded once at signup completion; drives post-auth routing |
| `settings.onboarding.intent` | `profiles.settings` JSONB | `{ client: bool, freelancer: bool }` | What the user said they wanted — used for analytics, default tab selection |
| `settings.onboarding.completed_at` | `profiles.settings` JSONB | ISO timestamp | Marker; used by `has_completed_onboarding` flag |
| `has_completed_onboarding` | `profiles` | boolean | Routing helper — `true` skips `/welcome` on subsequent logins |
| Row in `admin_profiles` | `admin_profiles` | row exists / doesn't | Independent admin capability — orthogonal to persona |
| Row in `consultant_applications` | `consultant_applications` | status state machine | Application workflow; `approved` row is what triggers `is_consultant_verified=true` |

### Why `active_persona` and `is_consultant_verified` are separate

`active_persona` is **mutable UI state**. The user can flip between
`client`, `freelancer`, and (if verified) `consultant` to change which
dashboard layout they see.

`is_consultant_verified` is an **immutable-ish capability**. It only flips
on admin approval and represents trust. Marketplace gates check this
because they're protecting a real-world quality bar — switching UI mode
should never affect what the system trusts about you.

### CHECK constraint enforcement

```sql
-- Defensive: cannot have active_persona='consultant' without verification.
ALTER TABLE profiles ADD CONSTRAINT consultant_persona_requires_verification
  CHECK (active_persona <> 'consultant' OR is_consultant_verified = true);
```

(Planned — slice 3.)

---

## Lane signup data flow

### Sequence

1. User clicks a homepage CTA. URL carries `?lane=client_freelancer&intent=client`
   or similar. Consultant CTA goes to `/consultant` first, then its
   ApplyButton sends `?lane=consultant&redirect=/consultant/apply`.
2. `/auth/signup` route's `validateSearch` strips invalid values and
   passes `{ redirect, intent, lane }` to `SignupForm`.
3. `SignupForm` resolves the lane: URL param → sessionStorage → default
   (`client_freelancer`). Persists to sessionStorage so multi-step refreshes
   don't lose it.
4. Step 1: lane picker (always shown). User can change the pre-selected
   card. The pick is re-persisted to sessionStorage on click.
5. Steps 2-4: account info, profile info, email verify. Standard wizard.
6. On verify success:
   - `signInWithPassword` to establish auth
   - Update `profile.is_email_verified = true`
   - Sync auth store (user, session, isAuthenticated=true)
   - Call `completeOnboarding({ lane, intent })`
7. Backend `AuthService.completeOnboarding`:
   - Persists `settings.onboarding.{lane, intent, completed_at}` and
     `has_completed_onboarding=true`
   - For C/F lane: sets `active_persona='client'`. For consultant lane:
     leaves `active_persona='freelancer'` (default; consultant unlocks on
     application approval)
   - Calls `PersonalWorkspaceService.provision(userId)` — idempotent
   - Returns `{ profile, personal_workspace_id }`
8. Frontend routes both lanes to `/welcome`:
   - `/welcome` reads `profile.settings.onboarding.lane` and dispatches to
     the correct deck (4-slide for client_freelancer, 3-slide for consultant)
   - The consultant deck ends with a "Start application" CTA that routes to
     `/consultant/apply`

### Why lane lives in `profile.settings.onboarding.lane` (not a top-level column)

It's a one-time piece of metadata that drives one decision point (post-auth
routing). It doesn't need its own column or index. Living in the existing
JSONB keeps the migration footprint small. The CHECK constraint on
`profiles.settings` validates its presence and shape.

### Why we still allow lane editing in Step 1

Even though the homepage CTA pre-selects, users may have arrived at
`/auth/signup` directly (typing the URL, an old bookmark, a referral link).
Forcing them through a hidden default is worse UX than asking once.

---

## /welcome activation deck

### Scope

Shown to **both lanes**, with lane-specific content. The route reads
`profile.settings.onboarding.lane` and renders one of two decks. They share
the same shell (background, stepper, close-confirm modal, motion variants)
but never share slide content.

### Client/Freelancer lane — 4-slide structure

| # | Slide | State action |
|---|---|---|
| 1 | Welcome with first-name greeting | None |
| 2 | "What you can do" — 3 capabilities (AI planning · vetted consultants · one workspace) | None |
| 3 | Workspace name (editable, default `{first_name}'s Workspace`) | `PATCH /projects/:id` if changed |
| 4 | Multi-invite (email + Editor/Viewer role per row, "+ Add another") | `POST /projects/:id/invites` per valid row |

UX guarantees:
- Stepper bar at top (1 of 4 / 2 of 4 / etc.)
- Back button on slides 2-4; close-with-confirm on slide 1
- Workspace ID needed for slides 3-4 — fetched on mount via direct Supabase
  query against `projects` filtered by `is_personal_workspace=true AND client_id=user.id`
- "Skip for now" on slide 4 routes straight to `/dashboard` — invites are
  optional
- Per-row invite failures show inline; don't block finishing
- Footer link: *"Considering becoming a consultant? Apply to lead →"* → `/consultant`

### Consultant lane — 3-slide structure

| # | Slide | State action |
|---|---|---|
| 1 | Welcome with first-name greeting (Crown icon, amber accent) | None |
| 2 | "What you're applying for" — 3 benefits (workspace + AI · vetted talent bench · escrow & invoicing) | None |
| 3 | "What to expect" — 3 expectations (5 steps / 15 min · human review within 5 days · save & resume) + "Start application" CTA | Routes to `/consultant/apply` |

UX guarantees:
- Stepper bar at top (1 of 3 / 2 of 3 / etc.)
- Back button on slides 2-3; close-with-confirm on slide 1
- Close-confirm copy is consultant-specific: *"Apply later? You can pick up
  the application anytime from your dashboard."*
- Footer link: *"Want to use Proyekto as a client first? Open my workspace →"*
  (consultants have a workspace too per soft isolation)
- Slide 3's "Start application" navigates to `/consultant/apply` — the
  existing 5-step application form is unchanged

---

## Personal workspace

### Schema

```sql
ALTER TABLE projects
  ADD COLUMN is_personal_workspace boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX one_personal_workspace_per_user
  ON projects (client_id)
  WHERE is_personal_workspace = true;
```

The partial unique index is the **enforcement primitive** — service code
relies on it to make `provision()` naively idempotent.

### Service contract

[`PersonalWorkspaceService.provision(userId)`](backend/src/modules/projects/personal-workspace.service.ts)
returns the existing workspace if one is present (looked up by the partial
unique index) or creates one. On race (two concurrent calls), the loser
catches `23505` (unique violation), re-fetches, and returns the survivor.

The owner role is currently written as a `project_members` row with
`permissions_json={ is_owner: true }` as an interim marker. After slice 2,
this becomes a `project_shares` row with `role='owner', origin='personal_workspace'`.

### Title default

`{first_name}'s Workspace`, falling back to `display_name`, then `My`.
Editable by the user on `/welcome` slide 3.

### Deletion guard

`DELETE /projects/:id` is rejected when `is_personal_workspace=true`. If a
row goes missing for any reason, the next `completeOnboarding` (or any
explicit `provision()` call) recreates it.

---

## Project authorization model (target state)

### `project_shares` table

```sql
CREATE TABLE project_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role share_role NOT NULL,  -- owner | admin | editor | commenter | viewer
  origin text,                -- 'client' | 'consultant' | 'invited' | 'personal_workspace'
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_by uuid REFERENCES profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

-- Extends the existing share_role enum from the roadmap_shares migration
ALTER TYPE share_role ADD VALUE 'admin' BEFORE 'editor';
ALTER TYPE share_role ADD VALUE 'owner' BEFORE 'admin';
```

### Role hierarchy

```
owner > admin > editor > commenter > viewer
```

| Role | Read | Comment | Edit | Manage members | Manage billing | Delete project |
|---|---|---|---|---|---|---|
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ | (override) | – |
| editor | ✓ | ✓ | ✓ | – | – | – |
| commenter | ✓ | ✓ | – | – | – | – |
| viewer | ✓ | – | – | – | – | – |

### Capability JSONB

Small set of explicit overrides, used only when the role default is wrong:

| Flag | Default behavior | Override use case |
|---|---|---|
| `can_manage_billing` | `true` for owner only | Demote billing access from a specific admin |
| `can_manage_members` | `true` for owner+admin | Read-only HR view that shouldn't grant new access |
| `can_export` | `true` for editor+ | Restrict export for sensitive data tiers |

We add new flags **only when a concrete need arises**. Resist preemptive
flag proliferation — the role hierarchy covers ~95% of cases.

### `assertRole(callerId, projectId, minRole)`

Single TypeScript helper that wraps a SQL function:

```sql
CREATE FUNCTION get_user_project_role(uid uuid, project_id uuid)
RETURNS share_role AS $$
  SELECT role FROM project_shares
  WHERE project_id = $2 AND user_id = $1
  LIMIT 1
$$ LANGUAGE sql STABLE;
```

```typescript
// All project-mutating endpoints become:
await this.projectAuthorizationService.assertRole(
  callerId,
  projectId,
  'editor',  // minimum role required
);
```

The helper throws `ForbiddenException` if the caller has a lower role or no
share row at all. **All hardcoded `callerId === client_id || callerId === consultant_id`
short-circuits in [projects.service.ts:154,182,213,239](backend/src/modules/projects/projects.service.ts#L154)
are removed and replaced with `assertRole`.**

### Origin metadata

`projects.client_id` and `projects.consultant_id` survive but become
**non-authorization** columns:

- Used for: marketplace match attribution, analytics dashboards, legacy
  queries that haven't been migrated to use `project_shares`.
- NOT used for: any authorization decision. Period.

The columns are NOT renamed (would touch too many call sites). A docstring
on each column documents the new semantics.

### Auto-grant rules on project creation

| Event | Result in `project_shares` |
|---|---|
| User signs up (any lane) | One row for the personal workspace: `role=owner, origin=personal_workspace` |
| Client posts marketplace project | Client gets `role=admin, origin=client` |
| Consultant matched to marketplace project | Consultant gets `role=owner, origin=consultant` (outranks the existing client admin automatically since owner > admin) |
| Freelancer accepts an invite | Row created from `project_invites.default_role` (`editor` or `viewer`); `origin=invited` |
| Consultant unassigned from project | Their row is deleted; the client's `admin` becomes effective (project never goes ownerless because the client always retains `admin`) |

### RLS

```sql
-- project_shares: row visible to its user_id and to anyone with admin+ on the project
CREATE POLICY shares_select ON project_shares FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM project_shares ps
    WHERE ps.project_id = project_shares.project_id
      AND ps.user_id = auth.uid()
      AND ps.role IN ('owner', 'admin')
  )
);

-- projects_select: user must have any role on the project
CREATE POLICY projects_select ON projects FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM project_shares
    WHERE project_id = projects.id AND user_id = auth.uid()
  )
);

-- projects_update: caller must be owner or admin
CREATE POLICY projects_update ON projects FOR UPDATE USING (
  get_user_project_role(auth.uid(), projects.id) IN ('owner', 'admin')
);
```

Backend service-layer `assertRole` guards mirror these so unauthorized
requests fail at the API boundary, not at the DB. RLS is the safety net.

### Last-owner protection

Service-level (or DB trigger) guard: cannot DELETE a `project_shares` row
or downgrade a `role='owner'` to a lesser role if it would leave the
project with zero owners. Returns `ForbiddenException('Project must have at least one owner')`.

---

## Freelancer eligibility

### Service contract

```typescript
class FreelancerEligibilityService {
  async check(userId: string): Promise<{
    eligible: boolean;
    missing: Array<'identity' | 'rate_settings' | 'portfolio' | 'profile_basics'>;
  }>;
}
```

### Wired into

- `AuthService.switchPersona('freelancer')` — rejects with `ForbiddenException`
  when `eligible === false`
- Profile API response — includes `missingFreelancerRequirements: string[]`
  so the dashboard sidebar can render a checklist
- `MarketplaceService.getFreelancers` — only includes profiles where
  `eligible === true` AND `availability !== 'unavailable'`

### Performance

The eligibility check requires 4 quick lookups (or one composed JSON
aggregation query). It runs:
- Once per `switchPersona` call (cheap, infrequent)
- Once per profile fetch when serializing for the sidebar (cached per request)
- As part of the marketplace search query (composed into the WHERE clause)

No standalone caching layer in slice 2. If the marketplace search becomes
hot enough, materialize `freelancer_eligible` as a column with a trigger.

---

## Marketplace gating

### The `ConsultantOnlyGuard`

```typescript
@Injectable()
export class ConsultantOnlyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId = /* extract from request */;
    const profile = await this.authRepo.getProfile(userId);
    if (!profile?.is_consultant_verified) {
      throw new ForbiddenException(
        'Consultant verification required to access this resource',
      );
    }
    return true;
  }
}
```

Applied via `@UseGuards(ConsultantOnlyGuard)` decorator on:

- `MarketplaceController.getFreelancers`
- `MarketplaceController.inviteFreelancer` (in addition to `assertRole('admin')` on the project)
- Any other consultant-only surface

### Why capability-based and not persona-based

A user might have `is_consultant_verified=true` but currently be using
`active_persona='client'` (e.g., they're researching a project they want to
hire someone for). They should still be able to access the freelancer
marketplace — verification is the trust signal, persona is just UI mode.

This is the single most important consequence of the soft-isolation
decision and must be preserved.

---

## Migration sequence (high-level)

Slice ordering minimizes broken-state windows:

1. **Slice 1** (✅ shipped) — Lane plumbing, personal workspace provisioning,
   `/welcome`. Uses interim `project_members` rows for owner marker.
2. **Slice 2** — `project_shares` table + `ProjectAuthorizationService`.
   Replace bypass checks behind a feature flag. `project_members` keeps
   getting written (dual-write window) so rollback is safe.
3. **Slice 3** — Drop `project_members` and `permissions_json`. Delete
   `project-permissions.ts` template system. Add CHECK constraint for
   consultant verification invariant.
4. **Slice 4** — Polish: logo asset rename, real pricing numbers, copy
   tightening.

Detailed task breakdown lives in `tasks.md`.

---

## Project page UX (post-refactor)

### What goes away

- **The "Don't have a consultant yet" empty state** at
  [web/src/routes/project/$projectId.tsx:66–160](web/src/routes/project/$projectId.tsx) — deleted.
- **The `requiresProject` flag** in
  [web/src/components/project/ProjectSidebar.tsx:104–179](web/src/components/project/ProjectSidebar.tsx) —
  removed. Sidebar nav items render based on the caller's `project_shares.role`,
  not on whether a consultant is assigned.
- **Any backend route guard that 403s when `consultant_id` is null** — replaced
  with `assertRole(...)` against `project_shares`.

### What stays

- **`MarketplaceController.getFreelancers`** keeps `ConsultantOnlyGuard` /
  `ensureConsultant` — checks `is_consultant_verified` capability flag, not
  the project's `consultant_id`. Different gate, correct gate.
- **`MarketplaceService.inviteFreelancer`** — refactored from
  `consultant_id === userId` to `assertRole(userId, projectId, 'admin')`, so
  any project admin can invite. The caller still must have the consultant
  capability to *find* freelancers in the bench (separate concern).

### What changes for the user

| Project type | Today | After refactor |
|---|---|---|
| Personal workspace | 8 of 10 tabs locked; no usable activation surface | Full access to all tabs; no consultant CTA shown |
| Marketplace project (pre-match, `consultant_id=null`) | 8 of 10 tabs locked; user hits the wall the moment they create a project | Full access to all tabs; Overview surfaces a "Bring in a consultant" card as a non-blocking next-step prompt |
| Marketplace project (matched, `consultant_id` set) | All tabs available; consultant has owner via `consultant_id === userId` short-circuit | Unchanged surface area; consultant has `owner` role via `project_shares` instead of the column check |

### "Bring in a consultant" card

Rendered on the project Overview tab when:
- `project.is_personal_workspace === false`
- `project.consultant_id === null`

Otherwise hidden. Personal workspaces never show it. Once a consultant is
assigned (the consultant accepts a marketplace match), the card disappears.

The card shows: a short headline ("Ready to bring in a vetted lead?"), a
one-line value prop, and a CTA that opens the marketplace match flow. It's
visually distinct from the rest of the Overview content (subtle border,
amber accent matching the consultant brand color) but doesn't block scrolling.

### Authorization shape (pseudocode)

```typescript
// All project sub-route guards become a one-liner:
await this.projectAuthorizationService.assertRole(callerId, projectId, 'editor');

// "Member of project" = any role grant. "Can edit" = editor+. "Can manage" = admin+.
// Consultant assignment grants 'owner' automatically (see auto-grant rules above)
// but is no longer a prerequisite for any feature.
```

---

## Decision log (append-only)

When a foundational decision changes, add a row here. Don't delete past
entries — the reasoning matters when revisiting.

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-03 | Soft isolation for consultants (additive capability flag, not exclusive identity) | 4 product answers all favored flexibility; hard isolation makes lane upgrade destructive and forces consultant-as-client edge cases |
| 2026-05-03 | Personal workspace for **everyone** (incl. consultants) | Consistent with soft isolation; consultants treat workspace as side-project sandbox |
| 2026-05-03 | Generalize `roadmap_shares` model to `project_shares` (vs full IAM) | 5 resource types only; full IAM is over-engineering and hurts RLS performance |
| 2026-05-03 | `client_id`/`consultant_id` keep their names but become origin-only | Renaming touches too many queries; docstring is sufficient |
| 2026-05-03 | Default invite role: editor, configurable per invite | Most projects want collaborators to actually edit; commenter is too restrictive as default |
| 2026-05-03 | Consultant-first launch | Supply side is the bottleneck for the first 6 months |
| 2026-05-03 | Brand: "Hire a team, not a stranger" + Option C (consultant funnel) | Matches the architecture; consultant-mediated chain is the unique mechanic |
| 2026-05-03 | Keep "Consultant" in user-facing copy (vs Lead/Captain/Operator) | Heavier word, fits the "vetted experts" positioning; same DB role across funnels |
| 2026-05-03 | Lane stored at `profile.settings.onboarding.lane` (not a top-level column) | Single use case (post-auth routing), CHECK constraint validates shape |
| 2026-05-03 | Lane picker always shown as Step 1 of signup wizard | Direct visitors and homepage-CTA visitors both see it; pre-selection from URL minimizes friction |
| 2026-05-03 | Stepper UI removed from signup wizard | Cleaner aesthetic with the new full-screen card-less layout; back/next nav is self-evident |
| 2026-05-03 | Consultants get a `/welcome` deck before `/consultant/apply` (3 slides: welcome, what you're applying for, what to expect) | Original design had consultants skip /welcome — but the application form is 5 steps and high-friction. A brief orientation that recaps benefits + sets timeline expectations reduces drop-off and matches the "set expectations honestly" brand voice. Both lanes now share the `/welcome` route via a lane-aware shell. |
| 2026-05-03 | Signup wizard split into 5 steps (Lane → Account → Password → Profile → Verify) | Account step previously bundled name + email + password — too much per step and forced password decisions before the user committed. Splitting lets the user lock in identity first; Google OAuth users skip the Password step entirely since clicking Google exits the wizard. Better progressive disclosure. |
| 2026-05-03 | Drop the "consultant required" gate from the project page entirely | Discovered the project page locks 8 of 10 sub-routes behind `consultant_id` being set, and personal workspaces hit the same wall. Three foundational decisions all said this should not exist: soft isolation (consultants are additive), personal workspace activation (full access on day 1), IAM permissions (role-based, not consultant-presence-based). Replacement: every feature gated by `assertRole(editor)` or stronger via project_shares. The marketplace freelancer browse remains capability-gated (`is_consultant_verified`) — that is a different and correct gate. Marketplace projects without a consultant get a non-blocking "Bring in a consultant" card on Overview. |
