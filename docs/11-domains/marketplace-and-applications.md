# Marketplace & Applications

> **Last updated:** 2026-07-09 · **Status:** current

Two related domains that feed Proyekto's managed model: **applications** (how someone
becomes a vetted consultant) and the **marketplace** (how a verified consultant finds
and hires freelancers). The gate between them is verification — not persona.

## Applications

A user applies to become a verified consultant; an admin reviews and approves.

- **Table:** `consultant_applications` (`application_status` = draft \| submitted \|
  under_review \| approved \| rejected). This is the only `consultant_*` table.
- **HTTP:** `GET /applications/me`, `POST /applications` (upsert), `POST
  /applications/submit`.
- **Review** happens in the admin console over the full `user_*` identity — see
  [Data → identity model](../07-data-and-db/identity-vetting-model.md) and the
  [Admin vetting playbook](../12-runbooks/README.md).

Approval flips the durable `is_consultant_verified` capability flag that gates the
marketplace.

## Marketplace

Verified consultants discover and invite freelancers into their projects.

| Endpoint | Guard | Purpose |
| --- | --- | --- |
| `GET /marketplace/freelancers` | `ConsultantOnlyGuard` | Browse the freelancer pool |
| `POST /marketplace/go-live` | Supabase | A freelancer opts into being discoverable |
| `POST /marketplace/invite` | `ConsultantOnlyGuard` | Invite a freelancer to a project |
| `GET/PATCH /marketplace/invites[/me,/:id/respond]` | Supabase | List / respond to invites |

Discovery draws on the profile sub-entities (`user_rate_settings`, `user_stats`,
`user_specializations`, `user_skills`) so consultants can filter by skill, niche,
rate, and availability. Invites reuse `project_invites`.

> **The verification gate:** the consultant-only routes are gated by
> `ConsultantOnlyGuard`, which checks `profiles.is_consultant_verified` — a
> **capability**, not the active persona. See
> [Backend → auth & guards](../03-backend/auth-and-guards.md) and
> [Product → personas](../01-product/personas.md).

## Related flows

- **Admin matchmaking** — admins can also match candidates to projects
  (`GET /admin/match-candidates`, `POST /admin/match-assign`). See the
  [Admin vetting playbook](../12-runbooks/README.md).
- **Teams** — hired freelancers land in project teams; see
  [teams-and-time.md](./teams-and-time.md).

## Code locations

- **Backend:** [`backend/src/modules/applications/`](../../backend/src/modules/applications/), [`backend/src/modules/marketplace/`](../../backend/src/modules/marketplace/), [`backend/src/modules/consultants/`](../../backend/src/modules/consultants/), [`backend/src/modules/admin/`](../../backend/src/modules/admin/)
- **Web:** `web/src/routes/consultant/`, `web/src/routes/freelancer/`, `web/src/components/marketplace/`
