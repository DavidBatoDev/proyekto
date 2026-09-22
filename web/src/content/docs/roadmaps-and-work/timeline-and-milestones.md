The Timeline is the roadmap drawn against a calendar: a Gantt-style chart where
each feature is a bar, grouped under its epic, with milestones marked on the
date axis. It is the view you open when the question is *when*, and the view you
show someone who wants a schedule rather than a hierarchy.

## Reading the chart

Open a project and choose **Timeline** in the sidebar. You get:

- A **date axis** across the top, which you scroll and zoom to move between a
  fortnight and a year.
- One **row per feature**, drawn from its start date to its end date.
- Features **grouped by epic**, so an initiative reads as a cluster of bars
  rather than a scatter.
- **Milestones** marked on the axis, with the features linked to each one.

It is the same roadmap as everywhere else. Change a date here and the roadmap
tree shows it; complete tasks on the board and the bars' progress reflects it.

## Why only features appear

Epics have no dates of their own, and tasks have no dates at all. **Features
carry the dates** — that is the rule the whole product is built on.

> A task has no bar because a task has no dates. It contributes its *state* to
> the feature above it, and the feature is what the calendar draws.

An epic's extent is simply the span of the features inside it, so drawing it as
its own bar would be drawing a derived number twice. If you find yourself
wanting a date on an epic, you probably want a **milestone** instead.

## Milestones

A milestone is a named date you can report against — "Beta", "Client demo", "Go
live" — with a set of features linked to it.

Create the milestone with its date, then link the features that have to be
finished for it to be real. A feature can only be honestly linked to a milestone
if its own end date is on or before that date, so the act of linking is itself a
check on the plan. Proyekto flags the ones that do not fit rather than silently
accepting a milestone nothing supports.

Milestones are what turn a roadmap into something you can put in front of a
client: a handful of dates, each with the work behind it visible on request.

## Reading slippage

The timeline shows schedule and reality at the same time, and the gap between
them is what you are looking for.

- A feature whose **end date has passed** while tasks remain unfinished reads as
  overdue. Because the feature's status is
  [derived from its tasks](/docs/roadmaps-and-work/tasks), this cannot be papered
  over by marking the feature done.
- A feature with **blocked tasks** shows the pressure early — usually before the
  end date arrives.
- A **milestone** whose linked features are behind is the headline. One late
  feature is a scheduling problem; three late features under one milestone is a
  commitment that needs renegotiating.

The honest move when something has slipped is to change the dates, not the
status. A roadmap that records the slip is worth more than one that hides it.

## Changing dates: timeline or tree?

Both work, and they suit different jobs.

| | Adjust on the timeline | Adjust in the roadmap tree |
| --- | --- | --- |
| **Good for** | One feature, nudged relative to its neighbours | Several features, or a deliberate re-plan |
| **You see** | The knock-on effect against other bars and milestones | The exact dates you are typing |
| **Risk** | A drag is easy to overshoot by a day or two | You lose the visual context |

For a **bulk change**, prefer the tree — set each feature's dates explicitly,
then come back to the timeline to check the shape. Dragging ten bars in a row is
ten chances to be a day out, and precision matters most exactly when you are
moving a lot of things at once.

Either way, re-dating a feature is a structural change: it lands in the
roadmap's history with a diff you can read and roll back. See
[Change history and rollback](/docs/roadmaps-and-work/change-history).

## On a small screen

The mobile app renders the timeline for touch. It is the same features and the
same milestones on a compressed axis — you scroll the dates and tap a bar to
open the feature rather than working with the fine-grained drag targets a mouse
allows.

Treat mobile as the *reading* surface for the schedule: check where a milestone
stands, open the feature behind a late bar, see what its tasks are doing. When
you need to actually re-plan a quarter, do it on the web, where the tree and the
chart are side by side. See [The mobile app](/docs/account-and-apps/mobile-app).

## Related

- [How roadmaps work](/docs/roadmaps-and-work/roadmaps-overview) — why features
  own the dates
- [Building a roadmap](/docs/roadmaps-and-work/building-a-roadmap) — setting
  dates as you shape the tree
