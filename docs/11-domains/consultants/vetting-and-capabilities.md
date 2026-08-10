# Consultant Vetting and Capabilities

> **Last updated:** 2026-08-10 · **Status:** current

Consultant vetting is a state machine layered on top of account identity. The role records
who the account is; the verification flag records whether consultant powers are active. All
authorization sites must evaluate both through the shared predicate.

## Application lifecycle

```text
draft
  -> submitted
  -> under_review
  -> approved
       or
     rejected
```

`POST /applications` upserts the draft. Submission requires `cover_letter`,
`years_of_experience`, and `primary_niche`, and only a draft may be submitted. Admin review
uses the shared profile identity and supporting `user_*` records.

## Approval transaction boundary

The application service and admin service divide responsibility:

```text
resolve applicant user
  -> provision personal team (idempotent)
  -> mark application approved
  -> set profiles.role='consultant'
  -> set profiles.is_consultant_verified=true
  -> invalidate consultant discovery caches
```

Provisioning happens before capability is granted. If later approval work fails, an orphaned
personal team is safe and retryable; the reverse ordering could leave an active consultant
without their required team.

## Shared predicate

| Layer | Implementation |
| --- | --- |
| Backend helper | `isActiveConsultant(profile)` |
| Backend controller guard | `ConsultantOnlyGuard` |
| Database helper | `is_active_consultant(uuid)` |
| Compatibility database helper | `is_verified_consultant(uuid)` delegates to the active helper |
| Web helper | `isActiveConsultant(profile)` |

The legacy name `isVerifiedConsultant` remains only as a deprecated web alias. Raw
`is_consultant_verified` is still appropriate for displaying a vetting badge, but not for
granting access.

## Capabilities requiring active status

| Capability | Enforcement |
| --- | --- |
| Browse and invite from Talent marketplace | Guard plus service-level predicate |
| Create a project in consultant mode | Projects service predicate |
| Be assigned or reassigned as project consultant | Projects repository/service predicate |
| Use Finance portfolio, contracts, and invoices | Controller-wide guard |
| Create, publish, revise, unlist, archive, and analyze own templates | Endpoint guards |
| Perform consultant-sensitive rate ownership operations | Database trigger/helper |
| Appear in public consultant directory | Role and verification query filters |

## What unverified Consultants can still do

An unverified Consultant is an ordinary authenticated user with Consultant identity. They can
complete profiles, manage shared account settings, accept project or team invites, and use any
project permissions explicitly granted to them. They cannot use the operator capabilities in
the table above.

## Privileged-field protection

Authenticated and anonymous database sessions cannot change role or consultant verification.
The profiles trigger rejects protected updates and forces safe insert values. The backend
service role performs admin approval writes.

## See also

- [Admin vetting playbook](../../12-runbooks/admin-vetting-playbook.md)
- [Backend auth and guards](../../03-backend/auth-and-guards.md)
- [Data RLS and security](../../07-data-and-db/rls-and-security.md)
