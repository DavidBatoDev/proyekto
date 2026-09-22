Every plan counts a few things, and the counting works in exactly one
direction. Before anything else on this page, the rule:

> A limit only ever blocks something **new**. Reaching one — or being over one
> — never deletes, removes, hides or downgrades anything you already have.
> Everything already there stays readable and editable.

That is not a courtesy, it is how the product is built. No limit in Proyekto
has a path that removes your data, and the wording you see when one blocks you
says so out loud, because the worst outcome of a limit would be someone
pausing their work to "clean up" data nobody was going to touch.

## What is counted

Counted limits are per workspace, except roadmap nodes, which are per roadmap.

| Counted | What goes into the count |
| --- | --- |
| **Members** | People in the workspace. Pending invites count, because an accepted invite is a member. |
| **Projects** | Projects in the workspace, archived ones included. Personal projects are not counted. |
| **Teams** | Teams in the workspace. Personal teams are not counted. |
| **Roadmap nodes** | Epics, features and tasks on a *single* roadmap. Milestones are not counted. Ten small roadmaps never add up against one another. |
| **AI messages** | Messages to the assistant in a calendar month. The count resets when the month does. |
| **Activity history** | How far back a project's activity log can be viewed. |

Activity history is the one that reads like a deletion and is not. A shorter
window hides older entries from view; the activity itself is kept, and it
comes back in full on a plan with a longer window.

## What "at the limit" looks like

You find out at the moment you try to add something, not before. The create
action — New project, New team, the invite button, adding a node to a roadmap
— explains itself in place: which limit you have reached, that **everything
you have stays**, and what to do next. A workspace owner is offered the plan;
everybody else is told to ask an owner, because only an owner can change it.

Nothing else changes. The projects you have stay open. The roadmap at its node
limit still edits, moves, renames and deletes — it just will not take a new
epic, feature or task. The members you have keep every permission they had.

## Going over a limit

You can be over a limit without having done anything wrong. It usually happens
after a plan change: a workspace with eight projects moving to a plan that
counts fewer is over by three the moment the change lands.

Nothing is deleted, hidden or archived. The count simply cannot grow. Usage
shows how far over you are, the create action stays blocked, and everything
else carries on — including the projects that put you over. The count comes
back inside the limit when you remove something yourself, or when the plan
changes again.

## The Usage page

Your workspace's **Usage** tab is where all of this is visible at once, in
four sections:

- **Plan** — the tier this workspace is on, a Complimentary badge if it was
  granted rather than bought, and a one-line summary of what it includes.
- **Limits** — a meter per counted limit, with how many are used, how many are
  left, and a caption that turns into a warning as you approach the limit.
  Roadmap nodes are shown against the largest roadmap in the workspace, since
  that is the one that hits the cap first.
- **Features** — every feature gate, marked *Included* or naming the plan it
  arrives on.
- **Activity history** — how far back your activity log currently goes.

Usage and Billing are web pages. The installed app carries no surface that
prices or sells a plan, so both are absent there — see
[the mobile app](/docs/account-and-apps/mobile-app).

## Gates and limits are different things

Two mechanisms, often confused:

A **counted limit** caps a number. You can keep using the thing; you just
cannot add another one.

A **feature gate** turns a whole surface on or off — the delivery registers,
time tracking, activity export, the MCP server. On a plan without the gate,
the surface is not there to open.

The invariant covers both. If a plan change closes a gate, the data behind it
is untouched: your deliverables, change requests, risks, decisions and time
logs are all still stored, still exactly as you left them, and they reappear —
whole — on a plan that includes the gate again. A gate hides a door; it never
empties the room.

## Where to go next

- [Plans](/docs/workspaces-and-plans/plans) — which gates and allowances come
  with each tier
- [Workspaces](/docs/workspaces-and-plans/workspaces) — the container all of
  this is counted against
- [Members and seats](/docs/workspaces-and-plans/members-and-seats) — the
  member count in detail
