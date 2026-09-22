Proyekto is one place to plan a piece of work, deliver it with the people doing
it, and keep a record of what was agreed along the way. You write a roadmap —
epics, features and tasks — and around that roadmap sit the team, the chat, the
meetings, the time logged against it and the registers where scope changes and
decisions get written down. An AI assistant drafts and edits that roadmap with
you, and never changes it behind your back.

It is built for work that someone is accountable for delivering: an internal
team shipping a product, or a consultant delivering for a client.

## Three containers, top down

Proyekto nests three things, and almost every question about "where does this
live?" is answered by knowing which one you are in.

| Container | What it is | What it holds |
| --- | --- | --- |
| **Workspace** | Your organisation and its plan | Projects, teams, the member list |
| **Project** | Where delivery happens | A roadmap, the people on it, chat, meetings, resources, registers |
| **Roadmap** | The plan itself | Epics → features → tasks |

A workspace carries the plan and its member list, and each member is a billable
seat. A project is the unit of delivery. A roadmap is the tree of work inside
it — and a roadmap can also exist on its own, before a project is wrapped around
it, which is how most work actually starts.

### A workspace seat grants nothing inside a project

This is the one thing worth reading twice, because it is the source of most
confusion in the first week:

> Adding someone to your workspace does not let them see a single project.

The two are deliberately separate. Workspace membership says "this person is
part of our organisation". **Project access is a separate grant, made person by
person, per project**, on a ladder of owner → admin → editor → commenter →
viewer, with individual permissions that can be switched on or off on top.

That separation is what lets an outside consultant deliver on your project
without joining your workspace, and what lets a new hire join on Monday without
instantly seeing every client's work. See
[Project access and roles](/docs/projects/access-and-roles).

## What is AI-assisted, and what is not

The assistant is good at two things. It **drafts and edits roadmaps** — describe
what you are building and it produces epics, features and tasks, or reshapes the
ones you already have. And it **answers questions grounded in your actual work**
rather than in general knowledge, because it reads the projects and roadmaps you
can already see.

What it does not do is change your structure without asking:

> Every structural edit is two-stage. The assistant shows you a semantic diff of
> what it proposes, and nothing lands until you commit it.

You read the diff, then commit or discard. After a commit, the change is still
recorded and can be rolled back. Everything the assistant touches obeys your own
permissions — it can never do something in a project that you could not do
yourself. See [The AI assistant](/docs/ai-assistant/overview) and
[Reviewing and committing AI changes](/docs/ai-assistant/reviewing-changes).

The rest of Proyekto is not AI-driven. Tasks, statuses, time logs, meetings and
registers are yours to write.

## Who it is for

**An internal team planning delivery.** One workspace, a project per initiative,
a roadmap per project. The board and the timeline are the two views people live
in; the registers catch the decisions that would otherwise vanish into chat.

**A consultant delivering for a client.** Here the workspace/project split earns
its keep. You keep your own workspace and your own teams, and you are granted
access to the client's project — or you grant the client access to yours, at
viewer or commenter, with a share link if they have no account at all. Time,
rates and the governance registers exist because a client eventually asks what
was agreed, what changed, and what it cost.

## What Proyekto deliberately does not do

**It does not take or hold money.** There is no in-app payment of any kind.
Proyekto records what was invoiced and lets you mark it paid; the money itself
moves through whatever you already use. Being a record rather than a payment
processor is a deliberate choice, not a gap.

**It is not a general file store.** You can attach files to tasks, comments,
chat messages and a project's resources library, close to the work they belong
to. It is not where your whole company's documents should live.

**It is not a lightweight personal to-do app.** The hierarchy, the derived
feature statuses and the access ladder all assume more than one person is
accountable for the outcome.

## Where to go next

- [Quickstart](/docs/start-here/quickstart) — sign up to a real roadmap in about
  ten minutes
- [Core concepts](/docs/start-here/core-concepts) — the vocabulary, defined once
- [Finding your way around](/docs/start-here/navigating-proyekto) — a map of
  every surface
- [Plans](/docs/workspaces-and-plans/plans) — what each tier includes
