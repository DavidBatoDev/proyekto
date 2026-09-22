Risks and issues share one register because they are the same thing at two
points in time. A **risk** has not happened yet and might not. An **issue** has
happened and is now a fact you are managing. Keeping them together means a risk
that materialises does not lose its history the moment it becomes real.

## Risk or issue

| | Risk | Issue |
| --- | --- | --- |
| **Time** | Might happen | Has happened |
| **You are managing** | Likelihood and exposure | Consequences and recovery |
| **Useful question** | How do we stop this? | How do we contain this? |

The transition matters more than the label. When a risk lands, the entry
becomes an issue and carries its own record with it — that it was seen coming,
who owned it, what mitigation was in place. That is a materially different
conversation from an issue that appears out of nowhere, and the register is what
lets you have it.

## The fields that matter

- **Likelihood** and **impact** — the pair that sets priority. Neither means
  much alone: a catastrophic impact at negligible likelihood and a certainty
  with a trivial impact both sort low, and the register's job is to surface the
  ones that are high on both.
- **Owner** — one named person. Not a team, not "us". An unowned risk is a
  sentence somebody typed, and everyone will assume someone else is watching it.
- **Mitigation** — what is being done, in enough detail that the owner could
  hand it over tomorrow. "Monitor" is not a mitigation.
- **Current state** — open, being worked, or closed, kept honest as things move.

Review the register on a rhythm rather than when something goes wrong. A risk
log nobody reads is worse than no risk log, because it creates a feeling of
control that is not there.

## Internal versus external visibility

Every entry is marked as **internal** or **external**, and this is the single
setting on this page to get right.

> Internal entries are invisible to external participants on the project.
> External entries are not. Set the visibility **before** you write anything
> sensitive — not after, and not as a tidy-up pass later.

The split exists because a delivery team has to be able to write things down
plainly. "The client's data is worse than they told us", "this vendor has missed
two deadlines and we have no plan B" — these are exactly the risks that need
recording and exactly the ones you would never open a client meeting with. An
internal entry lets the team be candid; an external one is part of the shared
account of the project.

Two habits are worth building. First, treat every new entry as internal until
you have decided otherwise. Second, write each entry as if the wrong audience
might read it — visibility is a control, not a guarantee against a screenshot,
and plainness is not the same as carelessness.

External visibility here is separate from who has access to the project at all.
Access is governed by the [role ladder](/docs/projects/access-and-roles) and the
per-person switches in [permissions](/docs/projects/permissions); the
internal/external mark is a further filter *inside* a register someone can
already open.

## Linking a risk to the work it threatens

Link an entry to the [roadmap](/docs/roadmaps-and-work/roadmaps-overview) work
it concerns — the epic, feature or
[tasks](/docs/roadmaps-and-work/tasks) that are exposed.

This turns a list of worries into something that can be acted on. A risk against
a specific feature is a risk with a date attached, because features are the
level that carries dates, and you can see immediately whether the exposure lands
before or after a milestone. A risk linked to nothing is a risk nobody can
schedule a response to.

## Closing an entry, and why it stays

Close an entry when the risk has passed or the issue is resolved, and record how
it ended. A closed entry stays in the register rather than disappearing.

That is deliberate, and the reason is that closed entries are the most useful
ones you have:

- **They show the register was worth keeping.** A risk raised in March, mitigated,
  and closed without incident is evidence the process works.
- **They are the record for the next project.** The same risks recur; a closed
  entry tells you what actually worked last time.
- **They protect the people who raised them.** When something goes wrong twice,
  "this was flagged, owned and mitigated" is a completely different account from
  a register that shows nothing.

Nothing in the register is removed to make room. Closed entries sit alongside
open ones and can be filtered out of the working view when you only want what is
live, which is most of the time.

## Related

- [Delivery governance](/docs/delivery-governance/overview-governance) — the
  four registers and how they fit together
- [Change requests](/docs/delivery-governance/change-requests) — for when a risk
  forces the plan to move
- [Activity](/docs/delivery-governance/activity) — who opened, changed and
  closed each entry
