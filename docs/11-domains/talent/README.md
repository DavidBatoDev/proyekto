# Talent

> **Last updated:** 2026-08-10 · **Status:** current

Talent are the people who deliver project work. A Talent account has the durable identity
`profiles.role='talent'`, but that value does not place the person on a project, choose their
project permissions, or make them discoverable. Those outcomes come from project access,
team curation, and `profiles.is_public` respectively.

This folder is the source of truth for the Talent journey from signup through discovery,
delivery, time logging, and payout. Code and older routes still use the word `freelancer`;
user-facing identity and new documentation use **Talent**.

## The four facts to keep separate

| Fact | Answers |
| --- | --- |
| `profiles.role='talent'` | What account identity was selected at onboarding? |
| `profiles.is_public` | May the profile appear in the freelancer marketplace query? |
| `team_members.role` | What may the person administer inside a reusable team? |
| `project_access.role`, `origin`, `capabilities` | What may the person do on one project? |

None implies another. A Talent account may own a team, create a client-mode project, or hold
project `admin` access. Conversely, the current `go-live` endpoint can make any authenticated
profile public because it does not yet enforce the Talent account role.

## Typical delivery path

```text
Talent signup
  -> personal workspace
  -> complete profile, rates, portfolio, and identity
  -> go live (`is_public=true`)
  -> active consultant sends a project invite
  -> Talent accepts and receives project editor access
  -> work is assigned and time is logged
  -> approved time becomes an internal payout
```

## Documentation index

| Doc | What's in it |
| --- | --- |
| [talent-structure.md](./talent-structure.md) | Account identity, profile data, teams, project membership, and why there is no `talent` table |
| [access-and-permissions.md](./access-and-permissions.md) | Project-role baselines, invite and team origins, and the absence of a Talent origin delta |
| [user-flows.md](./user-flows.md) | Signup, go-live, invites, team curation, time logging, payout, and consultant promotion |
| [talent-surfaces.md](./talent-surfaces.md) | Shared and Talent-specific routes, plus consultant-only exclusions |
| [discovery-and-delivery.md](./discovery-and-delivery.md) | Marketplace visibility, profile quality signals, rates, time, and payout boundaries |

## Glossary

| Term | Meaning |
| --- | --- |
| **Talent account** | A profile with `profiles.role='talent'`. Legacy code often calls it a freelancer. |
| **Go live** | Set `profiles.is_public=true`, making the profile eligible for the current marketplace query. |
| **Marketplace invite** | A `project_invites` row sent by an active consultant to a public profile. |
| **Curation** | Selecting a team member for a project through `project_team_members`; this creates project access. |
| **Internal rate** | The Talent member's cost rate from `team_member_rates`, snapshotted onto time logs and never shown to clients. |

## Known gaps

- `POST /marketplace/go-live` does not check `profiles.role='talent'` or server-side profile
  eligibility before setting `is_public=true`.
- `GET /marketplace/freelancers` filters `is_public=true`, but not account role. A public
  Client or Consultant profile can therefore enter the pool.
- Client-versus-Talent project actions are not yet separated. Project access remains the
  authority for shared delivery routes.
- A directly invited worker can log work without being curated through a team; activation
  and payout rate checks only see `project_team_members`, so paid delivery should use teams.

## Code locations

- **Account identity:** [`backend/src/modules/auth/`](../../../backend/src/modules/auth/)
- **Profile quality:** [`backend/src/modules/profile/freelancer-eligibility.service.ts`](../../../backend/src/modules/profile/freelancer-eligibility.service.ts)
- **Discovery and invites:** [`backend/src/modules/marketplace/`](../../../backend/src/modules/marketplace/)
- **Teams and time:** [`backend/src/modules/teams/`](../../../backend/src/modules/teams/), [`backend/src/modules/team-time/`](../../../backend/src/modules/team-time/)
- **Web:** [`web/src/routes/freelancer/`](../../../web/src/routes/freelancer/), [`web/src/routes/teams/`](../../../web/src/routes/teams/)
