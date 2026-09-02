# Talent Structure

> **Last updated:** 2026-09-01 · **Status:** current

There is no account-level talent identity. `talent_profiles` is a marketplace
availability enrollment, not a person type —
`profiles.role` was dropped 2026-08-10 (see
[Proposals → identity and enrollment](../../13-proposals/identity-and-enrollment.md)).
Professional details live in the shared `user_*` tables, and delivery relationships
live in teams and projects. Nothing about an account, only its positions, says
"talent".

## Profile and relationship model

```text
profiles
  |
  +-- talent_profiles
  +-- user_skills / user_specializations / user_portfolios
  +-- user_rate_settings / user_stats / user_identity_documents
  +-- team_members ------------------------------+
  |                                               |
  +-- project_access <---- project_team_members <-+
                              |
                              +-- project_teams --> projects
```

| Layer | Stored in | Meaning |
| --- | --- | --- |
| Discoverability | `talent_profiles.status` | `active` is included; `paused` is retained but hidden |
| Professional identity | `user_*` tables | Skills, experience, rates, portfolio, verification, and statistics |
| Team membership | `team_members` | Reusable roster and team-level role |
| Project participation | `project_access` | Project role, origin label, and capability overrides |
| Paid project curation | `project_team_members` | Which team members participate on a project |

## Signup result

Signup is lane-free — no role or intent is asked or stored. Completing onboarding
writes:

```text
profiles.has_completed_onboarding = true
profiles.settings.onboarding      = { completed_at: ... }
```

The backend then provisions a **workspace** and a **personal project** for every user, in that
order, recording the personal project's identity in `personal_projects` (renamed from
`personal_workspaces` on 2026-09-01). Nobody gets a personal team at signup — consultants get
one at vetting approval — and the `/welcome` deck's team-creation step was removed; the deck
now asks for a workspace name instead, and its invite step invites to that workspace. Neither
the workspace nor its seats grant any project access. Onboarding is idempotent, and the legacy
`lane`/`intent` request fields are accepted but ignored. See
[Workspaces](../workspaces/README.md).

## Profile data

The marketplace card is assembled from shared identity tables rather than a role-specific
profile record.

| Table | Talent data used by discovery or delivery |
| --- | --- |
| `profiles` | Name, avatar, headline, location, email verification |
| `talent_profiles` | Active/paused marketplace enrollment and lifecycle timestamps |
| `user_skills` | Searchable skills |
| `user_specializations` | Primary niche/category |
| `user_rate_settings` | Availability, hourly rate, currency |
| `user_stats` | Average rating and delivery statistics |
| `user_portfolios` | Work samples and portfolio evidence |
| `user_identity_documents`, `user_verifications` | Identity-vetting evidence |

`TalentEligibilityService` evaluates complete rate settings, at least
one portfolio item, and the profile basics `headline`, `bio`, and `country`. The result is
available on demand through the eligibility endpoint and is enforced by go-live.

## Two role systems (neither is an account identity)

| Role system | Values | Scope |
| --- | --- | --- |
| Team role | `owner`, `admin`, `member` | One reusable team |
| Project role | `owner`, `admin`, `editor`, `commenter`, `viewer` | One project |

There is no third, account-level role system: the same person can be a team owner,
a project admin, and the paying client of another project. Historical rows may still
carry a `settings.onboarding.lane` value from the deleted lane-based signup; it is
legacy data and nothing reads it.

## See also

- [access-and-permissions.md](./access-and-permissions.md)
- [Data: identity and vetting](../../07-data-and-db/identity-vetting-model.md)
- [Product: personas](../../01-product/personas.md)
