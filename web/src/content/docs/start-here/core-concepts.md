Proyekto has a small vocabulary, and almost every question people ask turns out
to be a question about one of these words. This page defines them once.

## The three containers

Everything in Proyekto sits inside something else:

**A workspace** is the top of the tree. It owns your projects and your teams,
it holds the member list, and it carries the plan. Its URLs look like
`/w/your-workspace/…`. Most people need exactly one; you would run a second one
to keep separate billing or a separate client entirely apart.

**A project** is where delivery happens. It holds a roadmap, the people working
on it, chat, meetings, a resources library, and the governance registers. When
someone says "the work", they usually mean a project.

**A roadmap** is the plan inside a project. It is a tree of epics, features and
tasks. A roadmap can also stand on its own, before there is a project around
it — that is how most work starts.

## The work hierarchy

Inside a roadmap there are exactly three levels, and they mean different things.

**An epic** is a value-based initiative — "Checkout", "Onboarding", "Mobile
app". It is deliberately *not* a technical layer. "Frontend" and "Database" are
not epics; they cut across every piece of value you are trying to deliver, which
makes them useless for telling anyone what is nearly done.

**A feature** is a time-bound deliverable inside an epic, and it is the level
that **carries the dates**. Start and end dates live on features, which is why
the timeline draws features and not tasks.

**A task** is the smallest unit of execution. It has a status, assignees,
checklists, comments, attachments and dependencies.

**A milestone** groups a set of features into a date you can report against.

### Feature status is derived

This is the single most useful thing to understand about Proyekto, and the thing
that surprises people who have come from a tracker where everything is manual:

> You move tasks. The feature follows.

A feature's status is computed from the tasks underneath it. There is no feature
status field to keep up to date, and no ritual of "closing out" a feature at the
end of a week. If the tasks are done, the feature is done.

## Membership is not access

The second thing that surprises people, and the source of most "why can't my
colleague see this?" questions:

> Being a member of a workspace grants you access to exactly nothing inside a
> project.

The two are separate on purpose. A **workspace member** is a billable seat —
they are part of your organisation. **Project access** is a separate grant, made
per person, per project. That separation is what lets an outside consultant
deliver on your project without joining your workspace and costing you a seat,
and what lets a new hire join the workspace on Monday without instantly seeing
every client's work.

Project access runs on a ladder, from most to least:

**owner → admin → editor → commenter → viewer**

Each step can do everything the one below it can. On top of the ladder,
individual permissions can be switched on or off per person — see
[Fine-tuning permissions](/docs/projects/permissions).

### Where access came from

Every grant records its **origin** — how the person got in. Granted directly,
inherited from a team attached to the project, or created by a client
relationship. Origin is descriptive: it explains access you did not hand out
yourself, and it never affects what someone can do.

## Team, and project team

Two different things wear this word.

**A team** is a reusable group of people. You create it once, and attach it to
as many projects as you like. It lives in a workspace and is owned by a person.

**The project Team page** is just the list of who has access to that one
project, however they got it.

The connection between them is the useful part: attaching a team to a project
and choosing which of its members participate **grants those people project
access automatically**. It is the fastest way to bring five people onto a piece
of work without making five separate grants.

## A few more words you will meet

**Node** — any single item in a roadmap: an epic, a feature or a task. Plan
limits count nodes, which is why the limit is "nodes per roadmap" rather than
three separate caps.

**Register** — one of the four governance logs inside a project: deliverables,
change requests, risks and issues, and decisions. A register is where something
gets *decided* and stays findable, as opposed to chat, where it gets *said*.

**Seat** — one member of a workspace. Paid plans are billed per seat.

**Share link** — a tokenized link to a roadmap that grants viewing or
commenting, to someone who may have no account. It is never edit access, and it
never reaches chat, files or registers.

**Brief** — a written description of work to be done, which can be turned into a
project.

**Complimentary plan** — a paid tier granted by Proyekto rather than purchased.
It behaves exactly like that tier and shows a *Complimentary* badge.

## Where to go next

- [How roadmaps work](/docs/roadmaps-and-work/roadmaps-overview) — the four
  views of the hierarchy above
- [Project access and roles](/docs/projects/access-and-roles) — the ladder in
  full, and how to grant it
- [Plans](/docs/workspaces-and-plans/plans) — what each tier includes
