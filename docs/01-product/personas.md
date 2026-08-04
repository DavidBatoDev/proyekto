# Roles and Capabilities

> **Last updated:** 2026-08-05 · **Status:** current

Proyekto supports four participant roles without a global account mode. A person can
fund one project, contribute work to another, and lead a third without switching
their profile into a different state.

> Proyekto's differentiator is the **Consultant layer** between Clients and
> Freelancers: vetted project leads turn a freelance hire into managed delivery.

## Participant roles

| Role | Who they are | What they do |
| --- | --- | --- |
| **Client** | The person paying for the work | Defines goals, approves direction, tracks project health, funds delivery |
| **Consultant** | The vetted project lead | Translates the client's vision into a roadmap, assembles the team, owns delivery |
| **Freelancer** | The person doing scoped work | Delivers tasks/features, logs time, updates progress |
| **Admin** | Platform staff | Vets consultants, governs quality, resolves matchmaking |

These are contextual responsibilities, not values stored on `profiles`. The app has
no role switcher and no account-level role enum.

## Authorization sources

Different data answers different authorization questions:

- `profiles.is_consultant_verified` grants the durable consultant capability used
  by consultant-only marketplace and hiring surfaces.
- An active `admin_profiles` row grants platform administration access.
- `project_access.role` and its capability overrides determine what a member can do
  inside a project. The default ladder is
  `owner > admin > editor > commenter > viewer`.
- `profiles.is_public` controls whether a freelancer profile is discoverable.
- Onboarding lane and intent are retained in profile settings for provisioning and
  product guidance; they do not authorize requests.

Creating or funding a project does not require selecting a Client account mode.
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
