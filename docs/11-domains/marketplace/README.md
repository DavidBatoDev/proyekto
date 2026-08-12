# Marketplace & Applications

> **Last updated:** 2026-08-11 · **Status:** current

Two related domains that feed Proyekto's managed model: **applications** (how someone
becomes a vetted consultant) and the **marketplace** (how a verified consultant finds
and hires freelancers). The gate between them is consultant verification.

## Applications

A user applies to become a verified consultant; an admin reviews and approves.

- **Table:** `consultant_applications` (`application_status` = draft \| submitted \|
  under_review \| approved \| rejected). This is the only `consultant_*` table.
- **HTTP:** `GET /applications/me`, `POST /applications` (upsert), `POST
  /applications/submit`.
- **Review** happens in the admin console over the full `user_*` identity — see
[Data → identity model](../../07-data-and-db/identity-vetting-model.md) and the
[Admin vetting playbook](../../12-runbooks/README.md).

Any authenticated account may apply — there is no account role and no consultant
signup lane. Approval idempotently provisions the applicant's personal team and flips
`is_consultant_verified`, the single account-level capability.

## Marketplace

Active consultants discover and invite public Talent accounts into their projects.

| Endpoint | Guard | Purpose |
| --- | --- | --- |
| `GET /marketplace/freelancers` | `ConsultantOnlyGuard` | Browse the freelancer pool |
| `POST /marketplace/go-live` | Supabase | A freelancer opts into being discoverable |
| `POST /marketplace/invite` | `ConsultantOnlyGuard` | Invite a freelancer to a project |
| `GET/PATCH /marketplace/invites[/me,/:id/respond]` | Supabase | List / respond to invites |

Discovery draws on the profile sub-entities (`user_rate_settings`, `user_stats`,
`user_specializations`, `user_skills`) so consultants can filter by skill, niche,
rate, and availability. Invites reuse `project_invites`.

> **The active-consultant gate:** consultant-only routes require
> `profiles.is_consultant_verified=true` through the shared predicate — vetting is
> the only account-level capability. The freelancer query filters `is_public=true`
> with no eligibility enforcement, and `POST /marketplace/go-live` has the same gap;
> marketplace enrollment records are the designed fix
> ([Proposals → identity and enrollment](../../13-proposals/identity-and-enrollment.md)).
> See
> [Talent → discovery and delivery](../talent/discovery-and-delivery.md),
> [Backend → auth & guards](../../03-backend/auth-and-guards.md), and
> [Product → personas](../../01-product/personas.md).

## Related flows

- **Admin matchmaking** — admins can also match candidates to projects
  (`GET /admin/match-candidates`, `POST /admin/match-assign`). See the
  [Admin vetting playbook](../../12-runbooks/README.md).
- **Teams** — hired freelancers land in project teams; see
  [Teams and Time](../teams-and-time/README.md).
- **Position deep dives** — see [Talent](../talent/README.md) and
  [Consultants](../consultants/README.md) for the complete account-to-delivery flows.

## Code locations

- **Backend:** [`backend/src/modules/marketplace/applications/`](../../../backend/src/modules/marketplace/applications/), [`backend/src/modules/marketplace/marketplace/`](../../../backend/src/modules/marketplace/marketplace/), [`backend/src/modules/marketplace/consultants/`](../../../backend/src/modules/marketplace/consultants/), [`backend/src/modules/shared/admin/`](../../../backend/src/modules/shared/admin/)
- **Web:** `web/src/routes/_marketplace/consultant/`, `web/src/routes/_marketplace/freelancer/`, `web/src/components/marketplace/` (public consultant marketing routes remain ungrouped)
