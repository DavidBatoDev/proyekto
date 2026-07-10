# Personas

> **Last updated:** 2026-07-09 · **Status:** current

Proyekto is **persona-based**: one account can act in different roles on different
projects — no separate logins, no separate products. A user's `active_persona`
decides which surfaces and permissions they get right now. There are four personas.

> Proyekto's whole reason for existing is the **Consultant layer** between Clients
> and Freelancers — the thing that turns a chaotic freelance hire into a managed,
> accountable delivery.

## The four personas

| Persona | Who they are | What they do |
| --- | --- | --- |
| **Client** | The person paying for the work | Defines goals, approves direction, tracks project health, funds delivery |
| **Consultant** | The vetted project lead | Translates the client's vision into a roadmap, assembles the team, owns delivery |
| **Freelancer** | The person doing scoped work | Delivers tasks/features, logs time, updates progress |
| **Admin** | Platform staff | Vets consultants, governs quality, resolves matchmaking |

`persona_type` = `client | freelancer | consultant | admin` (see
[Data → schema overview](../07-data-and-db/schema-overview.md)).

## One account, many contexts

A single user can be a Client on one project and a Freelancer on another. The
account switches context via `active_persona` (`PATCH /api/auth/persona`), and the
web app routes are split per persona (`admin/`, `consultant/`, `freelancer/`,
`client/`, `project/`, `roadmap/`, `teams/`) — see [Web → routing](../04-web/README.md).

## Trust: verification vs persona

Two different things gate what a user can do:

- **Active persona** — which hat they're wearing now (cheap to switch).
- **Verification** — a durable capability flag earned through vetting. Only a
  **verified consultant** can access consultant-only surfaces (the freelancer
  marketplace, hiring). That's enforced by `ConsultantOnlyGuard`, which checks
  `profiles.is_consultant_verified` — **not** the active persona. See
  [Backend → auth & guards](../03-backend/auth-and-guards.md).

Becoming a verified consultant runs through the identity/vetting flow: a
`consultant_applications` record, admin review of the full `user_*` identity, and
approval. See [Data → identity model](../07-data-and-db/identity-vetting-model.md)
and the [Admin vetting playbook](../12-runbooks/README.md).

## Per-project roles

Persona is account-level; **within a project**, access is a `share_role` on the
`project_access` row: `owner > admin > editor > commenter > viewer`. That's what
decides whether you can edit the roadmap, comment, or just view — independent of
your persona. See [Feature Domains → roadmap sharing](../11-domains/README.md).

## Guests

Before signing up, an anonymous **guest** can build a roadmap (e.g. from the hero
chat). A guest is a `profiles` row with `is_guest = true`, identified by an
`x-guest-user-id` header, and their work migrates to a real account on signup. See
[Feature Domains → guests](../11-domains/README.md).

## See also

- [project-lifecycle.md](./project-lifecycle.md) — how these personas move a project from idea to delivery.
- [roadmap-and-milestones.md](./roadmap-and-milestones.md) — the planning model they all work in.
