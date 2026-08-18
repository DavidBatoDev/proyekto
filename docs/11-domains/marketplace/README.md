# Marketplace & Applications

> **Last updated:** 2026-08-18 · **Status:** current

Two related domains that feed Proyekto's managed model: **applications** (how someone
becomes a vetted consultant) and the **marketplace** (how a verified consultant finds
and hires freelancers). The gate between them is consultant verification.

## Applications

A user applies to become a verified consultant; an admin reviews and approves.

- **Application table:** `consultant_applications` (`application_status` = draft \|
  submitted \| under_review \| approved \| rejected).
- **Capability table:** `consultant_profiles` (`pending` \| `verified` \|
  `suspended` \| `revoked`). It is created at approval, not submission.
- **HTTP:** `GET /applications/me`, `POST /applications` (upsert), `POST
  /applications/submit`.
- **Review** happens in the admin console over the full `user_*` identity — see
[Data → identity model](../../07-data-and-db/identity-vetting-model.md) and the
[Admin vetting playbook](../../12-runbooks/README.md).

Any authenticated account may apply — there is no account role and no consultant
signup lane. Approval idempotently provisions the applicant's personal team and
upserts a verified consultant enrollment with the application and reviewing admin.
The admin console can suspend, reinstate, revoke, and re-approve that retained row.

## Marketplace

Active consultants discover and invite public Talent accounts into their projects.

| Endpoint | Guard | Purpose |
| --- | --- | --- |
| `GET /marketplace/freelancers` | `ConsultantOnlyGuard` | Browse the freelancer pool |
| `GET /marketplace/go-live/eligibility` | Supabase | Preflight the server-enforced go-live requirements |
| `POST /marketplace/go-live` | Supabase | Create or resume an active freelancer enrollment |
| `POST /marketplace/pause` | Supabase | Pause marketplace discovery without deleting history |
| `POST /marketplace/invite` | `ConsultantOnlyGuard` | Invite a freelancer to a project |
| `GET/PATCH /marketplace/invites[/me,/:id/respond]` | Supabase | List / respond to invites |

Discovery draws on the profile sub-entities (`user_rate_settings`, `user_stats`,
`user_specializations`, `user_skills`) so consultants can filter by skill, niche,
rate, and availability. Invites reuse `project_invites`.

> **The enrollment gates:** consultant-only routes require
> `consultant_profiles.status='verified'` through the shared predicate. The freelancer
> pool and direct invite precondition require `freelancer_profiles.status='active'`.
> Go-live enforces the same eligibility checklist server-side; pause and resume are
> status transitions, never row deletion. `user_rate_settings` remains the shared
> rate card for both marketplace paths.
> See
> [Talent → discovery and delivery](../talent/discovery-and-delivery.md),
> [Backend → auth & guards](../../03-backend/auth-and-guards.md), and
> [Product → personas](../../01-product/personas.md).

## Category taxonomy and public discovery

A curated, editorial taxonomy backs the marketplace's public category pages: **11
categories and 84 sub-categories**, seeded by migration
(`20260818110000_marketplace_taxonomy.sql` and its seed) and edited only by migration or
`service_role`. There is no user-facing write surface yet — membership is assigned during
vetting.

| Table | Holds |
| --- | --- |
| `marketplace_categories` | Top-level disciplines, ordered by `position` |
| `marketplace_subcategories` | Second level; slug unique **per category**, not globally |
| `consultant_subcategories` | Places a consultant in a sub-category |

| Endpoint | Guard | Purpose |
| --- | --- | --- |
| `GET /marketplace/categories/navigation` | `@Public()` | Whole tree, nested, one round trip |
| `GET /marketplace/categories/:categorySlug` | `@Public()` | Category + its sub-categories |
| `GET /marketplace/categories/:categorySlug/:subcategorySlug` | `@Public()` | Leaf + parent + siblings |
| `GET /consultants/directory` | `@Public()` | Paginated, category-filtered consultants |

> **Membership is not capability.** A `consultant_subcategories` row says nothing about
> whether someone may consult. Public reads are gated by
> `public.is_active_consultant(user_id)`, and the directory filters on
> `consultant_profiles.status = 'verified'` — so suspending a consultant removes them
> from every category page without a membership row being touched. `GET /consultants`
> still returns a bare unpaginated array; the directory is a separate route because
> pagination needs an envelope.

This taxonomy is **distinct from `roadmap_template_categories`** (which classifies
roadmap subjects) and from `user_specializations` (self-declared free-text freelancer
specialities, used for the facets above). Three different axes; see
[Routing & access](../../04-web/routing-and-access.md#three-taxonomies-three-axes--do-not-unify-them).

Most category pages are empty until enrolment fills them in, which is why the empty
state carries the "apply to consult" call to action and a cross-sell into roadmap
templates.

## Related flows

- **Admin matchmaking** — admins can also match candidates to projects
  (`GET /admin/match-candidates`, `POST /admin/match-assign`). See the
  [Admin vetting playbook](../../12-runbooks/README.md).
- **Teams** — hired freelancers land in project teams; see
  [Teams and Time](../teams-and-time/README.md).
- **Position deep dives** — see [Talent](../talent/README.md) and
  [Consultants](../consultants/README.md) for the complete account-to-delivery flows.

## Code locations

- **Backend:** [`backend/src/modules/marketplace/applications/`](../../../backend/src/modules/marketplace/applications/), [`backend/src/modules/marketplace/marketplace/`](../../../backend/src/modules/marketplace/marketplace/), [`backend/src/modules/marketplace/consultants/`](../../../backend/src/modules/marketplace/consultants/), [`backend/src/modules/marketplace/taxonomy/`](../../../backend/src/modules/marketplace/taxonomy/), [`backend/src/modules/shared/admin/`](../../../backend/src/modules/shared/admin/)
- **Web:** `web/src/routes/marketplace/` (a real `/marketplace` URL segment) — `category/`, `consultant/`, `freelancer/`, `finance/`, `talent`, `project-posting` — plus `web/src/components/marketplace/`. `contract/sign/$token` and `freelancer/invites` sit outside it on purpose; see [Routing & access](../../04-web/routing-and-access.md)
