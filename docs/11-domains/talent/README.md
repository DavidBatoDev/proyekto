# Talent

> **Last updated:** 2026-08-10 · **Status:** current

Talent are the people who deliver project work — a **market position, not an account
attribute** (there is no stored account role; `profiles.role` was dropped 2026-08-10).
Being talent on a project comes from project access and team curation; being
discoverable comes from `profiles.is_public`.

This folder is the source of truth for the Talent journey from signup through discovery,
delivery, time logging, and payout. Code and older routes still use the word `freelancer`;
user-facing identity and new documentation use **Talent**.

## The three facts to keep separate

| Fact | Answers |
| --- | --- |
| `profiles.is_public` | May the profile appear in the freelancer marketplace query? |
| `team_members.role` | What may the person administer inside a reusable team? |
| `project_access.role`, `origin`, `capabilities` | What may the person do on one project? |

None implies another, and no account-level fact says "this account is talent": the
same person may own a team, pay for one project, and deliver another. The `go-live`
endpoint makes any authenticated profile public — there is deliberately no identity
gate, only (missing) profile-eligibility checks.

## Typical delivery path

```text
Signup (lane-free)
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
| [talent-structure.md](./talent-structure.md) | Profile data, teams, project membership, and why there is no `talent` table |
| [access-and-permissions.md](./access-and-permissions.md) | Project-role baselines, invite and team origins, and the absence of a Talent origin delta |
| [user-flows.md](./user-flows.md) | Signup, go-live, invites, team curation, time logging, payout, and consultant promotion |
| [talent-surfaces.md](./talent-surfaces.md) | Shared and Talent-specific routes, plus consultant-only exclusions |
| [discovery-and-delivery.md](./discovery-and-delivery.md) | Marketplace visibility, profile quality signals, rates, time, and payout boundaries |

## Glossary

| Term | Meaning |
| --- | --- |
| **Talent** | The market position of delivering scoped work. Not an account attribute; legacy code often says "freelancer". |
| **Go live** | Set `profiles.is_public=true`, making the profile eligible for the current marketplace query. |
| **Marketplace invite** | A `project_invites` row sent by an active consultant to a public profile. |
| **Curation** | Selecting a team member for a project through `project_team_members`; this creates project access. |
| **Internal rate** | The Talent member's cost rate from `team_member_rates`, snapshotted onto time logs and never shown to clients. |

## Known gaps

- `POST /marketplace/go-live` does not check server-side profile eligibility before
  setting `is_public=true`.
- `GET /marketplace/freelancers` filters only on `is_public=true` — any public profile
  enters the pool. Marketplace enrollment records are the designed fix; see
  [Proposals → identity and enrollment](../../13-proposals/identity-and-enrollment.md).
- A directly invited worker can log work without being curated through a team; activation
  and payout rate checks only see `project_team_members`, so paid delivery should use teams.

## Code locations

- **Onboarding:** [`backend/src/modules/auth/`](../../../backend/src/modules/auth/)
- **Profile quality:** [`backend/src/modules/profile/freelancer-eligibility.service.ts`](../../../backend/src/modules/profile/freelancer-eligibility.service.ts)
- **Discovery and invites:** [`backend/src/modules/marketplace/`](../../../backend/src/modules/marketplace/)
- **Teams and time:** [`backend/src/modules/teams/`](../../../backend/src/modules/teams/), [`backend/src/modules/team-time/`](../../../backend/src/modules/team-time/)
- **Web:** [`web/src/routes/freelancer/`](../../../web/src/routes/freelancer/), [`web/src/routes/teams/`](../../../web/src/routes/teams/)
