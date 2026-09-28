This is the shortest path from nothing to a roadmap with real tasks on it and a
colleague working alongside you. It takes about ten minutes, and it deliberately
walks through the one step that trips almost everybody — adding a person to your
workspace is not the same as giving them access to your project.

## You can start before you have an account

The chat box on the Proyekto home page works without signing in. Describe what
you are building and the assistant drafts a roadmap for you there and then, as an
anonymous guest.

A guest roadmap is real, but fenced:

- It is **read-limited** — a guest sees its own roadmap and nothing else in
  Proyekto.
- It is **rate-limited**, so a guest gets fewer assistant messages than an
  account does.
- It **expires after 30 days**.

When you sign up in the same browser, that roadmap **migrates to your new
account** and becomes an ordinary roadmap you own. Nothing is retyped.

> If you already know roughly what you are building, starting as a guest is the
> fastest way in: you arrive at signup with a draft instead of a blank page.

## 1. Sign up

Sign up with an email address and password, or with Google. Both work on every
plan.

First run takes a few short steps — a little about what you do, then **naming
your workspace**, then an optional invite step. A workspace is created for you
automatically, so you never stare at an empty account. You land on your
dashboard at `/w/<your-workspace>/dashboard`.

If you built a roadmap as a guest, it is waiting for you there.

## 2. Create a project

A roadmap on its own is fine for thinking. A **project** is what you need the
moment other people, chat, meetings or records are involved. There are three ways
to start one:

| Start from | Use it when |
| --- | --- |
| **Blank** | You know the shape of the work and will draft the roadmap yourself |
| **An existing roadmap** | You already have a roadmap — including the one you drafted as a guest — and want a project wrapped around it |
| **A brief** | You have a written description of the work and want it turned into a project |

Use **Create project** on the dashboard. If you are starting from a roadmap you
already have, you can link it to the project instead of building a second one —
only roadmaps that are not already attached to a project are offered. See
[Creating a project](/docs/projects/creating-a-project).

## 3. Draft the roadmap with the assistant

Open the project's **Roadmap** page and talk to the assistant in plain language:
*"Two-month rebuild of our checkout — payments, address validation, and a
post-purchase upsell."*

Then do the part that matters:

1. **Describe** what you want, at whatever level of detail you have.
2. **Read the preview.** Structural edits are two-stage — the assistant shows you
   a semantic diff of exactly what it will add, change or remove.
3. **Commit** if it looks right, or discard it and say what was wrong.

Nothing is applied until you commit, and a committed change can still be rolled
back afterwards. See
[Reviewing and committing AI changes](/docs/ai-assistant/reviewing-changes).

Aim for **epics as initiatives** ("Checkout", "Onboarding"), not technical layers
("Frontend", "Database"). Put the dates on **features**. Then break features into
tasks — and do not look for a feature status field, because there isn't one: a
feature's status is derived from its tasks. See
[Core concepts](/docs/start-here/core-concepts).

## 4. Add one person — and the step everyone misses

Invite a colleague to your workspace from workspace settings. Then stop, because
this is where people get stuck:

> A workspace invite gives someone a seat in your organisation. It gives them
> access to **no projects at all**.

Project access is granted separately, on the project's **Team** page, one person
at a time, at a level on the ladder owner → admin → editor → commenter → viewer.
Give a teammate **editor** so they can move tasks; give a client **commenter** so
they can respond without reshaping the plan.

Two shortcuts worth knowing:

- Attaching a **team** to a project and choosing which of its members participate
  grants those people project access automatically — the fastest way to bring on
  five people at once. See [Teams](/docs/teams-time-and-rates/teams).
- If someone only needs to *look*, send a
  [share link](/docs/roadmaps-and-work/sharing-a-roadmap) instead. It grants
  viewing or commenting on the roadmap only, never editing, and never reaches
  chat, files or registers.

## 5. Where the work shows up

Once tasks exist and are assigned, the same data appears in three places you will
use daily:

- **[Board](/docs/roadmaps-and-work/board)** — this roadmap's tasks in columns by
  status: To do, In progress, In review, Done, Blocked. Drag between them.
- **[Timeline](/docs/roadmaps-and-work/timeline-and-milestones)** — features over
  time, with milestones, so you can see what slips.
- **[Command center](/docs/roadmaps-and-work/command-center)** — every task
  assigned to *you*, across every project you have access to. This is the one to
  open in the morning.

## Next

- [Finding your way around](/docs/start-here/navigating-proyekto) — every other
  surface, and why one might be missing for you
- [Inside a project](/docs/projects/inside-a-project) — chat, meetings, resources
  and the registers
- [Plans](/docs/workspaces-and-plans/plans) — what each tier includes
