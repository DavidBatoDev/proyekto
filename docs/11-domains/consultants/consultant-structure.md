# Consultant Structure

> **Last updated:** 2026-08-10 · **Status:** current

There is no role-specific consultant profile table. The only `consultant_*` table is
`consultant_applications`, which records a vetting workflow rather than identity. The public
profile is assembled from `profiles` and shared `user_*` records, while project authority is
stored separately.

## Data model

```text
profiles
  |-- role='consultant'
  |-- is_consultant_verified
  |
  +-- consultant_applications       vetting workflow
  +-- user_*                        professional identity
  +-- teams / team_members          reusable delivery organization
  +-- projects.consultant_id        named project consultant
  +-- project_access                actual project authorization
```

| Fact | Answers |
| --- | --- |
| `profiles.role='consultant'` | Did the account select or receive Consultant identity? |
| `profiles.is_consultant_verified` | Did admin vetting succeed? |
| `consultant_applications.status` | Where is the application workflow? |
| `projects.consultant_id` | Who is the named consultant on this project? |
| `project_access.origin='consultant'` | Which project permission delta applies? |
| `teams.owner_id` / `team_members.role` | Who controls this reusable team? |

These fields can temporarily disagree. A Consultant account can be unverified; a verified
Consultant can be a project member without being `projects.consultant_id`; and changing the
named consultant requires an explicit project-access grant.

## Signup provisioning

Consultant onboarding writes canonical settings and provisions a personal team:

```text
role                         = consultant
is_consultant_verified       = false
settings.onboarding.lane     = consultant
provisioned artifact         = personal team
```

Client and Talent onboarding provision a personal workspace instead. Admin approval calls
personal-team provisioning again before verification; the operation is idempotent and avoids
creating an active consultant without their required team.

## Public directory

`GET /consultants` and `GET /consultants/:id` are public and return only profiles satisfying
both `role='consultant'` and `is_consultant_verified=true`. The directory is therefore an
active-consultant projection, not a list of every Consultant account or application.

## Server-owned privileged fields

A `BEFORE INSERT OR UPDATE` trigger protects `profiles.role` and
`is_consultant_verified` from `anon` and `authenticated` sessions. Browser inserts are
coerced to safe defaults and browser updates that change either field are rejected.
Service-role backend writes and migrations remain authorized.

## Project identity is separate

Creating in consultant mode or being assigned as consultant grants project `owner` access
with `origin='consultant'`. `projects.consultant_id` names the relationship; the access row
enforces it. Project reassignment validates that the replacement is already a member and an
active consultant before updating both sides.

## See also

- [vetting-and-capabilities.md](./vetting-and-capabilities.md)
- [access-and-permissions.md](./access-and-permissions.md)
- [Data: identity and vetting](../../07-data-and-db/identity-vetting-model.md)
