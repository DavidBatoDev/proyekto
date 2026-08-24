# Deliverable Reviewers: Close the Create-Path Membership Gap

> **⚠️ Proposed — not built.**

> **Last updated:** 2026-08-24 · **Status:** draft

A one-method fix, written up rather than bundled into an unrelated branch. Found while
building the delivery MCP tools (`delivery:write`), which work around it rather than
inherit it.

## The gap

`DeliverablesService` has two ways to name a reviewer, and only one of them checks that
the person is on the project.

`addReviewer` checks
([`deliverables.service.ts`](../../backend/src/modules/execution/delivery/deliverables.service.ts),
the `POST :id/reviewers` route):

```ts
// A reviewer must actually be on the project — otherwise naming someone
// would hand a decision to a person who cannot even open the deliverable.
const { data: member } = await this.db
  .from('project_access')
  .select('user_id')
  .eq('project_id', projectId)
  .eq('user_id', dto.reviewer_id)
  .maybeSingle();
if (!member) {
  throw new BadRequestException('That person is not a member of this project.');
}
await this.insertReviewers(deliverableId, [dto.reviewer_id], userId);
```

`create` does not. `CreateDeliverableDto.reviewer_ids` goes straight to the same private
helper with no check in between:

```ts
// create(), via insertReviewers() — no project_access lookup anywhere on this path
await this.db.from(REVIEWERS_TABLE).upsert(
  reviewerIds.map((reviewerId) => ({
    deliverable_id: deliverableId,
    reviewer_id: reviewerId,
    added_by: userId,
  })),
  { onConflict: 'deliverable_id,reviewer_id', ignoreDuplicates: true },
);
```

So `POST /api/projects/:projectId/deliverables` with
`{ "title": "...", "reviewer_ids": ["<any user uuid>"] }` writes a
`deliverable_reviewers` row for someone who has no `project_access` row at all. The
column is `reviewer_id uuid REFERENCES profiles(id)`, so any real account id is accepted.

## What it is and is not

**It is not privilege escalation.** Naming someone a reviewer looks like it grants decide
authority, because `canDecide`
([`deliverable-review.ts`](../../backend/src/modules/execution/delivery/deliverable-review.ts))
returns true for a named reviewer regardless of `deliverables.approve`. But `review()`
resolves permissions *first*:

```ts
const perms = await this.authorization.assertPermission(
  userId, projectId, 'access.delivery',
);
const hasApprove = getPermission(perms, 'deliverables.approve');
const existing = await this.loadOrThrow(projectId, deliverableId);
if (!canDecide(userId, existing.reviewers ?? [], hasApprove)) { ... }
```

A non-member fails `assertPermission` and never reaches `canDecide`, so they cannot
approve, reject, or read the deliverable.

**What it actually costs:**

- Junk `deliverable_reviewers` rows pointing at people outside the project.
- A misleading UI — the deliverable shows a pending reviewer who can never act, so it
  reads as blocked on someone who cannot unblock it.
- `resolveReviewOutcome` counts those rows, so a deliverable with a phantom pending
  reviewer never reaches `approved` on its own. The only exit is `removeReviewer`, which
  re-derives status — an operator has to notice the phantom first.
- A small disclosure: the reviewer embed joins `profiles`, so the creator learns the
  display name (and, per `REVIEWER_PROFILE_COLS`, the email) of an arbitrary account id.
  That last part is the sharpest edge, and it is the one an attacker would actually use —
  a project editor can enumerate profile rows by guessing uuids.

The actor must already hold `deliverables.edit` (editor and up), so this is a
member-versus-member issue inside one project, not an anonymous one.

## The fix

Move the check out of `addReviewer` and into `insertReviewers`, so both paths get it:

1. In `insertReviewers`, take `projectId`, select `user_id` from `project_access` for
   `reviewerIds` in one `.in()` query, and throw `BadRequestException` naming the ids that
   are not members.
2. Have `addReviewer` drop its now-duplicated lookup and call the shared helper.
3. `create` passes its `projectId` through — it already has it as arg 0.

One query per create rather than per reviewer, and the invariant lives on the write path
instead of on one of its two callers.

**Compatibility.** This turns a silently-accepted create into a 400. The web
`CreateDeliverableModal` only offers project members in its picker, so no first-party
caller should be affected — but it is a live REST behaviour change and belongs in its own
commit with a spec, not folded into a feature.

Consider a follow-up migration adding a composite FK or a trigger so the database enforces
it too; today nothing at the schema level ties `deliverable_reviewers.reviewer_id` to
membership.

## Why MCP does not wait for this

The `deliverable_create` MCP tool omits `reviewer_ids` from its input schema entirely
([`delivery-write.tools.ts`](../../backend/src/modules/shared/mcp/tools/delivery-write.tools.ts)),
for an independent reason: naming a reviewer is an act of authority, and an agent handing
out sign-off rights is not something a connector should do unattended. Closing this gap
does not change that decision — reviewers stay a human action in the app.
