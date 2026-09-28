A task is the smallest unit of execution in Proyekto and the only level where
status is something a person sets. Everything above it — the feature, and the
epic above that — reads its state from the tasks underneath. This page covers
what a task holds and how it rolls up.

## The five statuses

| Status | What it means in practice |
| --- | --- |
| **To do** | Agreed and scoped, nobody has started |
| **In progress** | Someone is actively working on it |
| **In review** | The work is done but needs another pair of eyes before it counts |
| **Done** | Finished. Nothing further is expected |
| **Blocked** | Cannot progress for a reason outside the task itself |

*In review* and *Blocked* are the two that earn their keep. Without a review
state, work that is finished-but-unchecked hides inside *In progress* and the
plan looks later than it is. Without a blocked state, a stalled task looks
identical to a task nobody has picked up, and the two need completely different
conversations.

## Assignees

A task takes **multiple assignees**. Pair work, a task with a reviewer attached,
a piece of work two people split — all of that is one task with two names on it
rather than duplicates that drift apart.

> Assigning someone notifies them. Treat it as a message, not a filing
> decision.

Assigned tasks also appear in that person's
[Command center](/docs/roadmaps-and-work/command-center), which is the list they
actually work from across every project.

## Checklists

Checklists hold the sub-steps that do not deserve their own task — "update the
copy", "check it on mobile", "tell support". Ticking items off shows progress
without adding rows to the roadmap.

There is a practical reason to prefer a checklist over five small tasks: every
task is a **node**, and plans cap nodes per roadmap. Checklist items are not
nodes. Detail that lives in a checklist costs you nothing against the limit.

## Comments and attachments

Comments live on the task, which is where anyone looking at the work will think
to look for them. `@`-mention a colleague and they are notified; the thread
stays attached to the task forever, unlike the same exchange in chat.

Attachments go on the task too — a screenshot, a spec, a signed-off design.
Project-wide files belong in the project's resources library; a file that only
makes sense next to this one piece of work belongs here.

## Dependencies and being blocked

You can record that one task depends on another. The dependency is a real link,
not a note in a description, so the downstream task carries its reason for
waiting with it.

- On the **board**, a blocked card reads as blocked in its column — you can see
  at a glance that a column is full of work nothing can move.
- On the **timeline**, the feature above a blocked task shows the pressure,
  because the feature's state is derived from its tasks.

Clearing the blocker is a change to the *blocking* task. Move it on, and move
the blocked task out of *Blocked* yourself — Proyekto does not guess that the
dependency is what was holding you up.

## Rollup: there is nothing to set on the feature

The parent feature's status is **derived** from these tasks. There is no feature
status field, and no end-of-week ritual of closing features out.

> Move the tasks. The feature follows. The epic follows that.

This is why a Proyekto roadmap tends to stay honest: the summary cannot drift
from the detail, because the summary *is* the detail, counted.

## Linking a task to governance

A task can be linked to an entry in one of the project's registers — a
[deliverable](/docs/delivery-governance/deliverables), a
[change request](/docs/delivery-governance/change-requests), a
[risk or issue](/docs/delivery-governance/risks-and-issues) or a
[decision](/docs/delivery-governance/decisions).

The link answers the question a register entry always raises: *where is the work
for this?* A deliverable's progress rolls up from the tasks linked to it; a
change request that has been accepted points at the tasks that implement it; a
decision points at the work it settled.

The registers are part of higher tiers — see
[Plans](/docs/workspaces-and-plans/plans) for what each one includes. If your
workspace is on a plan without them, tasks work exactly as described above;
there is simply no register to link to.

## Where to work on tasks

- [The board](/docs/roadmaps-and-work/board) — every task on one roadmap, in
  status columns, for the whole team.
- [Command center](/docs/roadmaps-and-work/command-center) — every task assigned
  to **you**, across every project.
- The roadmap tree — when you care about where the task sits in the structure
  rather than what state it is in.
