# Consultant Structure

> **Last updated:** 2026-08-12 · **Status:** current

`consultant_profiles` stores the lifecycle of the vetted marketplace capability.
It does not duplicate the public profile: presentation and professional facts remain
in `profiles`, shared `user_*` records, and `user_rate_settings`. Project authority
is stored separately.

## Data model

```text
profiles
  +-- consultant_profiles           verified / suspended / revoked capability
  |
  +-- consultant_applications       vetting workflow
  +-- user_*                        professional identity
  +-- teams / team_members          reusable delivery organization
  +-- project_access                authorization + consultant-of-record
```

| Fact | Answers |
| --- | --- |
| `consultant_profiles.status` | Is consultant marketplace capability verified, suspended, or revoked? |
| `consultant_applications.status` | Where is the application workflow? |
| `project_access.origin='consultant'` | Who is consultant-of-record and which project permission delta applies? |
| `teams.owner_id` / `team_members.role` | Who controls this reusable team? |

These fields can disagree. A verified consultant can be a project member without carrying
consultant origin, and changing the consultant-of-record requires an explicit
project-access grant. There is no account-level "consultant identity" separate from
the enrollment — `profiles.role` was dropped 2026-08-10 (see
[Proposals → identity and enrollment](../../13-proposals/identity-and-enrollment.md)).

## Provisioning

Signup is lane-free and identical for everyone: onboarding writes
`settings.onboarding.completed_at` and provisions a personal **workspace**. The
personal **team** is provisioned at admin approval, idempotently and before
verification, so an active consultant never exists without their required team.

## Public directory

`GET /consultants` and `GET /consultants/:id` are public and return only profiles with
a verified consultant enrollment. The directory is therefore an active-consultant
projection, not a list of applicants.

## Server-owned enrollment

RLS gives the owner and admins read access, but no authenticated owner-write policy.
Approval and admin lifecycle endpoints use the service-role backend. The retained row,
timestamps, reason, reviewing application, and changing admin form the lifecycle audit.

## Project identity is separate

Creating in consultant mode or being assigned as consultant grants project `owner` access
with `origin='consultant'`. That access row both names and authorizes the relationship.
If legacy data contains multiple consultant-origin rows, direct grants win, then the most
recent `granted_at`. Project reassignment validates that the replacement is already a member
and an active consultant before granting the new row and revoking the previous relationship.

## See also

- [vetting-and-capabilities.md](./vetting-and-capabilities.md)
- [access-and-permissions.md](./access-and-permissions.md)
- [Data: identity and vetting](../../07-data-and-db/identity-vetting-model.md)
