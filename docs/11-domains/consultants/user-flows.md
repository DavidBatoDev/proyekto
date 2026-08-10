# Consultant User Flows

> **Last updated:** 2026-08-10 · **Status:** current

The Consultant flow deliberately separates identity, vetting, and project authority. Signup
creates the identity and team; approval unlocks product capability; project creation or
assignment establishes authority over a specific engagement.

## 1. Signup and team provisioning

```text
Choose Consultant
  -> profiles.role='consultant'
  -> is_consultant_verified=false
  -> canonical onboarding settings
  -> personal team provisioned
  -> Consultant welcome deck
```

If OAuth has no continuation lane, `/welcome` asks for a role before completing onboarding.
The role cannot be changed by replaying onboarding after completion.

## 2. Apply and receive approval

The applicant saves a draft, submits required experience and niche information, and waits for
admin review. Approval provisions the personal team idempotently, changes application status,
sets Consultant role, and enables verification. Rejection leaves consultant powers disabled.

## 3. Create or join a project

An active consultant can create in consultant mode. The project is forced to draft, the
creator becomes the named consultant and owner, and an optional personal/reusable team can be
attached with the consultant as the initial curated member.

For client-created projects, assignment grants the selected active consultant owner access.
A consultant who merely accepts an invite remains an ordinary project member until explicit
assignment changes the project relationship.

## 4. Find and invite Talent

The consultant opens `/consultant/marketplace`, searches public profiles, and selects a
project they administer. The service rechecks active status, project admin authority, public
visibility, and self-invite prevention. Acceptance gives Talent editor access.

For paid delivery, the consultant then attaches or uses a team, curates the member, and sets
an internal rate. A direct invite alone is not sufficient for payout activation checks.

## 5. Operate delivery

Consultant-origin permissions support member and team management, communication with Talent,
and team-wide time visibility. Owner role supplies the remaining project settings and
permission-management capabilities. The consultant prepares contracts, reviews delivery,
approves time, issues invoices, and generates payouts through guarded finance/team surfaces.

## 6. Publish roadmap templates

Active consultants can create a template from a roadmap and manage its lifecycle: update,
publish, revise, unlist, archive, and view analytics. Public browsing and template
instantiation are broader; authoring operations are guarded.

## 7. Reassign the consultant

```text
privileged caller selects existing project member
  -> verify replacement is active consultant
  -> update projects.consultant_id
  -> grant replacement owner + consultant origin
  -> attempt to revoke previous consultant
  -> preserve previous owner if last-owner guard requires it
```

## See also

- [vetting-and-capabilities.md](./vetting-and-capabilities.md)
- [Talent: user flows](../talent/user-flows.md)
- [Admin vetting playbook](../../12-runbooks/admin-vetting-playbook.md)
