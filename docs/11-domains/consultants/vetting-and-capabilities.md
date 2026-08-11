# Consultant Vetting and Capabilities

> **Last updated:** 2026-08-12 · **Status:** current

Consultant vetting produces a stateful `consultant_profiles` enrollment. There is no
account identity underneath it: only `status='verified'` grants consultant powers,
and all authorization sites evaluate that state through the shared predicate.

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
  -> upsert verified enrollment + reviewer provenance
  -> mark application approved + reviewed_by
  -> invalidate consultant discovery caches
  -> notify applicant
```

Provisioning happens before capability is granted. If later approval work fails, an orphaned
personal team is safe and retryable; the reverse ordering could leave an active consultant
without their required team.

## Shared predicate

| Layer | Implementation |
| --- | --- |
| Backend helper | `isActiveConsultantEnrollment(supabase, userId)` |
| Backend controller guard | `ConsultantOnlyGuard` |
| Database helper | `is_active_consultant(uuid)` |
| Web compatibility helper | `isActiveConsultant(profile)` reads the computed auth payload boolean |

Auth and profile payloads compute `is_consultant_verified` from the enrollment for
older mobile bundles. It is a wire-compatibility field, not a database column or an
authorization source. New readers also receive `consultant_status`.

## Capabilities requiring active status

| Capability | Enforcement |
| --- | --- |
| Browse and invite from Talent marketplace | Guard plus service-level predicate |
| Create a project in consultant mode | Projects service predicate |
| Be assigned or reassigned as project consultant | Projects repository/service predicate |
| Use Finance portfolio, contracts, and invoices | Controller-wide guard |
| Create, publish, revise, unlist, archive, and analyze own templates | Endpoint guards |
| Perform consultant-sensitive rate ownership operations | Database trigger/helper |
| Appear in public consultant directory | Inner join to verified `consultant_profiles` |

## What applicants can still do

An applicant awaiting approval is an ordinary authenticated user. They can complete
profiles, manage shared account settings, accept project or team invites, and use any
project permissions explicitly granted to them. They cannot use the operator
capabilities in the table above.

## Lifecycle administration

Authenticated users have no direct write policy on `consultant_profiles`. Admin APIs
allow only `verified -> suspended`, `suspended -> verified`, and
`verified|suspended -> revoked`; illegal transitions fail clearly. Re-approval upserts
`verified` and clears suspension, revocation, and reason fields. Rows are never deleted.

## See also

- [Admin vetting playbook](../../12-runbooks/admin-vetting-playbook.md)
- [Backend auth and guards](../../03-backend/auth-and-guards.md)
- [Data RLS and security](../../07-data-and-db/rls-and-security.md)
