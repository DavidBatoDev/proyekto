A deliverable is a thing you have committed to hand over — a design system, a
migrated database, a launch campaign — written down with the conditions under
which it counts as finished. It is the one register that lives in the
**Project** group of the sidebar rather than under Management, because a
deliverable is what the work is *for*, not a record kept about the work.

## Creating one

A deliverable holds four things:

| Field | What belongs in it |
| --- | --- |
| **Title** | The thing itself, in the client's words — "Checkout redesign", not "Phase 2" |
| **Description** | What is in scope, and anything explicitly out of it |
| **Acceptance criteria** | The conditions under which this is done |
| **Attachments** | The specs, mockups or exports that define or evidence it |

The acceptance criteria are the part that earns its keep, and the part most
often written badly. Criteria should be things a reviewer can check rather than
qualities they have to judge. *"Loads in under two seconds on a mid-range
phone"* can be accepted or sent back by anyone. *"Feels fast"* cannot, and it
guarantees a conversation at exactly the moment you wanted a signature.

> Write the acceptance criteria before the work starts, not before the review.
> They are the deliverable's definition of done, and everyone should see them
> when there is still time to disagree.

## Reviewers

A deliverable names its **reviewers** — the people whose acceptance the handover
depends on. Naming them is a deliberate act: it settles in advance who decides,
which is otherwise argued about on the day the work is submitted.

A reviewer can do one thing other project members cannot: **record a review
outcome**, accepting the deliverable or sending it back. Editing the deliverable,
linking work to it and commenting on it all follow ordinary
[project access](/docs/projects/access-and-roles). Being a reviewer is about
authority, not about edit rights.

Name more than one where a handover genuinely needs two sign-offs — a technical
reviewer and a client-side one, say. Name only the people whose agreement is
actually required; every extra name is another person the submission waits on.

## The lifecycle

| State | What it means | Who moves it |
| --- | --- | --- |
| **Draft** | Being defined. Criteria may still change | Anyone with edit access |
| **Submitted** | Handed over for review, criteria frozen in practice | The team doing the work |
| **In review** | A reviewer is assessing it against the criteria | The named reviewers |
| **Accepted** | Meets the criteria. The handover stands | A named reviewer |
| **Sent back** | Does not meet the criteria yet, with the reason recorded | A named reviewer |

Submitting notifies the named reviewers — it is the signal that something is
waiting on them, so submit when the work is genuinely ready rather than as a
progress update. Recording an outcome notifies the person who submitted it, and
stamps the reviewer's name against the result.

A deliverable that is sent back is not a failure state and does not start again.
The reason is kept on the record, you address it, and you submit again. The
history of attempts stays with the deliverable, which is usually more useful
than a clean-looking one.

Every one of these transitions is written to the project's
[Activity](/docs/delivery-governance/activity) log with an actor and a
timestamp, so "when was this accepted, and by whom" is a lookup rather than a
memory.

## Progress rolls up from the work

Link a deliverable to the [roadmap](/docs/roadmaps-and-work/roadmaps-overview)
work that produces it — the features and
[tasks](/docs/roadmaps-and-work/tasks) whose completion is what makes it real.

Once linked, progress is **derived** from those items rather than typed in by
anyone. Tasks roll up into features, features roll up into the deliverable, and
the percentage you see is the same number the roadmap is showing, counted from
the same place. There is no progress field to keep current and no way for the
summary to flatter the detail.

That rollup surfaces on the project **Overview** page, alongside everything else
that page derives, so the answer to "how is the handover going?" is available
without anyone writing a status. See
[Inside a project](/docs/projects/inside-a-project).

An unlinked deliverable still works as a record — title, criteria, reviewers,
lifecycle — it simply cannot show progress, because nothing has told it which
work counts.

## A practical rhythm

1. Create the deliverable in **draft**, with criteria, at the point the
   commitment is made.
2. Name the reviewers then, while it is uncontroversial.
3. Link the features and tasks as the roadmap takes shape.
4. Submit when the criteria are met, not when the deadline arrives.
5. Let the acceptance — or the reason it was sent back — do the reporting.

## Related

- [Delivery governance](/docs/delivery-governance/overview-governance) — the
  four registers and which question each answers
- [Change requests](/docs/delivery-governance/change-requests) — for when an
  agreed deliverable has to move
- [Tasks](/docs/roadmaps-and-work/tasks) — the level the rollup counts from
