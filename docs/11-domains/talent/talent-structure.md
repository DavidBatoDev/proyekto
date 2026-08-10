# Talent Structure

> **Last updated:** 2026-08-10 · **Status:** current

There is no `talent` or `freelancers` table. Talent identity lives on `profiles`, professional
details live in the shared `user_*` tables, and delivery relationships live in teams and
projects. This prevents account identity from being mistaken for authorization.

## Identity and relationship model

```text
profiles (role='talent')
  |
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
| Account identity | `profiles.role` | Durable signup identity; server-owned |
| Discoverability | `profiles.is_public` | Included by the current marketplace profile query |
| Professional identity | `user_*` tables | Skills, experience, rates, portfolio, verification, and statistics |
| Team membership | `team_members` | Reusable roster and team-level role |
| Project participation | `project_access` | Project role, origin label, and capability overrides |
| Paid project curation | `project_team_members` | Which team members participate on a project |

## Signup result

Selecting Talent completes onboarding with:

```text
profiles.role                 = 'talent'
profiles.has_completed_onboarding = true
profiles.settings.onboarding = { lane: 'talent', completed_at: ... }
```

The backend then provisions a personal workspace. It does not create a personal team for a
Talent account. Onboarding is conditional and idempotent: once completed, a replayed lane
does not rewrite the role.

Legacy `client_freelancer` continuations are accepted only as compatibility input and are
normalized to Client or Talent before canonical onboarding settings are stored.

## Profile data

The marketplace card is assembled from shared identity tables rather than a role-specific
profile record.

| Table | Talent data used by discovery or delivery |
| --- | --- |
| `profiles` | Name, avatar, headline, location, public flag, email verification |
| `user_skills` | Searchable skills |
| `user_specializations` | Primary niche/category |
| `user_rate_settings` | Availability, hourly rate, currency |
| `user_stats` | Average rating and delivery statistics |
| `user_portfolios` | Work samples and portfolio evidence |
| `user_identity_documents`, `user_verifications` | Identity-vetting evidence |

`FreelancerEligibilityService` evaluates verified identity, complete rate settings, at least
one portfolio item, and the profile basics `headline`, `bio`, and `country`. The result is
attached to profile responses as `missingFreelancerRequirements`; it is guidance today, not
a server-side go-live gate.

## Three different roles

| Role system | Values | Scope |
| --- | --- | --- |
| Account role | `client`, `talent`, `consultant` | Whole account identity |
| Team role | `owner`, `admin`, `member` | One reusable team |
| Project role | `owner`, `admin`, `editor`, `commenter`, `viewer` | One project |

A Talent account can be a team owner and a project admin without becoming a Client or
Consultant. Account role is not a rank.

## Backfill behavior

The account-role migration classified verified or consultant-lane accounts as Consultant,
clear client-only signals as Client, and left everyone else as Talent. Freelance signals such
as `is_public`, a rate row, a portfolio row, or legacy freelancer intent won over client
signals. Guests stayed Talent until conversion onboarding selected a durable role.

## See also

- [access-and-permissions.md](./access-and-permissions.md)
- [Data: identity and vetting](../../07-data-and-db/identity-vetting-model.md)
- [Product: personas](../../01-product/personas.md)
