Proyekto has two kinds of surface: the ones that belong to a single project, and
the ones that gather your work from everywhere. Knowing which is which answers
most "where is that page?" questions before you start hunting. This is the map.

## The dashboard

Your dashboard is the front door, and it opens on a single line telling you what
to do now — how many tasks are assigned to you, and your next meeting. There are
no vanity counters at the top; the counts sit in each section's own header, next
to the things they count.

Below that are three grids:

- **Projects** — everything you have access to in this workspace.
- **Roadmaps** — including roadmaps that are not attached to a project yet.
- **Teams** — the reusable groups you can attach to projects.

Down one side sits the **AI rail**: the assistant in workspace scope, which can
read across every project you have access to rather than just one. Ask it where
something stands, or have it draft work, and use `@` to point it at a specific
project, roadmap, work item or person. See
[Giving the assistant context](/docs/ai-assistant/context-and-mentions).

**Create project** and **Create roadmap** both live here.

## Workspace URLs and switching

Workspace-scoped pages carry the workspace in the path:

```
/w/<workspace-slug>/dashboard
/w/<workspace-slug>/teams
```

The switcher in the sidebar moves you between workspaces, and the URL changes
with it — so a link you paste into chat always opens in the workspace you meant.
Most people need exactly one workspace; a second is for genuinely separate
billing or a client kept entirely apart. See
[Workspaces](/docs/workspaces-and-plans/workspaces).

Projects and teams that reach you through project access rather than workspace
membership — a client's project you were invited into — appear under a **Shared
with you** heading in the sidebar rather than disappearing when you switch.

## Inside a project

Open a project and the sidebar becomes three groups. The grouping mirrors how
work actually runs: build it, talk about it, keep a record of it.

| Group | Pages |
| --- | --- |
| **Project** | Overview, Roadmap, Board, Timeline, Deliverables |
| **Collaborate** | Team, Chat, Resources |
| **Management** | Change Requests, Decisions, Risks & Issues, Activity |

**Behind the gear**, pinned at the bottom of the rail, are the two pages you
visit far less often: **Time logs** and **Settings**. They are deliberately out
of the main list — settings is not a destination you navigate to by accident.

A full tour of each page is in
[Inside a project](/docs/projects/inside-a-project).

## Surfaces that are not inside a project

These gather work from everywhere you have access, and they never live under a
project:

- **[Command center](/docs/roadmaps-and-work/command-center)** — every task
  assigned to you, across every project. The project **Board** is per roadmap;
  this is the cross-project one, and it is the difference people most often miss.
- **[Inbox](/docs/chat-and-meetings/direct-messages-and-inbox)** — direct
  messages and mentions from every project in one list.
- **[Meetings](/docs/chat-and-meetings/meetings)** — your whole calendar in day,
  week, month or year, not just one project's.
- **Teams** — your reusable groups, at `/w/<slug>/teams`. See
  [Teams](/docs/teams-time-and-rates/teams).
- **[Notifications](/docs/account-and-apps/notifications)** — the bell in the
  header, and the full list behind it.

## Why a sidebar item is missing for you

If someone describes a page you cannot find, there are exactly two causes. Check
them in this order:

> 1. **A permission is off.** 2. **Your plan does not include it.**

**A permission is off.** Project access runs on the ladder owner → admin →
editor → commenter → viewer, and on top of it each person has individual
permissions that a project owner or admin can switch off. Switching one off
hides that page from the sidebar entirely rather than showing a locked screen —
so the page does not exist as far as your sidebar is concerned. See
[Fine-tuning permissions](/docs/projects/permissions).

**Your plan does not include it.** Some surfaces — the governance registers, time
tracking and a few others — belong to particular tiers. See
[Plans](/docs/workspaces-and-plans/plans). Worth saying plainly: a plan limit
only ever blocks something *new*. Nothing you already have is removed, hidden or
downgraded by reaching one, and everything already there stays readable and
editable. See [Limits and usage](/docs/workspaces-and-plans/limits-and-usage).

Nothing else hides a page. If it is neither of those two, the item is where the
table above says it is.

## On mobile

The iOS and Android apps run the same Proyekto, so the map above still holds —
it just folds differently. Inside a project, the bottom bar carries five items:
**Overview, Roadmap, Board, Timeline, Chat**. Everything else in the three
groups — Resources, Deliverables, Change Requests, Risks & Issues, Decisions,
Team, Activity, Time logs and Settings — is one tap away under **More**.

Five is the ceiling because a sixth label stops being legible, not because the
other pages are less important.

The app deliberately leaves out the marketplace and every page that sells or
prices a plan; those stay on the web. See
[The Proyekto mobile app](/docs/account-and-apps/mobile-app).
