Proyekto's assistant is a collaborator on your roadmap rather than a chat
window bolted to the side of one. It can draft a plan from a paragraph,
restructure work you already have, create and reassign tasks, and answer
questions about a project using that project's actual data. What it cannot do
is change your structure behind your back, or see anything you could not see
yourself.

## The two places it lives

The assistant appears in two scopes, and the scope decides what it can reach.

**Inside a roadmap.** Open the AI panel from the roadmap page and the
assistant is pointed at *that* roadmap. Ask it to add an epic, split a feature,
re-date a phase or summarise where things stand, and it works on the roadmap in
front of you. Direct edits to that roadmap are the fast path.

**On the dashboard.** The dashboard rail is workspace-scoped: it can read and
work across every project and roadmap you have access to. This is where
"compare the timelines on these two projects" or "what is overdue across
everything I own" belongs. Because a workspace-scoped run can touch more than
one roadmap, edits there more often arrive as a proposal for you to confirm
rather than applying straight away.

Both scopes run the same assistant. Only the reach differs.

## What it can do

- Draft a whole roadmap from a description, a brief, or a rough list of goals.
- Restructure what exists — move features between epics, rename, re-date,
  split a bloated feature into several, merge duplicates.
- Create tasks, assign them to people (tasks take more than one assignee), and
  set status.
- Summarise status: what is in progress, what is blocked, what slipped.
- Answer questions grounded in your project rather than in general knowledge.

## What it will not do

> The assistant never lands a structural change you have not seen first, and it
> never exceeds your own permissions.

Structural edits are two-stage. The assistant proposes, Proyekto renders the
change as a readable diff, and nothing touches the roadmap until you commit it.
That flow is worth understanding in detail — see
[Reviewing and committing AI changes](/docs/ai-assistant/reviewing-changes).

The second half matters just as much: the assistant acts *as you*. It reads and
writes through your own project access, so a project you cannot open is a
project the assistant cannot open either, and a permission that hides a page
from you hides it from the assistant too. Handing it a link to something you
lack access to does not widen the door.

## Threads

Each conversation is a thread, and every thread belongs to one scope — a
roadmap, or the workspace. Threads opened inside a roadmap stay with that
roadmap; threads opened on the dashboard stay on the dashboard.

Use the thread picker at the top of the panel to switch between them or start a
**New thread**. From a thread's menu you can rename it, pin it to the top of
the list, archive it once the work is done, or delete it. There is a search box
in the picker for finding an old conversation by title.

Start a new thread when the subject changes. A long thread carries its earlier
context forward — useful on topic, noise off it.

## Reasoning effort

How hard the assistant thinks before answering depends on your workspace's
plan.

| Plan | Reasoning effort |
| --- | --- |
| Free, Pro | Standard |
| Business, Enterprise | High |

In practice, Standard is well suited to direct work: drafting, editing a
handful of items, straightforward questions. High spends longer before
answering and holds up better on multi-step requests — reconciling several
roadmaps, or a restructure where the right answer depends on reading a lot
first. Both produce the same kinds of change and both go through the same
preview-then-commit flow. See [Plans](/docs/workspaces-and-plans/plans).

## The monthly message allowance

AI messages are a counted plan limit, measured across your whole workspace and
reset on a monthly cycle.

When you reach the allowance, new messages are blocked until the count resets.
That is the whole of it:

> Every thread you already have stays readable in full. Nothing is deleted,
> archived or trimmed, and every roadmap the assistant already changed is
> untouched.

The Usage page shows where you are against the allowance — see
[Limits and usage](/docs/workspaces-and-plans/limits-and-usage).

## What it remembers

Two different things persist between sessions.

**Thread history** is the conversation itself. Reopen a thread and the
assistant still has the context of what you discussed. Very long threads get
summarised as they grow, so the important points survive without every message
being replayed.

**Memory notes** are durable preferences attached to a *roadmap*, not to you —
everyone working on that roadmap gets the benefit. These are the standing
instructions you would otherwise repeat: naming conventions, how you size
features, which epics are off limits. Ask the assistant to remember something
and it saves a note; ask it to forget a note and it removes it. Asking what it
remembers about a roadmap will list them back to you.

## Where to go next

- [Reviewing and committing AI changes](/docs/ai-assistant/reviewing-changes) —
  the preview, the commit, and rolling back
- [Giving the assistant context](/docs/ai-assistant/context-and-mentions) —
  @-references
- [The project knowledge base](/docs/ai-assistant/knowledge-base) — answering
  from what your team said
