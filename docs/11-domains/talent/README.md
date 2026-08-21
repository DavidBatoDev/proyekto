# Talent

> **Last updated:** 2026-08-12 · **Status:** current

Talent are the people who deliver project work — a **market position, not an account
attribute** (there is no stored account role; `profiles.role` was dropped 2026-08-10).
Being talent on a project comes from project access and team curation; being
discoverable comes from `talent_profiles.status='active'`.

This folder is the source of truth for the Talent journey from signup through discovery,
delivery, time logging, and payout. Code and older routes still use the word `talent`;
user-facing identity and new documentation use **Talent**.

## The three facts to keep separate

| Fact | Answers |
| --- | --- |
| `talent_profiles.status` | Is the profile active in, or paused from, the talent marketplace? |
| `team_members.role` | What may the person administer inside a reusable team? |
| `project_access.role`, `origin`, `capabilities` | What may the person do on one project? |

None implies another, and no account-level fact says "this account is talent": the
same person may own a team, pay for one project, and deliver another. The `go-live`
endpoint is open to any authenticated account, but the server enforces profile
eligibility before creating or resuming the enrollment.

## Typical delivery path

```text
Signup (lane-free)
  -> personal workspace
  -> complete profile, rates, portfolio, and identity
  -> go live (`talent_profiles.status='active'`)
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
| **Talent** | The market position of delivering scoped work. Not an account attribute; legacy code often says "talent". |
| **Go live** | Pass the eligibility check and create or resume an active talent enrollment. |
| **Marketplace invite** | A `project_invites` row sent by an active consultant to a public profile. |
| **Curation** | Selecting a team member for a project through `project_team_members`; this creates project access. |
| **Internal rate** | The Talent member's cost rate from `team_member_rates`, snapshotted onto time logs and never shown to clients. |

## Enrollment behavior

- `GET /marketplace/go-live/eligibility` powers the profile preflight checklist.
- `POST /marketplace/go-live` enforces the checklist and upserts `active`.
- `POST /marketplace/pause` retains the row as `paused`; go-live resumes it.
- Discovery and direct marketplace invites require `active`.
- A directly invited worker can log work without being curated through a team; activation
  and payout rate checks only see `project_team_members`, so paid delivery should use teams.

## Code locations

- **Onboarding:** [`backend/src/modules/shared/auth/`](../../../backend/src/modules/shared/auth/)
- **Profile quality:** [`backend/src/modules/marketplace/profile/talent-eligibility.service.ts`](../../../backend/src/modules/marketplace/profile/talent-eligibility.service.ts)
- **Discovery and invites:** [`backend/src/modules/marketplace/marketplace/`](../../../backend/src/modules/marketplace/marketplace/)
- **Teams and time:** [`backend/src/modules/execution/teams/`](../../../backend/src/modules/execution/teams/), [`backend/src/modules/execution/team-time/`](../../../backend/src/modules/execution/team-time/)
- **Web:** [`web/src/routes/marketplace/talent/`](../../../web/src/routes/marketplace/talent/), [`web/src/routes/_execution/teams/`](../../../web/src/routes/_execution/teams/)
