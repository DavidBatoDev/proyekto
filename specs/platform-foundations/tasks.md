# Platform Foundations â€” Tasks

## Why this spec exists

Concrete implementation backlog organized by slice. Each task includes its
status, the files it touches, and a one-line acceptance signal so progress
is checkable. Companion to:

- `requirements.md` â€” *what* and *why*
- `design.md` â€” *how* (architecture)

Status legend: âœ… shipped Â· ðŸŸ¡ in progress Â· â¬œ pending Â· âš ï¸ blocked

---

## Slice 1 â€” Lane signup + personal workspace + `/welcome`

**Goal:** Wire the lane signal from homepage CTAs through signup completion.
Auto-provision a personal workspace. Land users on `/welcome` (4-slide
activation) or `/consultant/apply` based on lane. **(Shipped 2026-05-03.)**

### Database

| # | Status | Task | File |
|---|---|---|---|
| 1.1 | âœ… | Relax `profiles.settings` CHECK to require `onboarding.lane` | `supabase/migrations/20260503000010_relax_profiles_settings_check_for_lane.sql` |
| 1.2 | âœ… | Add `projects.is_personal_workspace` + partial unique index | `supabase/migrations/20260503000020_add_personal_workspace_to_projects.sql` |
| 1.3 | âœ… | Add `project_invites.default_role` column | `supabase/migrations/20260503000030_add_default_role_to_project_invites.sql` |
| 1.4 | âœ… | **Apply migrations to dev DB** | Applied via `npx supabase db push` (2026-05-03) |

### Backend

| # | Status | Task | File |
|---|---|---|---|
| 1.5 | âœ… | `PersonalWorkspaceService.provision()` + 5 spec tests | `backend/src/modules/projects/personal-workspace.service.ts` |
| 1.6 | âœ… | Wire service into `ProjectsModule` exports | `backend/src/modules/projects/projects.module.ts` |
| 1.7 | âœ… | Extend `CompleteOnboardingDto` with `lane` | `backend/src/modules/auth/dto/auth.dto.ts` |
| 1.8 | âœ… | `AuthService.completeOnboarding`: lane-aware persona + workspace orchestration; returns `{ profile, personal_workspace_id }` | `backend/src/modules/auth/auth.service.ts` |
| 1.9 | âœ… | `AuthRepository.completeOnboarding`: persist `lane` + conditional `active_persona` write | `backend/src/modules/auth/repositories/auth.repository.supabase.ts` |
| 1.10 | âœ… | `AuthModule` imports `ProjectsModule` for the workspace service | `backend/src/modules/auth/auth.module.ts` |
| 1.11 | âœ… | Extend `InviteProjectByEmailDto` + repository to accept/persist `default_role` | `backend/src/modules/projects/dto/project.dto.ts`, `repositories/projects.repository.supabase.ts` |
| 1.12 | âœ… | 5 auth.service spec tests covering both lanes + workspace orchestration | `backend/src/modules/auth/auth.service.spec.ts` |

### Frontend

| # | Status | Task | File |
|---|---|---|---|
| 1.13 | âœ… | `/auth/signup` `validateSearch` accepts `lane` (alongside `redirect`, `intent`) | `web/src/routes/auth/signup.tsx` |
| 1.14 | âœ… | `auth-api.ts`: `completeOnboarding` requires `lane`, returns `personal_workspace_id`; offline fallback maintains structure parity | `web/src/lib/auth-api.ts` |
| 1.15 | âœ… | `SignupForm` reads/persists lane through wizard, lane-aware post-verify routing | `web/src/components/auth/signup/SignupForm.tsx` |
| 1.16 | âœ… | New `/welcome` route â€” 4-slide deck (Welcome â†’ Capabilities â†’ Workspace name â†’ Multi-invite) with auth guard, lane-aware redirect, stepper, framer-motion transitions | `web/src/routes/welcome.tsx` |
| 1.17 | âœ… | `/onboarding` retired to redirect-only handler | `web/src/routes/onboarding.tsx` |
| 1.18 | âœ… | `login.tsx` post-auth destination: `/welcome` (or `/consultant/apply` by lane); SELECT now includes `settings` | `web/src/routes/auth/login.tsx` |
| 1.19 | âœ… | `callback.tsx` (OAuth) post-auth destination: `/welcome` or `/consultant/apply` by lane | `web/src/routes/auth/callback.tsx` |
| 1.20 | âœ… | Homepage Hero CTAs pass `lane` + `intent` | `web/src/components/root/HeroSection.tsx` |
| 1.21 | âœ… | Consultant `/consultant` ApplyButton passes `lane=consultant` | `web/src/routes/consultant/index.tsx` |

### UI refinements (signup wizard)

| # | Status | Task | File |
|---|---|---|---|
| 1.22 | âœ… | New `SignupStepLane` component (lane picker) â€” 2-card chooser with pre-selection | `web/src/components/auth/signup/SignupStepLane.tsx` |
| 1.23 | âœ… | Renumber wizard to 4 steps (Lane â†’ Account â†’ Profile â†’ Verify); add Back button on Account | `SignupForm.tsx`, `SignupStepAccount.tsx` |
| 1.24 | âœ… | Refactor `SignupLayout` to centered-card on full-screen gradient (drop right brand panel) | `web/src/components/auth/signup/SignupLayout.tsx` |
| 1.25 | âœ… | Drop the white card wrapper â€” form sits directly on the gradient | `SignupForm.tsx` |
| 1.26 | âœ… | Remove StepIndicator UI | `SignupForm.tsx` |
| 1.27 | âœ… | Fix logo `alt="Prodigitality"` â†’ `"Proyekto"` | `SignupForm.tsx` |

### Consultant /welcome deck (added after initial slice 1)

Per the soft-isolation principle, consultants no longer skip /welcome.
They get a 3-slide orientation before the application form.

| # | Status | Task | File |
|---|---|---|---|
| 1.28 | âœ… | Refactor `welcome.tsx` to lane-aware shell that dispatches to one of two decks | `web/src/routes/welcome.tsx` |
| 1.29 | âœ… | Build 3-slide consultant deck (Welcome â†’ "What you're applying for" â†’ "What to expect" â†’ Start application CTA) | `welcome.tsx` |
| 1.30 | âœ… | Generalize `Stepper` to accept `total` prop (4 for C/F, 3 for consultant) | `welcome.tsx` |
| 1.31 | âœ… | Generalize `CloseConfirmModal` to accept lane-specific copy (`title`, `description`, `confirmLabel`) | `welcome.tsx` |
| 1.32 | âœ… | Update `SignupForm` post-verify routing: both lanes go to `/welcome` (no longer skip-direct-to-`/consultant/apply` for consultants) | `SignupForm.tsx` |
| 1.33 | âœ… | Update `login.tsx` post-auth: both lanes go to `/welcome` | `web/src/routes/auth/login.tsx` |
| 1.34 | âœ… | Update `callback.tsx` (OAuth) post-auth: both lanes go to `/welcome` | `web/src/routes/auth/callback.tsx` |
| 1.35 | âœ… | Simplify `/onboarding` redirect â€” no longer needs lane branching | `web/src/routes/onboarding.tsx` |

### Signup wizard â€” split account/password into separate steps

Splits the previously combined Account step (name + email + password) into
two: Account (name + email + Google option) â†’ Password (passwords only).
Better progressive disclosure; OAuth users skip the password step entirely
since clicking Google bounces them out of the wizard before reaching it.

Wizard now has **5 steps**: Lane â†’ Account â†’ Password â†’ Profile â†’ Verify.

| # | Status | Task | File |
|---|---|---|---|
| 1.36 | âœ… | Slim `SignupStepAccount`: drop password & confirm fields + validation; keep name/email/Google | `web/src/components/auth/signup/SignupStepAccount.tsx` |
| 1.37 | âœ… | New `SignupStepPassword` component (password + confirm + strength meter + show/hide + back/continue) | `web/src/components/auth/signup/SignupStepPassword.tsx` |
| 1.38 | âœ… | Renumber wizard to 5 steps in `SignupForm`; add `handlePasswordNext`; renumber all `setStep()` calls + step-render guards (`{step === N}`, `{step < 5}`) | `SignupForm.tsx` |

### Verification (slice 1)

â¬œ All deferred until migrations are applied. Nine scenarios to walk in dev:

1. C/F lane signup â†’ land on `/welcome` slide 1 (4-slide deck), complete it, end on `/dashboard`. Confirm `active_persona='client'`, lane persisted, workspace + 2 invite rows created.
2. Skip-invite path â†’ 0 invite rows, still lands on `/dashboard`.
3. **Consultant lane signup â†’ land on `/welcome` slide 1 (3-slide deck), complete it, click "Start application" â†’ land on `/consultant/apply`.** Workspace still provisioned in background.
4. **Consultant lane: close-confirm on slide 1 â†’ modal copy is consultant-specific ("Apply later? You can pick up the application anytimeâ€¦")** with "Open workspace" confirm button.
5. Freelancer secondary CTA â†’ reaches `/welcome` (C/F deck) with `intent.freelancer=true`.
6. Legacy `/onboarding` link â†’ redirects to `/welcome` (lane-aware deck dispatch happens inside).
7. Returning login with `has_completed_onboarding=false` â†’ routes to `/welcome` regardless of lane.
8. Google OAuth callback â†’ routes to `/welcome` (OAuth defaults to client_freelancer since no lane in roundtrip).
9. Idempotency: log out + log back in â†’ workspace count stays at 1.

---

## Slice 2 â€” Project permissions (`project_shares`) + freelancer eligibility

**Goal:** Replace persona-based project authorization with role-based
`project_shares`. Implement the freelancer-eligibility quality bar. Make
soft isolation real at the API boundary.

### Database

| # | Status | Task | Notes |
|---|---|---|---|
| 2.1 | âœ… | Migration: extend `share_role` enum with `'admin'` and `'owner'` | `supabase/migrations/20260503000040_extend_share_role_enum_for_project_shares.sql` |
| 2.2 | âœ… | Migration: create `project_shares` table | `supabase/migrations/20260503000050_create_project_shares.sql` |
| 2.3 | âœ… | Migration: SQL function `get_user_project_role(uid, project_id)` | Same file as 2.2 |
| 2.4 | âœ… | Migration: RLS policies on `project_shares` (select by user_id or admin+) | Same file as 2.2 |
| 2.5 | âœ… | Migration: update `projects_select` RLS to use `project_shares EXISTS` | `supabase/migrations/20260503000060_projects_rls_via_project_shares.sql` |
| 2.6 | âœ… | Migration: update `projects_update` RLS to use `get_user_project_role(...) IN ('owner','admin')` | Same file as 2.5 |
| 2.7 | ðŸŸ¡ | **Deferred to slice 3.** Original `get_user_roadmap_share_role(p_roadmap_id, p_user_id) RETURNS TEXT` cannot be `CREATE OR REPLACE`d to a different return type. Slice 3 will introduce a new helper with a distinct name and migrate RLS policies in lockstep. | See task 3.10 |

### Backend â€” Authorization

| # | Status | Task |
|---|---|---|
| 2.8 | âœ… | `ProjectAuthorizationService` with `assertRole(callerId, projectId, minRole)` and `getUserProjectRole(callerId, projectId)` (also `grant`, `revoke`, `roleSatisfies`) |
| 2.9 | âœ… | Spec tests: role hierarchy, last-owner-removal blocked, grant upserts, revoke is idempotent on missing rows. **15 tests pass.** |
| 2.10 | âœ… | Replaced 4 bypass checks in `projects.service.ts` with new `isProjectPrivileged()` helper that delegates to `ProjectAuthorizationService.getUserProjectRole`. Updated dependent specs. |
| 2.11 | âœ… | `PersonalWorkspaceService.provision()` now dual-writes â€” keeps the legacy `project_members` row for backward-compat with unmodified RLS on dependent tables, AND writes a `project_shares` row with `role=owner, origin=personal_workspace`. Slice 3 drops the legacy write. |
| 2.12 | âœ… | `ProjectsService.respondInvite` grants the invitee a `project_shares` row from `default_role` when status flips to `accepted`. Defaults to `editor` when `default_role` is null (legacy invites). |
| 2.13 | âœ… | Last-owner protection lives in `ProjectAuthorizationService.revoke` â€” checks owner count before deleting an owner row, throws `ForbiddenException('Cannot remove the last owner from a project')`. |
| 2.14 | âœ… | `assignConsultant` grants new consultant `owner` role. `reassignProjectConsultant` grants new + revokes previous (with last-owner-protection fallback that warns and keeps previous as co-owner if removal would orphan the project). |

### Backend â€” Freelancer eligibility

| # | Status | Task |
|---|---|---|
| 2.15 | âœ… | `FreelancerEligibilityService.check(userId)` returns `{ eligible, missing[] }`. Cheap (4 parallel lookups). |
| 2.16 | âœ… | 9 spec tests covering: all-pass, each-of-4-missing, identity fallback path (verifications row), all-missing combined. |
| 2.17 | âœ… | `AuthService.getProfile` returns `ProfileWithEligibility` shape: `{...profile, missingFreelancerRequirements}`. |
| 2.18 | âœ… | `AuthService.switchPersona('freelancer')` rejects with detailed `ForbiddenException` listing missing requirements. |
| 2.19 | ðŸŸ¡ | Marketplace already filters to `is_public=true AND active_persona='freelancer'`. Combined with switchPersona enforcement, eligibility is implicitly enforced. Explicit availability filter deferred â€” not blocking. |

### Frontend â€” freelancer eligibility

| # | Status | Task |
|---|---|---|
| 2.20 | âœ… | `FreelancerEligibilityChecklist` component â€” 4 items with check icons, line-through on done, per-item CTAs to `/profile`. | `web/src/components/profile/FreelancerEligibilityChecklist.tsx` |
| 2.21 | âœ… | Mounted on `/dashboard` sidebar via 2-col grid layout (`lg:grid-cols-[minmax(0,1fr)_320px]`). | `web/src/routes/dashboard.tsx` |
| 2.22 | âœ… | NEW `useFreelancerEligibility()` hook â€” TanStack Query mirror of the backend service for fast UI feedback. Backend remains source of truth for switchPersona enforcement. | `web/src/hooks/useFreelancerEligibility.ts` |
| 2.23 | â¬œ | Profile UI form-path verification â€” manual walkthrough deferred to user QA. |

### Frontend â€” project page consultant-gate removal

Dropped the "Don't have a consultant yet" lock that previously blocked 8 of 10
project sub-routes regardless of role. Project access is now purely
role-based via `project_shares`.

| # | Status | Task | File |
|---|---|---|---|
| 2.24 | âœ… | Deleted the "Don't have a consultant yet" empty state block (was 95 lines) | `web/src/routes/project/$projectId.tsx` |
| 2.25 | âœ… | The `requiresProject` flag in the sidebar was already correctly checking "real project loaded" (not consultant_id). With the route shell's lock removed, the sidebar now renders all items for any project the user has access to. No change needed. | `web/src/components/project/ProjectSidebar.tsx` |
| 2.26 | ðŸŸ¡ | Sub-route per-page assertRole calls deferred. The route shell + RLS now enforce access; explicit per-page assertRole would be defense-in-depth but not blocking. | (sub-route files) |
| 2.27 | âœ… | NEW `BringInAConsultantCard` â€” shown on Overview only when `is_personal_workspace=false AND consultant_id IS NULL`. Amber-accented, non-blocking. | `web/src/components/project/BringInAConsultantCard.tsx` |
| 2.28 | âœ… | `MarketplaceService.inviteFreelancer` â€” replaced `project.consultant_id === userId` check with `assertRole(userId, projectId, 'admin')`. `MarketplaceModule` imports `ProjectsModule`. | `backend/src/modules/marketplace/marketplace.service.ts` |

### Verification (slice 2)

âœ… **Backend specs all pass â€” 104 / 104** (24 new tests added in slice 2: 15 for ProjectAuthorizationService, 9 for FreelancerEligibilityService).
âœ… **Web build green** (`cd web && npm run build`).
âœ… **Migrations applied** to dev DB via `npx supabase db push` (2026-05-03).
â¬œ RLS regression walkthrough â€” as user A with no role, project read returns nothing; as `viewer`, read-only; as `owner`, full mutation works. *(Pending manual walkthrough on dev DB.)*
â¬œ Web walkthrough: new user signs up, opens dashboard, sees eligibility checklist with 4 unchecked items. Fills each â†’ checklist flips green â†’ `switchPersona('freelancer')` succeeds.
â¬œ Web walkthrough: client (no consultant verification) hits the freelancer marketplace endpoint â†’ 403.
â¬œ Web walkthrough: invite collaborator into personal workspace by email â†’ recipient sees the project with the chosen role; access enforced by `project_shares`.
â¬œ Web walkthrough: full project-create â†’ consultant-assign â†’ freelancer-invite flow; consultant outranks client (owner > admin) automatically.
â¬œ **Personal workspace project page**: every tab (Overview, Team, Chat, Resources, Time, Logs, Settings) is accessible to the owner; "Don't have a consultant yet" empty state is GONE; "Bring in a consultant" card is NOT shown.
â¬œ **Marketplace project pre-match** (just-created, no consultant_id yet): every tab accessible to the client (now `admin` role); "Bring in a consultant" card IS visible on the Overview tab; clicking it opens the marketplace match flow.
â¬œ **Marketplace project post-match** (consultant_id set): "Bring in a consultant" card disappears from Overview; consultant has owner role and can do everything; client retains admin role.
â¬œ **Sidebar visibility**: each nav item appears or hides based on the caller's role (e.g., Settings hidden for `viewer`, visible for `admin`+); no item is hidden purely because consultant_id is null.

---

## Slice 3 â€” Marketplace gate hardening + Phase A cleanup

**Goal (revised):** Formalize marketplace gating at the API surface. Add the
defensive consultant-verification CHECK constraint at the DB. Add the
additive roadmap-effective-role helper. **Dropping the legacy
`project_members` table is split into a new Slice 3b** because there are 14+
read sites across 6 modules (chat, project-time, admin, roadmaps, uploads,
marketplace) that need migration first, plus a FK from
`project_member_time_rates.project_member_id`.

### Database

| # | Status | Task | File |
|---|---|---|---|
| 3.1 | ðŸŸ¡ | Migration: drop `project_members` table â€” **deferred to Slice 3b**. See scope notes below. | (pending) |
| 3.2 | ðŸŸ¡ | Migration: drop the `permissions_json` column â€” **deferred to Slice 3b** (subsumed by 3.1). | (pending) |
| 3.3 | âœ… | Migration: CHECK constraint `(active_persona <> 'consultant') OR (is_consultant_verified = true)` on `profiles` | `supabase/migrations/20260503000080_consultant_persona_requires_verification.sql` |
| 3.10 | âœ… | Additive roadmap helper: NEW `get_user_roadmap_effective_role(uid, roadmap_id) RETURNS share_role` that consults `project_shares` as fallback. The old `get_user_roadmap_share_role` (TEXT-returning) stays untouched â€” RLS policy migration deferred to 3.10b so the policy migrations happen in lockstep with the function swap. | `supabase/migrations/20260503000070_add_roadmap_effective_role_helper.sql` |
| 3.10b | â¬œ | **Future slice**: migrate every RLS policy that calls `get_user_roadmap_share_role(p_roadmap_id, p_user_id)` to call `get_user_roadmap_effective_role(uid, roadmap_id)` instead, then drop the old function. |

### Backend

| # | Status | Task | File |
|---|---|---|---|
| 3.4 | âœ… | `ConsultantOnlyGuard` â€” checks `is_consultant_verified` (capability), throws ForbiddenException otherwise | `backend/src/common/guards/consultant-only.guard.ts` |
| 3.5 | âœ… | Apply `@UseGuards(ConsultantOnlyGuard)` on `MarketplaceController.getFreelancers` AND `inviteFreelancer`. Service-layer `ensureConsultant` becomes belt-and-suspenders. | `backend/src/modules/marketplace/marketplace.controller.ts` |
| 3.6 | âœ… | **Done in slice 2.** Marketplace invite check now uses `assertRole('admin')`. |
| 3.7 | ðŸŸ¡ | Delete `project-permissions.ts` and its template-resolver call sites â€” **deferred to Slice 3b**. ProjectsService still uses `getCallerPermissions` and `hasPermission` from this file as the legacy fine-grained permission fallback when a user lacks owner/admin role. Slice 3b removes both the legacy table AND this fallback together. |
| 3.8 | ðŸŸ¡ | Delete `ProjectMemberRole` enum â€” **deferred to Slice 3b** (used by member CRUD endpoints that still write project_members). |
| 3.9 | ðŸŸ¡ | Update spec tests that relied on `project_members` â€” **deferred to Slice 3b** alongside the table drop. |

### Verification (slice 3)

âœ… **Backend specs all pass â€” 104 / 104** (no regressions from slice 3 work).
âœ… **Migrations applied** (`get_user_roadmap_effective_role`, consultant-verification CHECK).
â¬œ Attempting to `UPDATE profiles SET active_persona='consultant'` for an unverified user fails the CHECK constraint. *(Pending manual walkthrough on dev DB.)*
â¬œ Marketplace browse returns 403 for unverified users; 200 for verified consultants regardless of their current `active_persona`.

---

## Slice 3b â€” `project_members` table drop (split out from Slice 3)

**Goal:** Drop the legacy `project_members` table and `permissions_json` column.
After slice 2 these are no longer authoritative for permissions, but they're
still read in 14+ sites across 6 modules for membership rosters.

### Scope discovered (Slice 3 assessment)

| Module | File | Refs | Usage |
|---|---|---|---|
| projects | `repositories/projects.repository.supabase.ts` | 22 | Member CRUD (addMember, updateMember, getMembers, removeMember, etc.) â€” most invasive |
| projects | `personal-workspace.service.ts` | 4 | Dual-write owner row alongside project_shares â€” drop in 3b |
| chat | `repositories/chat.repository.supabase.ts` | 4 | "Is user a project member?" lookups for chat permissions |
| project-time | `repositories/project-time.repository.supabase.ts` | 3 | `project_member_time_rates.project_member_id` FK joins |
| admin | `repositories/admin.repository.supabase.ts` | 3 | Admin dashboard counts |
| roadmaps | `repositories/roadmaps.repository.supabase.ts` | 2 | Roadmap access via project membership |
| uploads | `uploads.controller.ts` | 1 | Upload permission check |
| marketplace | `marketplace.service.ts` | 1 | Member lookup |

### Tasks (3b)

| # | Status | Task |
|---|---|---|
| 3b.1 | â¬œ | Migrate each read site to `project_shares EXISTS` (cleanest semantic equivalent for "is user a project member?") |
| 3b.2 | â¬œ | Migrate `project_member_time_rates.project_member_id` FK to either `user_id` directly or to `project_shares.id` â€” needs a small migration |
| 3b.3 | â¬œ | Migrate or remove the projects controller member CRUD endpoints (addMember, updateMember, removeMember). Most can be replaced by `project_shares` grants/revokes. |
| 3b.4 | â¬œ | Stop dual-write in `PersonalWorkspaceService.attachOwnerMember` and `projects.repository.create()` |
| 3b.5 | â¬œ | Delete `project-permissions.ts` template module + `ProjectMemberRole` enum |
| 3b.6 | â¬œ | Update specs â€” most member-permission specs delete; a few migrate to project_shares semantics |
| 3b.7 | â¬œ | Migration: drop `project_members` table (cascades to its FK) |

---

## Slice 4 â€” Polish

**Goal:** Brand consistency, missing copy, deferred niceties.

| # | Status | Task | File |
|---|---|---|---|
| 4.1 | ⬜ | Logo asset path normalization: move assets to `proyektologos/`; update all `<img src="/proyektologos/..."` paths | `web/public/`, ~5 components |
| 4.2 | â¬œ | Replace `TBD` pricing on `/consultant` with real numbers | `web/src/routes/consultant/index.tsx` |
| 4.3 | â¬œ | Tighten signup wizard header copy now that the stepper is gone (current "Turn ideas into structured execution" competes with the lane picker's own header) | `SignupForm.tsx` |
| 4.4 | â¬œ | Personal workspace deletion guard at API layer | `projects.service.ts` |
| 4.5 | â¬œ | Lane-aware homepage hero copy variant (optional A/B) | `HeroSection.tsx` |
| 4.6 | â¬œ | Documentation: write `documentation/PERMISSIONS.md` describing the role hierarchy + capability flags for future maintainers | new file |

---

## Open product questions (block specific tasks)

These need answers before they unblock work. Captured here so they don't
get lost in chat.

| Question | Blocks | Owner |
|---|---|---|
| Consultant seat $/month + take rate % | 4.2 (pricing UI), billing implementation | (you) |
| Email collision policy across lanes (allowed today) | Signup edge-case docs | (you) |
| Account deletion behavior â€” cascade, reassign, hard-delete | GDPR readiness; affects `project_shares` cascade rules | (you) |
| Lead pipeline mechanics (queue / round-robin / claim) | Consultant retention features past month 6 | (defer 6 mo) |

---

## Cross-cutting tech debt (not blocking the refactor but worth noting)

| Item | Severity | Notes |
|---|---|---|
| Web bundle has a 924 kB main chunk | Low | Code-splitting opportunity; not urgent |
| Logo asset path naming consistency cleanup | Low | Captured in 4.1 |
| `roadmap_shares` and `project_shares` will both exist post-slice-2 | Medium | Plan keeps them separate (roadmap-only public links stay on `roadmap_shares`); revisit in 6 months once usage is clear |

---

## Daily-driver commands

```bash
# Backend specs (ran during slice 1 â€” all 80 pass)
cd backend && npx jest

# Web build (typecheck + vite â€” ran during slice 1, green)
cd web && npm run build

# Apply migrations (when CLI auth is set up)
cd backend && npx supabase db push

# Reset dev DB and re-apply (destructive â€” for slice 2 RLS testing)
cd backend && npx supabase db reset

# Web dev server
cd web && npm run dev   # port 3000

# Backend dev server
cd backend && npm run dev   # port 8000
```

---

## How to use this file

- **Before starting a task**: confirm the slice is current; check for blocked
  upstream tasks.
- **When picking up a task**: update status to ðŸŸ¡ (in progress), start a
  branch.
- **When shipping**: update status to âœ…, link the PR in the row if helpful.
- **When a task changes shape**: update the row inline. Don't delete history
  unless the task itself was abandoned (in which case strike it through).
- **When finding a new task**: add it to the appropriate slice with â¬œ status.
  If it's significant enough to need design, link to a follow-up doc.

If the requirements change in a way that invalidates a slice, update
`requirements.md` and `design.md` first, then update task statuses here.
The spec drives the work, not the other way around.



