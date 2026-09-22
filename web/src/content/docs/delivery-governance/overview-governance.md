Chat is where things get *said*. A register is where something gets *decided* —
with an owner, a date and an outcome — and stays findable six months later when
somebody asks why the scope moved or who signed the work off. Every Proyekto
project carries four registers, and this page is the map to them.

## Why a register rather than a message

A decision made in chat is real until the thread scrolls past the point anyone
will read, or until the person who made it leaves. Nobody is at fault; a
conversation is simply not a record. Six months on, the questions that actually
matter are all the same shape — *what were we meant to hand over, who agreed to
the change, was this risk ever flagged, and why did we pick this option?* — and
none of them can be answered by scrolling.

> Chat carries the conversation. A register carries the conclusion, in a place
> that does not depend on anyone remembering where it was said.

A register entry has a shape: fields you fill in, a lifecycle it moves through,
and people named against each step. That structure is what makes it searchable
later and what stops "we agreed on Tuesday" from being the whole audit trail.

## The four registers

Each one exists to answer exactly one question. If you can never remember which
to use, pick by the question:

| Register | The question it answers | Its lifecycle |
| --- | --- | --- |
| **Deliverables** | What are we handing over, and is it accepted? | Draft → submitted → reviewed → accepted or sent back |
| **Change requests** | What changed, who approved it, and has it been applied? | Submitted → decided → marked applied |
| **Risks & issues** | What could go wrong, and what already has? | Open, with an owner and a mitigation, until closed |
| **Decisions** | What did we settle, and why that option? | Recorded, then marked final |

The split between deliverables and change requests is the one worth internalising.
A deliverable is a *commitment* you are working towards. A change request is a
*variation* to what was already agreed. Logging a variation as a new deliverable
loses the fact that somebody had to approve it.

## Where they live

Three of them sit in the **Management** group in the project sidebar — Change
Requests, Decisions, and Risks & Issues — alongside
[Activity](/docs/delivery-governance/activity).

**Deliverables** deliberately sits higher up, in the **Project** group next to
Roadmap, Board and Timeline. It is there because a deliverable is the thing the
work is *for*, not a record kept about the work. See
[Inside a project](/docs/projects/inside-a-project) for the full sidebar.

## Linking entries to roadmap work

Any register entry can be linked to the roadmap work it concerns — an epic, a
feature, or individual [tasks](/docs/roadmaps-and-work/tasks). This is the
feature that turns four lists into a system, because it answers the question
every entry raises: *where is the work for this?*

- A deliverable linked to features and tasks derives its progress from them.
- An accepted change request points at the work that implements it.
- A risk points at the work it threatens.
- A decision points at the work it settled.

Follow the link in either direction. From a task you can see the deliverable it
feeds; from the deliverable you can see whether anything is actually moving.

## Who can do what

Reading and writing register entries follows project access — see
[Project access and roles](/docs/projects/access-and-roles). Commenters and
viewers read; editors and above create and update entries. The lifecycle steps
are narrower than that: reviewing a deliverable belongs to its named reviewers,
and deciding a change request belongs to a project owner or admin.

On top of the ladder, each register page can be switched off for an individual
in **Settings → Permissions**, which hides it from their sidebar entirely rather
than showing them a locked page. See
[Fine-tuning permissions](/docs/projects/permissions).

## Plans

All four registers are included from Pro upwards. On a plan without them the
pages are simply not shown in the sidebar.

What that does *not* mean is worth saying plainly, because it is the thing
people ask about before changing a plan:

> Moving to a plan without the registers never deletes an entry. Everything you
> have written is kept exactly as you left it, and reappears whole when the plan
> includes the registers again. A gate hides a door; it never empties the room.

See [Plans](/docs/workspaces-and-plans/plans) for what each tier includes, and
[Limits and usage](/docs/workspaces-and-plans/limits-and-usage) for how gates
differ from counted limits.

## Everything is on the record

Every lifecycle event across all four registers — created, submitted, decided,
accepted, closed, finalised — is written to the project's
[Activity](/docs/delivery-governance/activity) log, with who did it and when.
The registers hold the current state of things; Activity holds how they got
there.

## Where to go next

- [Deliverables](/docs/delivery-governance/deliverables) — acceptance criteria,
  reviewers, and the submit-and-review loop
- [Change requests](/docs/delivery-governance/change-requests) — and the
  mark-applied step teams forget
- [Risks and issues](/docs/delivery-governance/risks-and-issues) — including
  the internal/external split
- [Decisions](/docs/delivery-governance/decisions) — options, rationale, and
  marking one final
