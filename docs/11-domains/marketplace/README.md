# Marketplace & Applications

> **Last updated:** 2026-08-10 · **Status:** current

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

Consultant-lane accounts have `role='consultant'` before approval but no consultant
powers. Approval idempotently provisions their personal team, sets consultant role
for applicants promoted from another lane, and flips `is_consultant_verified`.

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

> **The active-consultant gate:** consultant-only routes require both
> `profiles.role='consultant'` and `is_consultant_verified=true` through the shared
> predicate. The current freelancer query filters `is_public=true` but does **not** yet
> enforce `role='talent'`; `POST /marketplace/go-live` has the same gap. See
> [Talent → discovery and delivery](../talent/discovery-and-delivery.md),
> [Backend → auth & guards](../../03-backend/auth-and-guards.md), and
> [Product → personas](../../01-product/personas.md).

## Related flows

- **Admin matchmaking** — admins can also match candidates to projects
  (`GET /admin/match-candidates`, `POST /admin/match-assign`). See the
  [Admin vetting playbook](../../12-runbooks/README.md).
- **Teams** — hired freelancers land in project teams; see
  [Teams and Time](../teams-and-time/README.md).
- **Role deep dives** — see [Talent](../talent/README.md) and
  [Consultants](../consultants/README.md) for the complete account-to-delivery flows.

## Code locations

- **Backend:** [`backend/src/modules/applications/`](../../../backend/src/modules/applications/), [`backend/src/modules/marketplace/`](../../../backend/src/modules/marketplace/), [`backend/src/modules/consultants/`](../../../backend/src/modules/consultants/), [`backend/src/modules/admin/`](../../../backend/src/modules/admin/)
- **Web:** `web/src/routes/consultant/`, `web/src/routes/freelancer/`, `web/src/components/marketplace/`
