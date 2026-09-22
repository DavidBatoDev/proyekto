The board is the execution view: every task on one roadmap, laid out as cards in
status columns, with drag-and-drop between them. It is where a team works during
the week, as opposed to the roadmap tree, which is where the plan gets shaped.

## Where it is, and what it covers

Open a project and choose **Board** in the project sidebar. The board is scoped
to **one roadmap** — the roadmap of the project you are in. It shows that
roadmap's tasks, for everyone, regardless of who is assigned.

If a project has no roadmap yet, there is nothing to put on a board. Build the
tree first: see [Building a roadmap](/docs/roadmaps-and-work/building-a-roadmap).

## The columns

Columns map exactly to the five task statuses, in order:

**To do → In progress → In review → Done**, plus **Blocked**.

There are no custom columns, and that is deliberate: the statuses are the same
five everywhere in Proyekto — in the task itself, in
[Command center](/docs/roadmaps-and-work/command-center), in the rollup that
derives a feature's state. A board with its own private set of columns would
mean the board and the timeline could disagree about whether something is done.

> Dragging a card to another column **changes that task's status**, everywhere.
> The task detail updates, the parent feature's derived status updates, and the
> person who owns the task sees it in their own list.

There is no separate "board status" to reconcile. One move, one truth.

## Filtering and grouping

The board reads differently depending on the question you are asking, so you can
narrow and regroup it:

| Cut | Use it to answer |
| --- | --- |
| By **assignee** | Who is carrying what, and who has nothing in flight |
| By **epic** | Whether one initiative is stuck while another sails |
| By **feature** | What is left before this specific feature is finished |

Grouping by epic is the closest thing to a stand-up agenda the board offers:
each group is a value-based initiative, so a group full of *Blocked* cards is a
conversation with a clear subject.

## What the board deliberately does not show

Epics and features are **not cards**. The board is a task surface only.

This surprises people who expect a card per feature, so it is worth saying why:
a feature has no status of its own to put in a column. Its state is derived from
its tasks, so a feature card would either be read-only decoration or a control
that lets you contradict the tasks underneath it. Neither is useful.

For structure — what lives under what, what is a draft, where a new feature
should sit — use the roadmap tree. For dates and sequencing, use the
[timeline](/docs/roadmaps-and-work/timeline-and-milestones). The board answers
one question: *what is moving right now?*

## Creating a task from the board

You can add a task straight from a column, which is how most tasks get created
in a busy week — someone spots a gap mid-conversation and puts a card up.

A task still has to live somewhere in the tree, so when you create one here you
say which feature it belongs to. It appears under that feature in the roadmap
immediately, and it lands in the column you created it from. If you cannot find
the right feature, that is usually a sign the work is a new feature rather than
a new task, and the tree is the better place to start.

Every task is a **node**, and plans cap nodes per roadmap. At the limit, adding
a card is blocked and Proyekto tells you which limit you hit.

> Nothing already on the board is affected. Every existing card stays there,
> stays draggable, and stays editable. A limit only stops a *new* task being
> created.

## Board or Command center?

They answer different questions, and most people use both daily.

| | The board | Command center |
| --- | --- | --- |
| **Scope** | One roadmap, in one project | Every project you have access to |
| **Whose work** | Everyone's | Only tasks assigned to you |
| **Best for** | Running the project | Running your day |

If you work across three clients, the board tells you how one of them is doing;
[Command center](/docs/roadmaps-and-work/command-center) tells you what *you*
owe all three.

## Access

What you can do on the board follows your
[project access](/docs/projects/access-and-roles). Editors and above can move
cards and create tasks; commenters can open a task and comment on it but not
change its status; viewers read. A
[roadmap share link](/docs/roadmaps-and-work/sharing-a-roadmap) never reaches
the board at all.
