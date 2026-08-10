# Talent User Flows

> **Last updated:** 2026-08-10 · **Status:** current

The Talent journey crosses three independent transitions: creating the account, becoming
discoverable, and receiving delivery access. Finishing one never silently completes another.

## 1. Signup

```text
Choose Talent
  -> completeOnboarding({ lane: 'talent' })
  -> profiles.role='talent'
  -> canonical onboarding settings stored
  -> personal workspace provisioned
  -> shared welcome deck
```

OAuth users without a saved lane select Client, Talent, or Consultant on `/welcome` before
onboarding completes. Old `client_freelancer` continuations are normalized for compatibility.

## 2. Build the professional profile

`/freelancer/go-live` collects rate settings, specialization, skills, portfolio material,
and an identity document. The shared profile system also supports experience, education,
certifications, languages, and licenses.

`FreelancerEligibilityService` reports four checklist groups:

| Requirement | Satisfied by |
| --- | --- |
| `identity` | Verified identity document or verified identity record |
| `rate_settings` | Hourly rate, currency, and availability |
| `portfolio` | At least one portfolio row |
| `profile_basics` | Headline, bio, and country |

The checklist is informational. The go-live API currently sets `is_public=true` without
enforcing the checklist or Talent role.

## 3. Go live and receive an invite

An active consultant searches the marketplace and sends an invite for a project they can
administer. The invite is upserted by `(project_id, invitee_id)` and creates a notification.
Talent reviews invites in `/invites`; the legacy `/freelancer/invites` route redirects there.

Accepting a marketplace invite:

```text
project_invites.status = accepted
project_access.role     = editor
project_access.origin   = invited
```

Declining changes only the invite status and creates no access grant.

## 4. Join a reusable team

A team owner or admin can invite the person into `team_members`. Team membership alone does
not expose every project. For each attached project, the operator selects participating
members in `project_team_members`; that curation creates project access automatically.

## 5. Deliver and log time

Talent with the required project permissions edits work, uploads resources, participates in
chat, and logs time against available project tasks. Start/stop and manual logs snapshot the
resolved internal rate and currency so later rate-card changes do not rewrite history.

Reviewers approve or reject logs individually or in bulk. Approved, unpaid logs feed payout
generation. Client invoices use the contract's client rate, never the Talent rate snapshot.

## 6. Leave or lose access

| Event | Effect |
| --- | --- |
| Direct project access revoked | Removes direct support; team-supported access may remain |
| Removed from project curation | Removes that team support; direct access may remain |
| Removed from reusable team | Removes the team relationship and related project curation |
| Invite declined | No project access is created |

## 7. Apply as a consultant

Application endpoints are available to authenticated users. A Talent account may create and
submit a consultant application. Admin approval provisions a personal team idempotently,
sets `role='consultant'`, and sets `is_consultant_verified=true`. Users cannot perform this
promotion themselves.

## See also

- [discovery-and-delivery.md](./discovery-and-delivery.md)
- [Consultants: user flows](../consultants/user-flows.md)
- [Marketplace and applications](../marketplace/README.md)
