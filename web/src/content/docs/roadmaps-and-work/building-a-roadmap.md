The roadmap tree is a canvas, not a form. You add epics, features and tasks
directly on it, drag them into place, and the layout rearranges itself around
what you did. This page covers the three ways to start, how to shape the tree
once it exists, and what happens when two of you are editing at once.

## Three ways to start

**From scratch.** Create a roadmap, add your first epic, and work down. Best
when you already know the shape of the work and just want it recorded.

**From a template.** Apply a published template and you get its whole structure
as an independent copy — yours to rename, prune and extend from that moment on.
See [Roadmap templates](/docs/roadmaps-and-work/templates).

**By describing it.** Tell the AI assistant what you are building and it drafts
the tree. Structural changes it proposes are two-stage: you see a semantic diff
of exactly what would be added, moved or removed, and nothing touches the
roadmap until you commit it. See
[Reviewing what the assistant changed](/docs/ai-assistant/reviewing-changes).

Most real roadmaps end up as a mix — a template or an assistant draft to get
past the blank canvas, then hand editing to make it true.

## Shaping the tree

On the canvas you can:

- **Add** an epic at the top level, a feature inside an epic, or a task inside a
  feature.
- **Nest** by moving a node onto a new parent — a task to a different feature, a
  feature to a different epic.
- **Reorder** siblings to reflect sequence.
- **Rename** in place.
- **Delete** a node. Deleting a parent takes its children with it, which is
  worth reading twice before confirming.

Pan by dragging the empty canvas and zoom to fit more of the tree on screen. The
layout is computed from the structure rather than stored as coordinates, so you
never have to tidy up after a move: nest a feature under a different epic and
the canvas redraws around the new shape. You cannot park a node somewhere
meaningless, because position *is* structure here.

## Dates live on features

Set start and end dates on a **feature** — that is the level that owns them.
Epics have no dates of their own; they are as long as the features inside them.
Tasks have no dates either; they roll up.

The tree flags dates that do not hold together — a feature that runs past the
milestone it is linked to, or sits outside the span its epic's other work
implies. It is a flag, not a block: sometimes the plan really has slipped and
you want to see that rather than be prevented from recording it. Fix it by
moving the feature's dates, or by moving the milestone. The
[Timeline](/docs/roadmaps-and-work/timeline-and-milestones) is usually the
faster place to see *why* two dates disagree.

## Draft and active nodes

A node can be a **draft** — an idea captured in the right place in the tree,
visibly not yet agreed. Drafts render differently so nobody mistakes a proposal
for a commitment, and they are how you sketch next quarter inside this quarter's
roadmap without polluting it.

When the work is agreed, promote the draft. It becomes an ordinary node from
then on: it counts toward the roadmap's node limit, appears on the timeline if
it has dates, and its tasks show up on the board.

## Working alongside other people

Roadmap editing is collaborative. Someone else's change appears in your tree as
they make it — you do not need to refresh, and you are not editing a stale copy.

Comments attach per node, so a question about one feature stays on that feature
rather than becoming a chat message nobody can find in a month. Mentioning
someone in a comment notifies them. For anything broader than one node, use
[project chat](/docs/chat-and-meetings/project-chat) instead — chat is where
things get *said*, the roadmap is where they get *recorded*.

Who can do any of this is set per person by
[project access](/docs/projects/access-and-roles): editors and above shape the
tree, commenters can comment but not restructure, viewers read.

## Everything structural is reversible

Adding, removing, moving, renaming or re-dating a node is a structural change,
and every one of them lands in the roadmap's history as a commit. You can
inspect a commit's diff, discard a staged change before it lands, or roll back
one that already did — including changes the assistant made, which use exactly
the same mechanism as a human's.

That is what makes bold restructuring safe: reorganising six epics is not a
gamble when you can read precisely what moved and undo it. See
[Change history and rollback](/docs/roadmaps-and-work/change-history).

## A note on the node limit

Epics, features and tasks all count as nodes, and plans cap nodes per roadmap.
At the limit, adding a new node is blocked and Proyekto says so.

> Nothing you have already built is affected. Every existing node stays
> readable and editable — you can rename, re-date, move and complete work as
> normal. A limit only ever stops something new from being created.

Splitting a very large roadmap into two, or pushing sub-steps into a task's
checklist rather than separate tasks, are both ordinary ways to stay under it.
