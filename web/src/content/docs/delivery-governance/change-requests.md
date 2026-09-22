A change request is how agreed scope moves without anyone later disputing that
it did. Raise one when the plan has to change **and somebody other than you
needs to agree** — a date slips, a feature grows, something agreed comes out.
If you can simply do it, do it; a change request is for the changes that need a
decision on the record.

## When to raise one

The test is not the size of the change, it is whether anyone would be surprised
by it. Two questions, and a yes to both means raise one:

1. Does this move something that was already agreed — scope, a date, an
   approach a client signed off?
2. Is there someone whose agreement you would want to be able to point at in
   three months?

Reworking a task nobody outside the team has seen is not a change request. Adding
two weeks to a delivery date is, even when everyone is relaxed about it today.

## Creating one

A change request holds the argument, not just the outcome:

| Field | What belongs in it |
| --- | --- |
| **What is changing** | The concrete difference, stated plainly |
| **Why** | What forced it — new information, a constraint, a request |
| **Impact** | The effect on scope, dates, effort and anything downstream |
| **Affected work** | The roadmap epics, features or tasks this touches |

Write the impact honestly and specifically. A decision-maker who is told "minor
delay" and later discovers it was three weeks does not conclude that the
estimate was off; they conclude that the register cannot be trusted. Impact is
the field the whole record stands or falls on.

Linking the affected [roadmap](/docs/roadmaps-and-work/roadmaps-overview) work
does two jobs: it shows the decision-maker exactly what is in play, and after
the change is applied it leaves a trail from the work back to the request that
authorised it.

## The lifecycle

| Step | What happens | Who does it |
| --- | --- | --- |
| **Submit** | The request goes from draft to awaiting a decision | Anyone with edit access on the project |
| **Decide** | Accepted or rejected, with the reasoning recorded | A project owner or admin |
| **Mark applied** | The record confirms the change now exists in the plan | Whoever carried it out |

Submitting notifies the people who can decide it — that is the point of the
step, so leave a request in draft until it is genuinely ready to be read.
Deciding notifies the person who raised it. Both events, and the reasoning that
came with them, land in the project's
[Activity](/docs/delivery-governance/activity) log.

## Marking applied is a separate, deliberate step

This is the step teams forget, and the reason the register drifts out of trust.

> A **decided** change request is not a **done** one. Accepting a change says
> everyone agrees it should happen. Marking it applied says it has actually
> been made in the roadmap, the dates, the deliverable — wherever it landed.

Those are different facts, and Proyekto keeps them apart on purpose. Collapse
them and you get the classic failure: a register full of accepted changes,
nobody sure which ones made it into the plan, and a roadmap that quietly
disagrees with the record.

The practical rhythm is: decision lands → make the actual change on the roadmap
→ come back and mark the request applied. Reading the register for anything
accepted but not yet applied is a two-minute check that catches work everybody
assumed somebody else had done.

## Withdrawing a request

You can **withdraw** a request you raised, and the right moment is before it has
been decided — the circumstances changed, or the change turned out to be
unnecessary. Withdrawing stops the decision-makers spending time on something
that no longer matters.

A withdrawn request is not deleted. It stays in the register, marked withdrawn,
because "we considered this and pulled it" is itself a useful thing to find
later.

## What a rejected request leaves behind

A rejection is a full record, not a dead end. The request keeps everything it
had — what was proposed, why, the impact — plus who rejected it and their
reasoning. Nothing is removed.

That record is worth more than it looks. When the same proposal comes back
around, and it usually does, the previous answer and the thinking behind it are
sitting in the register. If circumstances have genuinely changed, raise a new
request and say what changed; do not reopen an old argument by editing an old
record.

## Related

- [Delivery governance](/docs/delivery-governance/overview-governance) — how
  change requests sit alongside the other three registers
- [Decisions](/docs/delivery-governance/decisions) — for choices that are not a
  variation to agreed scope
- [Change history](/docs/roadmaps-and-work/change-history) — the roadmap's own
  commit log, where the applied change shows up
