# Platform Foundations — Requirements

## Why this spec exists

This document captures the **product decisions** that shape Proyekto's signup
funnel, persona model, project permissions, and brand positioning. It is the
source of truth when downstream design or implementation choices need to be
revisited. It does NOT describe code structure (see `design.md`) or the work
backlog (see `tasks.md`).

If a future change conflicts with anything here, this document needs to be
updated **first** — not the code.

---

## Product positioning

### Core promise

> **Hire a team, not a stranger.**
>
> Your project, led by a vetted consultant who plans the roadmap, hires the
> freelancers, and runs delivery end-to-end. You stay in the loop — not in the
> weeds.

We sell **delivery**, not access to people. Upwork sells access. Toptal sells
matchmaking. We sell the team and the consultant who runs it.

### Audience-specific framing

| Audience | Primary message | Secondary message |
|---|---|---|
| **Client** (primary) | *"Hire a team, not a stranger."* | *"Plan free; bring in a vetted lead when you're ready."* |
| **Freelancer** (secondary) | *"Get matched to projects with a vetted lead managing the work."* | *"Focus on craft, not chasing scope and invoices."* |
| **Consultant** (recruitment funnel) | *"Run client engagements like a firm. Without the firm."* | *"Bring your network. We handle the workspace, talent bench, escrow, and invoicing."* |

### Brand voice rules

- **Villain word:** *"stranger"* — cheap freelancer platforms put you in the room with strangers; we don't.
- **Avoid on homepage:** "marketplace", "platform" (use only on `/consultant` where supply-side mechanics matter).
- **Outcome words over feature words:** "ship", "deliver", "run", "lead".
- **Confident, not corporate.** Sharp short sentences beat enterprise-speak.
- **Honest about pricing.** Take rate is shown on the homepage, not buried.
- **Brand name is `Proyekto`.** "Prodigy" / `prdigy/` are legacy folder names only — never appear in user-facing copy.

---

## Revenue model

| Stream | Detail |
|---|---|
| Take rate | Percentage on every freelancer payout routed through Proyekto. No fee on consultant's own consulting hours; no fee on flat-fee deliverables billed direct. |
| Consultant subscription | Monthly seat fee per verified consultant. Unlocks the workspace, vetted talent bench, escrow, contracts, invoicing. |

Numeric rates are intentionally `TBD` placeholders in current UI — they
require explicit pricing decisions before the consultant landing page ships
publicly.

## Launch strategy

**Consultant-first.** First 6 months focus on recruiting verified consultants
(supply side). Client side cannot sustain matched-team delivery without
consultant supply. Implication: the `/consultant` landing page is the most
important acquisition surface for this period; the homepage's primary
purpose is converting consultants into applications, not converting clients
into projects.

---

## Persona model

### The four personas

| Persona | Source of truth | Description |
|---|---|---|
| `client` | `profile.active_persona='client'` | Hires teams. Default for users entering via the Client/Freelancer lane. |
| `freelancer` | `profile.active_persona='freelancer'` | Available for project work. Gated behind a quality checklist (see below). |
| `consultant` | `profile.is_consultant_verified=true` AND `profile.active_persona='consultant'` | Runs client engagements. Gated behind admin-reviewed application. |
| `admin` | Row in `admin_profiles` table | Internal staff. Orthogonal to other personas. |

### Soft isolation (locked decision)

Verified consultant is an **additive capability**, not an exclusive identity.
Implications:

- A consultant **can** also act as a client (hire other consultants, buy
  services, run their own personal-workspace projects).
- A consultant **can** still appear as a freelancer on engagements they
  choose to take in that mode.
- Lane upgrade (Client/Freelancer → Consultant) is **additive**: existing
  personas stay; `is_consultant_verified` flips to true on admin approval.
- Marketplace gates check the **capability flag** (`is_consultant_verified`),
  never the active persona. This is intentional — switching active_persona
  must never affect who can browse the freelancer marketplace.

### Why soft isolation

Decided by four product answers:
1. Consultants should be able to act as paying clients — keeps the revenue
   surface open and matches builder reality.
2. Brand framing is "platform power-users," not "elite separate tier."
3. A consultant's own side project lives in their personal workspace and uses
   normal hiring flows — no second account required.
4. Lane upgrade should be non-destructive — discouraging good consultants
   from applying because they'd lose existing client/freelancer access is the
   wrong tradeoff.

### What `active_persona` does

Active persona is a **UI mode** — drives sidebar layout, dashboard greeting,
default marketplace tab. It has **no authorization consequences**. Switching
persona never changes what you can do inside a project or what surfaces
you can access (those are governed by capability flags and project roles).

The only protection on `active_persona` is: you cannot switch to `consultant`
without `is_consultant_verified=true`.

---

## Signup lanes

### Two entry paths

| Lane | Entry point | Post-signup destination | Active persona on completion |
|---|---|---|---|
| Client/Freelancer | Homepage primary CTAs ("I have a project to ship" / "I'm looking for freelance work") | `/welcome` (4-slide activation deck) → `/dashboard` | `client` |
| Consultant | Footer / `/consultant` landing → "Apply to lead on Proyekto" | `/welcome` (3-slide orientation deck) → `/consultant/apply` (5-step application form) | `freelancer` (default; flips to `consultant` on approval) |

### Lane requirements

- Lane is captured at signup and persisted to `profile.settings.onboarding.lane`
  (DB-persisted, source of truth).
- The signup wizard always shows a lane picker as Step 1; URL params from
  homepage CTAs pre-select the right card so the user only has to confirm.
- Lane choice is editable mid-wizard (sessionStorage carries it across
  refreshes).
- The lane decision determines post-verify routing — Client/Freelancer-lane
  users see `/welcome`; consultants skip it and land on the application form.

### Marketplace gating

**Clients never see freelancers directly.** The freelancer marketplace is
visible only to verified consultants (`is_consultant_verified=true`). The
client→consultant→freelancer chain is enforced at the API boundary, not just
in the UI.

This is the **single most important authorization invariant** in the product
and must never regress.

---

## Personal workspace activation

Every signup auto-provisions exactly one **personal workspace project** so
new users can use the product immediately, without waiting for a marketplace
match. This is the activation lever — the equivalent of Linear's
"Your first project is ready."

### Invariants

- **Idempotent provisioning** — `PersonalWorkspaceService.provision(userId)`
  returns the existing workspace if one already exists; re-running on login
  never creates duplicates. Enforced at the DB level via a partial unique
  index.
- **Default title** — `"{first_name}'s Workspace"`; user can rename via the
  `/welcome` slide-3 step.
- **Owner is the user** — the user is the `owner` on `project_shares`
  (interim: `project_members.permissions_json={ is_owner: true }` until
  slice 2 lands).
- **Not deletable** — DELETE on a project where `is_personal_workspace=true`
  is rejected at the API layer. If the row is somehow missing, the next
  login re-provisions.
- **Everyone gets one** — including consultants (per soft isolation).
  Consultants treat their workspace as a side-project sandbox.

---

## Freelancer eligibility

The `freelancer` persona unlocks only when a user completes a four-criteria
quality checklist. Failing any criterion blocks `switchPersona('freelancer')`
with a `ForbiddenException`.

| # | Criterion | Source |
|---|---|---|
| 1 | Identity verification | At least one row in `user_identity_documents` with `is_verified=true`, OR a `user_verifications` row with `type='identity', status='verified'` |
| 2 | Rate settings configured | `user_rate_settings` row with `hourly_rate`, `currency`, and `availability` all non-null |
| 3 | At least 1 portfolio item | `user_portfolios` row count ≥ 1 |
| 4 | Profile basics complete | `profiles.headline`, `profiles.bio`, `profiles.country` all non-null |

### Why a quality bar

Without it, the freelancer pool floods with low-quality/spam accounts and
the marketplace becomes a Toptal-style filtering problem we can't solve at
this stage. The bar prevents that supply-side rot.

### Regression behavior

If a user later deletes their last portfolio item or clears rate settings,
eligibility flips to false. They retain `active_persona='freelancer'` (no
forced demotion), but new marketplace inclusion is blocked until they
restore the missing requirement. Existing engagements are unaffected.

---

## Project permissions (post-refactor)

### The flexible role model

Inside a project, **persona never determines what you can do**. Authorization
is governed entirely by your role on that specific project, stored in
`project_shares`.

| Role | Read | Comment | Edit | Manage members | Manage billing | Delete project |
|---|---|---|---|---|---|---|
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ | (override) | – |
| editor | ✓ | ✓ | ✓ | – | – | – |
| commenter | ✓ | ✓ | – | – | – | – |
| viewer | ✓ | – | – | – | – | – |

Origin metadata on each share row preserves "where did this person come from"
(`'client' | 'consultant' | 'invited' | 'personal_workspace'`) for analytics
without polluting authorization.

### Capability overrides

Roles cover the common case. A small set of **explicit capability flags**
handles the rest via JSONB on each share:

- `can_manage_billing` — separable from admin (e.g. an admin who shouldn't see invoices)
- `can_manage_members` — separable from admin (e.g. read-only HR view)
- `can_export` — controls bulk data export

Defaults derive from role. We add new flags only when a concrete need arises.

### Origin column semantics

`projects.client_id` and `projects.consultant_id` survive the refactor but
become **origin metadata only** — used for analytics ("how many projects
were originated by clients vs consultants"), match attribution, and legacy
queries. They are NEVER used for authorization decisions after slice 2.

---

## Marketplace flow

### The consultant-mediated chain

```
Client posts project → matched with verified consultant →
  consultant scopes/prices → consultant proposes freelancers from bench →
  client approves → work begins under consultant's roof
```

### Hard rules

- A client **cannot** browse freelancers directly. The marketplace surface
  enforces this at the API gate (`@UseGuards(ConsultantOnlyGuard)` checking
  `is_consultant_verified`).
- A consultant **can** invite their existing freelancer relationships to a
  project even if those freelancers aren't actively in the marketplace pool.
- A freelancer's eligibility for the marketplace pool requires the four
  criteria above PLUS active consent (managed via `availability` status on
  `user_rate_settings`).

---

## Success criteria

Hard product invariants. If any of these break in production, treat as a
critical regression.

| # | Invariant |
|---|---|
| 1 | A new user can complete signup and reach a usable workspace in under 3 minutes |
| 2 | A user with `active_persona='consultant'` always has `is_consultant_verified=true` (CHECK constraint enforces this) |
| 3 | Personal workspace count per user is exactly 1 — never 0 (idempotent provisioning), never 2 (partial unique index) |
| 4 | A non-consultant user calling the freelancer marketplace endpoint receives 403 |
| 5 | `switchPersona('freelancer')` rejects when eligibility fails — no silent grants |
| 6 | A consultant assigned to a project automatically outranks the originating client (owner > admin) |
| 7 | Removing the last `owner` from a project is rejected — projects can never become orphaned |
| 8 | Lane choice persists across signup wizard refreshes and OAuth roundtrips |
| 9 | The marketplace freelancer browse endpoint is reachable only by users with `is_consultant_verified=true`, regardless of their current `active_persona` |

---

## Out of scope (explicit non-goals)

- Hard isolation of consultants. Rejected — see "Soft isolation" above.
- Consultant approval auto-revoking client/freelancer personas. Never.
- Multi-tenant organizations / workspaces above the project level. Future.
- Lead pipeline / round-robin assignment for consultants. Wait until supply > demand.
- Replacing the persona enum with a fully-tagged capability system.
  Persona-as-UI-mode is enough; a tag system is over-engineering at this stage.

---

## Open product questions

These will need answers before they unblock specific work — captured here so
the answers don't get lost in chat.

| Question | Blocks |
|---|---|
| Consultant seat $/month + take rate % | `/consultant` landing page polish, billing implementation |
| Email collision policy across lanes (allowed today) | Edge case in signup; requires explicit confirmation |
| Account deletion behavior — cascade, reassign, hard-delete | GDPR readiness |
| Lead pipeline mechanics (queue / round-robin / claim) | Consultant retention features past month 6 |
