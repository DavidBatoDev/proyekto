A workspace is the top of the Proyekto tree. It owns your projects and your
teams, it holds the member list your plan is counted against, and it gives
every page under it a URL. Most people need exactly one. The thing worth
knowing before anything else is what a workspace deliberately does *not* do:
it grants nobody access to anything inside a project.

## What a workspace owns

Four things live at workspace level, and almost nothing else does.

**Projects.** Every project belongs to exactly one workspace. Creating a
project inside a workspace is what puts it on that workspace's plan and in
that workspace's project count.

**Teams.** A team is a reusable group of people, homed in a workspace and
owned by a person. See [Teams](/docs/teams-time-and-rates/teams).

**The member list.** Everyone who has joined. On a paid plan each member is a
billable seat — see [Members and seats](/docs/workspaces-and-plans/members-and-seats).

**The plan, and the usage counted against it.** Limits are counted per
workspace, not per person and not per project. Two workspaces on the same
account have entirely separate counts.

## Where a workspace lives

Workspace pages sit under `/w/<handle>/` — `/w/acme/dashboard`,
`/w/acme/teams`, `/w/acme/settings`. The handle is the short URL name the
workspace owner chooses, in lowercase letters, numbers and single hyphens.

The workspace switcher moves you between the workspaces you belong to, and
switching swaps the handle in the URL, which is why the dashboard, the team
list and the member list all change at once. If you belong to several, Proyekto
opens the first one you owned.

## The four settings tabs

| Tab | What it is for |
| --- | --- |
| **General** | The workspace name, its URL handle, and a description every member sees. |
| **Members** | Who is in the workspace, each person's workspace role, and pending invites. |
| **Usage** | What your plan includes and how much of it is in use. |
| **Billing** | The plan and the seats for this workspace. |

Usage and Billing are web pages. The installed mobile app carries no surface
that prices or sells a plan, so those two tabs are simply absent there while
General and Members are not — see
[The Proyekto mobile app](/docs/account-and-apps/mobile-app).

Editing General needs a workspace owner or admin, and changing the URL handle
needs an owner.

## Membership grants nothing inside a project

This is the single most common surprise, and it is on purpose:

> Being a member of a workspace gives you access to exactly nothing inside
> any of its projects.

The two are separate grants. A workspace member is part of your organisation
and occupies a seat. Project access is handed out per person, per project, on
the ladder **owner → admin → editor → commenter → viewer**, either directly or
by attaching a team and choosing who participates.

That separation buys two things. An outside consultant can deliver on one of
your projects without joining your workspace at all. And someone who joins on
Monday sees no client work until a person decides they should. The full rules
are in [Project access and roles](/docs/projects/access-and-roles).

## One workspace, or several

One is right for most organisations, including ones running many client
projects at once — project access already keeps clients apart, so a second
workspace adds administration without adding separation.

Run a second workspace when you need **separate billing** — a subsidiary or a
client who pays for their own — or when an organisation must be wholly
independent of yours, with its own member list and its own plan.

The cost of a second workspace is that nothing pools across the boundary.
Seats do not: somebody who works in both is a member of both. Projects and
teams belong to one workspace and are counted only there. Plans are per
workspace, so upgrading one does nothing for the other.

## Renaming, and changing the handle

The **name** is a label. Change it in General and it updates everywhere the
workspace is shown; nothing else moves.

The **handle** is part of every workspace URL, so only the owner can change
it. When it changes, every `/w/<handle>/…` link changes with it — and old
links keep working, redirecting to the new handle, so bookmarks and links
already pasted into chat still land in the right place.

## Where to go next

- [Members and seats](/docs/workspaces-and-plans/members-and-seats) — invites,
  roles and what a seat means
- [Plans](/docs/workspaces-and-plans/plans) — what each tier includes
- [Limits and usage](/docs/workspaces-and-plans/limits-and-usage) — what is
  counted, and why a limit never takes anything away
