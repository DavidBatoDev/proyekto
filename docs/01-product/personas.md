# Roles and Capabilities

> **Last updated:** 2026-08-28 · **Status:** current

Proyekto has **no stored account role**. "Client", "Talent", and "Consultant" are
words for **market positions** — who pays, who leads, who executes on a given
contract — not durable identities: the same account can pay for one project and
deliver another. The design rule is **gate on capabilities and positions, never
declared identity**. Consultant vetting is the stateful
`consultant_profiles` enrollment; everything else is per-project (`share_role`
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

> **Do not look for these positions in `project_access.origin`.** Origin records *how*
> someone joined a project — `direct`, `invited`, `personal_workspace`, `legacy`,
> `team:<id>` — and takes no part in permission resolution. It carried `'client'` and
> `'consultant'` values until 2026-08-18, when both were folded into `direct`: a project is
> the execution layer and does not model the two sides of a commercial arrangement. Those
> live on a contract — see
> [Finance → contract parties](../11-domains/finance/README.md#contract-parties).

## Authorization sources

Different data answers different authorization questions:

- `consultant_profiles.status = 'verified'` grants the **active consultant**
  capability used by consultant-only marketplace, finance, and leadership surfaces
  (`is_active_consultant()` in SQL and `isActiveConsultantEnrollment` in the backend).
  Admins may suspend, reinstate, or revoke this capability.
- An active `admin_profiles` row grants platform administration access.
- `project_access.role` and its capability overrides determine what a member can do
  inside a project. The default ladder is
  `owner > admin > editor > commenter > viewer`.
- `talent_profiles.status = 'active'` controls whether a talent profile is
  discoverable; the owner may pause and resume it.

Nothing gates on a declared identity: signup is lane-free, onboarding records only
`settings.onboarding.completed_at`, and every user gets a personal workspace.
Consultant capability is earned through the vetting flow: a
`consultant_applications` record, admin review of the full `user_*` identity, and
approval, which upserts a verified `consultant_profiles` row. See
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
- [Finance → contract parties](../11-domains/finance/README.md#contract-parties) — where the paying counterparty is actually recorded.
- [Proposals → identity and enrollment](../13-proposals/identity-and-enrollment.md) — why account roles were removed and where enrollment goes next.
- [Backend → authorization axes](../03-backend/authorization-axes.md) — all six authorization axes in one table, and the rule that keeps them apart.
