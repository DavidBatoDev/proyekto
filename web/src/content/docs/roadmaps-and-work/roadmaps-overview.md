A roadmap is the plan itself — a tree of epics, features and tasks. Four pages
in Proyekto render that tree, and the thing worth internalising early is that
they are four *views of one dataset*, not four documents you keep in sync. Edit
anywhere, and everywhere else already agrees.

## The three levels

There are exactly three, and they are not interchangeable.

| Level | What it is | What it carries |
| --- | --- | --- |
| **Epic** | A value-based initiative — "Checkout", "Onboarding", "Mobile app" | A name, a description, and the features under it |
| **Feature** | A time-bound deliverable inside an epic | **Start and end dates**, an optional milestone, and its tasks |
| **Task** | The smallest unit of execution | Status, assignees, checklists, comments, attachments, dependencies |

### Epics are initiatives, not layers

"Frontend", "Backend" and "Database" are not epics. They cut across every piece
of value you are trying to deliver, so an epic named after one can never be
*nearly done* in a way anyone outside the team understands. Name an epic after
the outcome a user gets. If you cannot describe an epic without naming a
technology, it is probably a layer wearing an epic's clothes.

### Features carry the dates

Dates live on features — not on epics, not on tasks. That single rule is why the
timeline draws features, why a milestone groups features, and why re-planning
usually means moving a handful of feature bars rather than hundreds of tasks.

### Feature status is derived

This is the most important behaviour on this page, and the one that surprises
people arriving from a tracker where every field is manual:

> You move tasks. The feature follows.

A feature's status is computed from the tasks underneath it. There is no feature
status field to maintain, no weekly ritual of closing features out, and no way
for the feature to disagree with reality. Move the last task to Done and the
feature is done.

## Four views, one dataset

| View | What it shows | Best for |
| --- | --- | --- |
| **Roadmap tree** | The whole hierarchy on a canvas you pan and zoom | Shaping structure — adding, nesting, reordering |
| **Epic view** | One epic at a time, with its features and their tasks | Working inside a single initiative without the noise |
| **Timeline** | Features drawn on a date axis, grouped by epic, with milestones | Schedule, sequencing and reporting |
| **Board** | Every task on the roadmap as a card in a status column | Day-to-day execution |

Rename a feature on the tree and the timeline bar renames. Drag a card from *In
progress* to *Done* on the board and the feature's derived status updates in the
tree. Nothing syncs, because there is nothing to sync — it is one roadmap.

See [Building a roadmap](/docs/roadmaps-and-work/building-a-roadmap),
[The board](/docs/roadmaps-and-work/board) and
[Timeline and milestones](/docs/roadmaps-and-work/timeline-and-milestones) for
each surface in detail.

## Milestones

A milestone is a date you can report against, with a set of features linked to
it — "Beta", "Client demo", "Go live". Features keep their own start and end
dates; the milestone is the commitment those features add up to. Because
features roll up from tasks, a milestone tells you where you actually are rather
than where the plan said you would be.

## Roadmaps inside a project, and on their own

A roadmap can live inside a project, or it can stand alone. Most work starts
standalone — someone sketches a plan long before there is a team, a chat channel
or a governance register around it. That is deliberate, and it is also how an
anonymous visitor can build a roadmap before they even have an account.

A standalone roadmap can be attached to a project later. When you attach it, it
gains everything the project has: a team with per-person access, chat, meetings
and the registers. Nothing about the structure changes — the epics, features and
tasks are the same rows they always were. See
[Creating a project](/docs/projects/creating-a-project).

## The node limit

Every epic, every feature and every task is a **node**, and plans cap nodes per
roadmap. That is one number rather than three separate caps, which is why moving
detail from tasks into checklists is a real way to stay under it.

When a roadmap is at its node limit, Proyekto stops you adding a new node and
tells you which limit you have reached. That is all it does.

> Reaching a limit only ever blocks something new. Every epic, feature and task
> already in the roadmap stays exactly where it is — fully readable, fully
> editable, and still yours to move, rename, re-date and complete.

Nothing is hidden, archived or removed. To see where you stand, use
[Limits and usage](/docs/workspaces-and-plans/limits-and-usage); to see what each
tier includes, see [Plans](/docs/workspaces-and-plans/plans).
