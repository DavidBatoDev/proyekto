# Platform Foundations — Tasks

## Why this spec exists

Concrete implementation backlog organized by slice. Each task includes its
status, the files it touches, and a one-line acceptance signal so progress
is checkable. Companion to:

- `requirements.md` — *what* and *why*
- `design.md` — *how* (architecture)

Status legend: ✅ shipped · 🟡 in progress · ⬜ pending · ⚠️ blocked

---

## Slice 1 — Lane signup + personal workspace + `/welcome`

**Goal:** Wire the lane signal from homepage CTAs through signup completion.
Auto-provision a personal workspace. Land users on `/welcome` (4-slide
activation) or `/consultant/apply` based on lane. **(Shipped 2026-05-03.)**

### Database

| # | Status | Task | File |
|---|---|---|---|
| 1.1 | ✅ | Relax `profiles.settings` CHECK to require `onboarding.lane` | `supabase/migrations/20260503000010_relax_profiles_settings_check_for_lane.sql` |
| 1.2 | ✅ | Add `projects.is_personal_workspace` + partial unique index | `supabase/migrations/20260503000020_add_personal_workspace_to_projects.sql` |
| 1.3 | ✅ | Add `project_invites.default_role` column | `supabase/migrations/20260503000030_add_default_role_to_project_invites.sql` |
| 1.4 | ⚠️ | **Apply migrations to dev DB** | (CLI auth needed — user handles) |

### Backend

| # | Status | Task | File |
|---|---|---|---|
| 1.5 | ✅ | `PersonalWorkspaceService.provision()` + 5 spec tests | `backend/src/modules/projects/personal-workspace.service.ts` |
| 1.6 | ✅ | Wire service into `ProjectsModule` exports | `backend/src/modules/projects/projects.module.ts` |
| 1.7 | ✅ | Extend `CompleteOnboardingDto` with `lane` | `backend/src/modules/auth/dto/auth.dto.ts` |
| 1.8 | ✅ | `AuthService.completeOnboarding`: lane-aware persona + workspace orchestration; returns `{ profile, personal_workspace_id }` | `backend/src/modules/auth/auth.service.ts` |
| 1.9 | ✅ | `AuthRepository.completeOnboarding`: persist `lane` + conditional `active_persona` write | `backend/src/modules/auth/repositories/auth.repository.supabase.ts` |
| 1.10 | ✅ | `AuthModule` imports `ProjectsModule` for the workspace service | `backend/src/modules/auth/auth.module.ts` |
| 1.11 | ✅ | Extend `InviteProjectByEmailDto` + repository to accept/persist `default_role` | `backend/src/modules/projects/dto/project.dto.ts`, `repositories/projects.repository.supabase.ts` |
| 1.12 | ✅ | 5 auth.service spec tests covering both lanes + workspace orchestration | `backend/src/modules/auth/auth.service.spec.ts` |

### Frontend

| # | Status | Task | File |
|---|---|---|---|
| 1.13 | ✅ | `/auth/signup` `validateSearch` accepts `lane` (alongside `redirect`, `intent`) | `web/src/routes/auth/signup.tsx` |
| 1.14 | ✅ | `auth-api.ts`: `completeOnboarding` requires `lane`, returns `personal_workspace_id`; offline fallback maintains structure parity | `web/src/lib/auth-api.ts` |
| 1.15 | ✅ | `SignupForm` reads/persists lane through wizard, lane-aware post-verify routing | `web/src/components/auth/signup/SignupForm.tsx` |
| 1.16 | ✅ | New `/welcome` route — 4-slide deck (Welcome → Capabilities → Workspace name → Multi-invite) with auth guard, lane-aware redirect, stepper, framer-motion transitions | `web/src/routes/welcome.tsx` |
| 1.17 | ✅ | `/onboarding` retired to redirect-only handler | `web/src/routes/onboarding.tsx` |
| 1.18 | ✅ | `login.tsx` post-auth destination: `/welcome` (or `/consultant/apply` by lane); SELECT now includes `settings` | `web/src/routes/auth/login.tsx` |
| 1.19 | ✅ | `callback.tsx` (OAuth) post-auth destination: `/welcome` or `/consultant/apply` by lane | `web/src/routes/auth/callback.tsx` |
| 1.20 | ✅ | Homepage Hero CTAs pass `lane` + `intent` | `web/src/components/root/HeroSection.tsx` |
| 1.21 | ✅ | Consultant `/consultant` ApplyButton passes `lane=consultant` | `web/src/routes/consultant/index.tsx` |

### UI refinements (signup wizard)

| # | Status | Task | File |
|---|---|---|---|
| 1.22 | ✅ | New `SignupStepLane` component (lane picker) — 2-card chooser with pre-selection | `web/src/components/auth/signup/SignupStepLane.tsx` |
| 1.23 | ✅ | Renumber wizard to 4 steps (Lane → Account → Profile → Verify); add Back button on Account | `SignupForm.tsx`, `SignupStepAccount.tsx` |
| 1.24 | ✅ | Refactor `SignupLayout` to centered-card on full-screen gradient (drop right brand panel) | `web/src/components/auth/signup/SignupLayout.tsx` |
| 1.25 | ✅ | Drop the white card wrapper — form sits directly on the gradient | `SignupForm.tsx` |
| 1.26 | ✅ | Remove StepIndicator UI | `SignupForm.tsx` |
| 1.27 | ✅ | Fix logo `alt="Prodigitality"` → `"Proyekto"` | `SignupForm.tsx` |

### Consultant /welcome deck (added after initial slice 1)

Per the soft-isolation principle, consultants no longer skip /welcome.
They get a 3-slide orientation before the application form.

| # | Status | Task | File |
|---|---|---|---|
| 1.28 | ✅ | Refactor `welcome.tsx` to lane-aware shell that dispatches to one of two decks | `web/src/routes/welcome.tsx` |
| 1.29 | ✅ | Build 3-slide consultant deck (Welcome → "What you're applying for" → "What to expect" → Start application CTA) | `welcome.tsx` |
| 1.30 | ✅ | Generalize `Stepper` to accept `total` prop (4 for C/F, 3 for consultant) | `welcome.tsx` |
| 1.31 | ✅ | Generalize `CloseConfirmModal` to accept lane-specific copy (`title`, `description`, `confirmLabel`) | `welcome.tsx` |
| 1.32 | ✅ | Update `SignupForm` post-verify routing: both lanes go to `/welcome` (no longer skip-direct-to-`/consultant/apply` for consultants) | `SignupForm.tsx` |
| 1.33 | ✅ | Update `login.tsx` post-auth: both lanes go to `/welcome` | `web/src/routes/auth/login.tsx` |
| 1.34 | ✅ | Update `callback.tsx` (OAuth) post-auth: both lanes go to `/welcome` | `web/src/routes/auth/callback.tsx` |
| 1.35 | ✅ | Simplify `/onboarding` redirect — no longer needs lane branching | `web/src/routes/onboarding.tsx` |

### Signup wizard — split account/password into separate steps

Splits the previously combined Account step (name + email + password) into
two: Account (name + email + Google option) → Password (passwords only).
Better progressive disclosure; OAuth users skip the password step entirely
since clicking Google bounces them out of the wizard before reaching it.

Wizard now has **5 steps**: Lane → Account → Password → Profile → Verify.

| # | Status | Task | File |
|---|---|---|---|
| 1.36 | ✅ | Slim `SignupStepAccount`: drop password & confirm fields + validation; keep name/email/Google | `web/src/components/auth/signup/SignupStepAccount.tsx` |
| 1.37 | ✅ | New `SignupStepPassword` component (password + confirm + strength meter + show/hide + back/continue) | `web/src/components/auth/signup/SignupStepPassword.tsx` |
| 1.38 | ✅ | Renumber wizard to 5 steps in `SignupForm`; add `handlePasswordNext`; renumber all `setStep()` calls + step-render guards (`{step === N}`, `{step < 5}`) | `SignupForm.tsx` |

### Verification (slice 1)

⬜ All deferred until migrations are applied. Nine scenarios to walk in dev:

1. C/F lane signup → land on `/welcome` slide 1 (4-slide deck), complete it, end on `/dashboard`. Confirm `active_persona='client'`, lane persisted, workspace + 2 invite rows created.
2. Skip-invite path → 0 invite rows, still lands on `/dashboard`.
3. **Consultant lane signup → land on `/welcome` slide 1 (3-slide deck), complete it, click "Start application" → land on `/consultant/apply`.** Workspace still provisioned in background.
4. **Consultant lane: close-confirm on slide 1 → modal copy is consultant-specific ("Apply later? You can pick up the application anytime…")** with "Open workspace" confirm button.
5. Freelancer secondary CTA → reaches `/welcome` (C/F deck) with `intent.freelancer=true`.
6. Legacy `/onboarding` link → redirects to `/welcome` (lane-aware deck dispatch happens inside).
7. Returning login with `has_completed_onboarding=false` → routes to `/welcome` regardless of lane.
8. Google OAuth callback → routes to `/welcome` (OAuth defaults to client_freelancer since no lane in roundtrip).
9. Idempotency: log out + log back in → workspace count stays at 1.

---

## Slice 2 — Project permissions (`project_shares`) + freelancer eligibility

**Goal:** Replace persona-based project authorization with role-based
`project_shares`. Implement the freelancer-eligibility quality bar. Make
soft isolation real at the API boundary.

### Database

| # | Status | Task | Notes |
|---|---|---|---|
| 2.1 | ⬜ | Migration: extend `share_role` enum with `'admin'` and `'owner'` | Currently has `viewer | commenter | editor` |
| 2.2 | ⬜ | Migration: create `project_shares` table | See `design.md` for full DDL |
| 2.3 | ⬜ | Migration: SQL function `get_user_project_role(uid, project_id)` | Used by RLS + service `assertRole` |
| 2.4 | ⬜ | Migration: RLS policies on `project_shares` (select by user_id or admin+) | |
| 2.5 | ⬜ | Migration: update `projects_select` RLS to use `project_shares EXISTS` | Replaces the legacy `client_id`/`consultant_id` membership check |
| 2.6 | ⬜ | Migration: update `projects_update` RLS to use `get_user_project_role(...) IN ('owner','admin')` | |
| 2.7 | ⬜ | Migration: extend `get_user_roadmap_share_role` SQL helper to also check `project_shares` ownership | So a project owner inherits roadmap access |

### Backend — Authorization

| # | Status | Task |
|---|---|---|
| 2.8 | ⬜ | `ProjectAuthorizationService` with `assertRole(callerId, projectId, minRole)` and `getUserProjectRole(callerId, projectId)` |
| 2.9 | ⬜ | Spec tests: role hierarchy, capability override, last-owner-removal blocked, consultant assignment auto-grants owner, `client_id` change does NOT change role |
| 2.10 | ⬜ | Replace bypass checks at `projects.service.ts:154,182,213,239` (and any others surfaced by deletion) with `assertRole` calls |
| 2.11 | ⬜ | Wire `PersonalWorkspaceService.provision()` to write `project_shares` row (`role=owner, origin=personal_workspace`) instead of the interim `project_members` marker |
| 2.12 | ⬜ | When invite is accepted (`PATCH /projects/.../invites/:id/respond`), create the `project_shares` row from `default_role`; mark invite `accepted` |
| 2.13 | ⬜ | Last-owner protection: service-level guard rejects `DELETE` of a `project_shares` row or downgrade if it would leave the project ownerless |
| 2.14 | ⬜ | Auto-grant rules on consultant assignment / unassignment (replaces the existing `consultant_id` write paths) |

### Backend — Freelancer eligibility

| # | Status | Task |
|---|---|---|
| 2.15 | ⬜ | `FreelancerEligibilityService` with `check(userId)` returning `{ eligible, missing[] }` |
| 2.16 | ⬜ | Spec tests: each missing requirement reflected in `missing[]`; passing all four returns `eligible=true` |
| 2.17 | ⬜ | Profile API includes `missingFreelancerRequirements: string[]` in the response payload |
| 2.18 | ⬜ | `AuthService.switchPersona('freelancer')` rejects with `ForbiddenException('Complete your freelancer profile first')` when not eligible |
| 2.19 | ⬜ | `MarketplaceService.getFreelancers` filters to `eligible=true AND availability !== 'unavailable'` |

### Frontend

| # | Status | Task |
|---|---|---|
| 2.20 | ⬜ | `FreelancerEligibilityChecklist` component (4 items with check/cross icons + links to profile sections) |
| 2.21 | ⬜ | Mount checklist on `/dashboard` sidebar when user is not yet freelancer-eligible |
| 2.22 | ⬜ | `useProfileQuery` exposes `missingFreelancerRequirements` |
| 2.23 | ⬜ | Profile UI (rate settings, portfolio, identity verification, headline/bio/country) actually leads to eligibility flips — verify each form path |

### Verification (slice 2)

⬜ Backend specs all pass.
⬜ RLS regression: as user A with no role, project read returns nothing; as `viewer`, read-only; as `owner`, full mutation works.
⬜ Web walkthrough: new user signs up, opens dashboard, sees eligibility checklist with 4 unchecked items. Fills each → checklist flips green → `switchPersona('freelancer')` succeeds.
⬜ Web walkthrough: client (no consultant verification) hits the freelancer marketplace endpoint → 403.
⬜ Web walkthrough: invite collaborator into personal workspace by email → recipient sees the project with the chosen role; access enforced by `project_shares`.
⬜ Web walkthrough: full project-create → consultant-assign → freelancer-invite flow; consultant outranks client (owner > admin) automatically.

---

## Slice 3 — Marketplace gate + cleanup

**Goal:** Formalize marketplace gating at the API surface. Drop legacy
permission tables. Enforce consultant-verification invariant at the DB.

### Database

| # | Status | Task |
|---|---|---|
| 3.1 | ⬜ | Migration: drop `project_members` table |
| 3.2 | ⬜ | Migration: drop the `permissions_json` column (if not already dropped with the table — depends on FK fan-out) |
| 3.3 | ⬜ | Migration: CHECK constraint `(active_persona <> 'consultant') OR (is_consultant_verified = true)` on `profiles` |

### Backend

| # | Status | Task |
|---|---|---|
| 3.4 | ⬜ | `ConsultantOnlyGuard` — checks `is_consultant_verified` (capability), throws ForbiddenException otherwise |
| 3.5 | ⬜ | Apply `@UseGuards(ConsultantOnlyGuard)` on `MarketplaceController.getFreelancers` (today gated by `ensureConsultant` — making it loud) |
| 3.6 | ⬜ | Fix `marketplace.service.ts:259` invite check: replace `project.consultant_id === userId` with `assertRole('admin')` |
| 3.7 | ⬜ | Delete `backend/src/modules/projects/permissions/project-permissions.ts` and all template-resolver call sites |
| 3.8 | ⬜ | Delete `ProjectMemberRole` enum and any remaining references |
| 3.9 | ⬜ | Update spec tests that relied on `project_members` (e.g. `projects.service.permissions.spec.ts`) — most should delete; a few migrate to `project_shares` semantics |

### Verification (slice 3)

⬜ All backend tests still pass after `project_members` removal.
⬜ Attempting to `UPDATE profiles SET active_persona='consultant'` for an unverified user fails the CHECK constraint.
⬜ Marketplace browse returns 403 for unverified users; 200 for verified consultants regardless of their current `active_persona`.

---

## Slice 4 — Polish

**Goal:** Brand consistency, missing copy, deferred niceties.

| # | Status | Task | File |
|---|---|---|---|
| 4.1 | ⬜ | Logo asset rename: `prodigylogos/` → `proyektologos/`; update all `<img src="/prodigylogos/..."` paths | `web/public/`, ~5 components |
| 4.2 | ⬜ | Replace `TBD` pricing on `/consultant` with real numbers | `web/src/routes/consultant/index.tsx` |
| 4.3 | ⬜ | Tighten signup wizard header copy now that the stepper is gone (current "Turn ideas into structured execution" competes with the lane picker's own header) | `SignupForm.tsx` |
| 4.4 | ⬜ | Personal workspace deletion guard at API layer | `projects.service.ts` |
| 4.5 | ⬜ | Lane-aware homepage hero copy variant (optional A/B) | `HeroSection.tsx` |
| 4.6 | ⬜ | Documentation: write `documentation/PERMISSIONS.md` describing the role hierarchy + capability flags for future maintainers | new file |

---

## Open product questions (block specific tasks)

These need answers before they unblock work. Captured here so they don't
get lost in chat.

| Question | Blocks | Owner |
|---|---|---|
| Consultant seat $/month + take rate % | 4.2 (pricing UI), billing implementation | (you) |
| Email collision policy across lanes (allowed today) | Signup edge-case docs | (you) |
| Account deletion behavior — cascade, reassign, hard-delete | GDPR readiness; affects `project_shares` cascade rules | (you) |
| Lead pipeline mechanics (queue / round-robin / claim) | Consultant retention features past month 6 | (defer 6 mo) |

---

## Cross-cutting tech debt (not blocking the refactor but worth noting)

| Item | Severity | Notes |
|---|---|---|
| Web bundle has a 924 kB main chunk | Low | Code-splitting opportunity; not urgent |
| Logo path `/prodigylogos/` is a misnomer | Low | Captured in 4.1 |
| `roadmap_shares` and `project_shares` will both exist post-slice-2 | Medium | Plan keeps them separate (roadmap-only public links stay on `roadmap_shares`); revisit in 6 months once usage is clear |

---

## Daily-driver commands

```bash
# Backend specs (ran during slice 1 — all 80 pass)
cd backend && npx jest

# Web build (typecheck + vite — ran during slice 1, green)
cd web && npm run build

# Apply migrations (when CLI auth is set up)
cd backend && npx supabase db push

# Reset dev DB and re-apply (destructive — for slice 2 RLS testing)
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
- **When picking up a task**: update status to 🟡 (in progress), start a
  branch.
- **When shipping**: update status to ✅, link the PR in the row if helpful.
- **When a task changes shape**: update the row inline. Don't delete history
  unless the task itself was abandoned (in which case strike it through).
- **When finding a new task**: add it to the appropriate slice with ⬜ status.
  If it's significant enough to need design, link to a follow-up doc.

If the requirements change in a way that invalidates a slice, update
`requirements.md` and `design.md` first, then update task statuses here.
The spec drives the work, not the other way around.
