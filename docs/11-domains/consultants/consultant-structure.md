# Consultant Structure

> **Last updated:** 2026-08-10 · **Status:** current

There is no role-specific consultant profile table. The only `consultant_*` table is
`consultant_applications`, which records a vetting workflow rather than identity. The public
profile is assembled from `profiles` and shared `user_*` records, while project authority is
stored separately.

## Data model

```text
profiles
  |-- is_consultant_verified        the one account-level capability
  |
  +-- consultant_applications       vetting workflow
  +-- user_*                        professional identity
  +-- teams / team_members          reusable delivery organization
  +-- projects.consultant_id        named project consultant
  +-- project_access                actual project authorization
```

| Fact | Answers |
| --- | --- |
| `profiles.is_consultant_verified` | Did admin vetting succeed? |
| `consultant_applications.status` | Where is the application workflow? |
| `projects.consultant_id` | Who is the named consultant on this project? |
| `project_access.origin='consultant'` | Which project permission delta applies? |
| `teams.owner_id` / `team_members.role` | Who controls this reusable team? |

These fields can disagree. A verified consultant can be a project member without being
`projects.consultant_id`, and changing the named consultant requires an explicit
project-access grant. There is no account-level "consultant identity" separate from
the capability — `profiles.role` was dropped 2026-08-10 (see
[Proposals → identity and enrollment](../../13-proposals/identity-and-enrollment.md)).

## Provisioning

Signup is lane-free and identical for everyone: onboarding writes
`settings.onboarding.completed_at` and provisions a personal **workspace**. The
personal **team** is provisioned at admin approval, idempotently and before
verification, so an active consultant never exists without their required team.

## Public directory

`GET /consultants` and `GET /consultants/:id` are public and return only profiles with
`is_consultant_verified=true`. The directory is therefore an active-consultant
projection, not a list of applicants.

## Server-owned privileged field

A `BEFORE INSERT OR UPDATE` trigger (`tg_profiles_protect_privileged_columns`)
protects `profiles.is_consultant_verified` — its only guarded column — from `anon`
and `authenticated` sessions. Browser inserts are coerced to `false` and browser
updates that change the field are rejected. Service-role backend writes and
migrations remain authorized.

## Project identity is separate

Creating in consultant mode or being assigned as consultant grants project `owner` access
with `origin='consultant'`. `projects.consultant_id` names the relationship; the access row
enforces it. Project reassignment validates that the replacement is already a member and an
active consultant before updating both sides.

## See also

- [vetting-and-capabilities.md](./vetting-and-capabilities.md)
- [access-and-permissions.md](./access-and-permissions.md)
- [Data: identity and vetting](../../07-data-and-db/identity-vetting-model.md)
