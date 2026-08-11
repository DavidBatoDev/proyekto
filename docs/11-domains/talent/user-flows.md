# Talent User Flows

> **Last updated:** 2026-08-12 · **Status:** current

The Talent journey crosses three independent transitions: creating the account, becoming
discoverable, and receiving delivery access. Finishing one never silently completes another.

## 1. Signup

Signup is lane-free — no role choice exists anywhere in the wizard:

```text
4-step signup (Account -> Password -> Profile -> Verify)
  -> completeOnboarding({})            # empty body; legacy lane/intent ignored
  -> settings.onboarding = { completed_at }
  -> personal workspace provisioned
  -> single welcome deck
```

OAuth callbacks complete onboarding unconditionally; `/welcome` has no role
selection. Nothing about the account marks it as talent — see
[talent-structure.md](./talent-structure.md#signup-result).

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

The checklist is available through `GET /marketplace/go-live/eligibility`. The
go-live API enforces it before creating or resuming
`freelancer_profiles.status='active'`. The profile page can pause an active row and
resume it through the same eligibility-enforced go-live path.

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

Application endpoints are available to any authenticated user. Admin approval
provisions a personal team idempotently, then upserts
`consultant_profiles.status='verified'` with reviewer provenance. Users cannot
perform this promotion themselves.

## See also

- [discovery-and-delivery.md](./discovery-and-delivery.md)
- [Consultants: user flows](../consultants/user-flows.md)
- [Marketplace and applications](../marketplace/README.md)
