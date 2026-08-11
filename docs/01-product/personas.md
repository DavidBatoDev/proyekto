# Roles and Capabilities

> **Last updated:** 2026-08-10 · **Status:** current

Proyekto has **no stored account role**. "Client", "Talent", and "Consultant" are
words for **market positions** — who pays, who leads, who executes on a given
contract — not durable identities: the same account can pay for one project and
deliver another. The design rule is **gate on capabilities and positions, never
declared identity**. The only account-level capability is consultant vetting
(`profiles.is_consultant_verified`); everything else is per-project (`share_role`
ladder) or per-contract. `profiles.role` and the `account_role` enum were removed on
2026-08-10 — the rationale and target enrollment design live in
[Proposals → identity and enrollment](../13-proposals/identity-and-enrollment.md).

> Proyekto's differentiator is the **Consultant layer** between Clients and
> Talent: vetted project leads turn a freelance hire into managed delivery.

## Participant positions

| Position | Who they are | What they do |
| --- | --- | --- |
| **Client** | The person paying for the work | Defines goals, approves direction, tracks project health, funds delivery |
| **Consultant** | The vetted project lead | Translates the client's vision into a roadmap, assembles the team, owns delivery |
| **Talent** | The person doing scoped work | Delivers tasks/features, logs time, updates progress |
| **Admin** | Platform staff | Vets consultants, governs quality, resolves matchmaking |

The first three are contract positions, not account attributes. Consultant is the
one position with an account-level prerequisite: completed vetting. Admin is not a
participant position at all — it comes from `admin_profiles`.

> **Do not confuse positions with `project_access.origin`.** Its `'client'` value is a
> *source label* for a project grant, and it is only assigned to the person who **created** the
> project: `respondInvite` hardcodes `origin: 'invited'`, so an invited client does not
> get it. See [Feature Domains → clients](../11-domains/clients/README.md) for the full
> model, the resolved permission matrix, and the client user flows.

## Authorization sources

Different data answers different authorization questions:

- `profiles.is_consultant_verified = true` grants the **active consultant**
  capability used by consultant-only marketplace, finance, and leadership surfaces
  (`is_active_consultant()` in SQL, `isActiveConsultant` in backend and web). It is
  the only account-level capability.
- An active `admin_profiles` row grants platform administration access.
- `project_access.role` and its capability overrides determine what a member can do
  inside a project. The default ladder is
  `owner > admin > editor > commenter > viewer`.
- `profiles.is_public` controls whether a talent profile is discoverable.

Nothing gates on a declared identity: signup is lane-free, onboarding records only
`settings.onboarding.completed_at`, and every user gets a personal workspace.
Consultant capability is earned through the vetting flow: a
`consultant_applications` record, admin review of the full `user_*` identity, and
approval, which sets `is_consultant_verified`. See
[Data → identity model](../07-data-and-db/identity-vetting-model.md)
and [Backend → auth & guards](../03-backend/auth-and-guards.md).

## Guests

Before signing up, an anonymous guest can build a roadmap. A guest is a `profiles`
row with `is_guest = true`, identified by an `x-guest-user-id` header, and their
work migrates to a real account on signup. See
[Feature Domains → guests](../11-domains/README.md).

## See also

- [project-lifecycle.md](./project-lifecycle.md) — how participants move a project from idea to delivery.
- [roadmap-and-milestones.md](./roadmap-and-milestones.md) — the planning model they share.
- [Feature Domains → clients](../11-domains/clients/README.md) — the Client position in depth: structure, permissions, flows, and surfaces.
- [Proposals → identity and enrollment](../13-proposals/identity-and-enrollment.md) — why account roles were removed and where enrollment goes next.
