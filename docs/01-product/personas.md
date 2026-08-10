# Roles and Capabilities

> **Last updated:** 2026-08-10 · **Status:** current

Proyekto gives every account one durable identity: **Client**, **Talent**, or
**Consultant**. It is selected during signup and is not a user-switchable mode. Admin
authority and project responsibilities remain independent of this account identity.

> Proyekto's differentiator is the **Consultant layer** between Clients and
> Talent: vetted project leads turn a freelance hire into managed delivery.

## Participant roles

| Role | Who they are | What they do |
| --- | --- | --- |
| **Client** | The person paying for the work | Defines goals, approves direction, tracks project health, funds delivery |
| **Consultant** | The vetted project lead | Translates the client's vision into a roadmap, assembles the team, owns delivery |
| **Talent** | The person doing scoped work | Delivers tasks/features, logs time, updates progress |
| **Admin** | Platform staff | Vets consultants, governs quality, resolves matchmaking |

The first three values are stored in `profiles.role` as the `account_role` enum.
"Freelancer" remains in legacy code identifiers and compatibility data; the
user-facing account identity is **Talent**. Admin is deliberately not an account
role: it comes from `admin_profiles`.

> **Do not confuse identity with `project_access.origin`.** Its `'client'` value is a
> *source label* for a project grant, not an account role, and it is only assigned to the person who **created** the
> project: `respondInvite` hardcodes `origin: 'invited'`, so an invited client does not
> get it. See [Feature Domains → clients](../11-domains/clients/README.md) for the full
> model, the resolved permission matrix, and the client user flows.

## Authorization sources

Different data answers different authorization questions:

- `profiles.role` records durable account identity.
- `role='consultant' AND is_consultant_verified=true` grants active consultant
  capability used by consultant-only marketplace, finance, and leadership surfaces.
- An active `admin_profiles` row grants platform administration access.
- `project_access.role` and its capability overrides determine what a member can do
  inside a project. The default ladder is
  `owner > admin > editor > commenter > viewer`.
- `profiles.is_public` controls whether a Talent profile is discoverable.
- Canonical onboarding stores the explicit Client, Talent, or Consultant lane without
  a second intent field. The two-boolean intent survives only at the transitional
  `client_freelancer` API/continuation boundary and is resolved before persistence;
  `profiles.role` is the identity source of truth.

This foundation does not yet restrict ordinary Client-versus-Talent project actions
or provide separate dashboards. Project access remains contextual.
Consultant access is earned through the identity/vetting flow: a
`consultant_applications` record, admin review of the full `user_*` identity, and
approval. See [Data → identity model](../07-data-and-db/identity-vetting-model.md)
and [Backend → auth & guards](../03-backend/auth-and-guards.md).

## Guests

Before signing up, an anonymous guest can build a roadmap. A guest is a `profiles`
row with `is_guest = true`, identified by an `x-guest-user-id` header, and their
work migrates to a real account on signup. See
[Feature Domains → guests](../11-domains/README.md).

## See also

- [project-lifecycle.md](./project-lifecycle.md) — how participants move a project from idea to delivery.
- [roadmap-and-milestones.md](./roadmap-and-milestones.md) — the planning model they share.
- [Feature Domains → clients](../11-domains/clients/README.md) — the Client role in depth: structure, permissions, flows, and surfaces.
