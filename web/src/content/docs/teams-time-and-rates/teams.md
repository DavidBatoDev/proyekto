A team is a reusable group of people. You create it once, and then attach it
to as many projects as you need instead of granting access to the same five
people over and over. A team lives in a workspace and is owned by a person —
it is not the workspace member list, and it is not the project Team page.

## What a team is, and what it is not

A team has a name, a photo, a description and freeform labels, and a list of
people with a role each. It belongs to a workspace, so it can only be attached
to projects in that workspace. It is owned by the person who created it, and
ownership is what separates a team from the workspace around it: the workspace
owner does not automatically run your team.

Joining a team grants nothing inside any project. That is the same rule as
[membership is not access](/docs/workspaces-and-plans/members-and-seats) —
what grants project access is being put on a project *through* the team, which
is the mechanic further down this page.

## Roles inside a team

| Role | What it can change |
| --- | --- |
| **Owner** | Everything below, plus the things that move money — the team's billing identity, its default currency, the retroactive-logging window and the cut-off schedule. Only the owner can delete the team. |
| **Admin** | The team's name, photo, description, labels and status; its members and invites; its attached projects; whether time tracking is on. Admins also review time logs and manage rates and payouts. |
| **Member** | Nothing about the team itself. A member takes part in projects the team is on and logs their own time. |

There is exactly one owner — the creator — and admins are promoted from the
member list.

## Adding people

Invite by email from the team. Proyekto looks the address up, so an existing
account gets a notification and an email and a new address gets an invitation
to sign up. You choose the role they will hold and, optionally, a position
label and a short message.

The invite sits as **pending** until the person accepts, declines, or you
cancel it. If the email cannot be delivered the invite still exists and the
person can accept it in-app, so you are told about the delivery failure rather
than the invite silently disappearing.

Accepting adds them to the team's member list. It does **not** put them on any
project yet.

## Attaching a team to a project

This is the part worth reading twice.

> Putting someone into a team's participation on a project grants them access
> to that project. Taking them out takes it away.

From a project's Teams page you can **attach** a team you are already on — you
pick which of its members take part and what project role each one gets, and
it takes effect immediately. If the team is one you are not on, you **invite**
it instead: you cannot see someone else's team, so the person who runs it
chooses which team and who comes along, while you still set the access those
people get. Nothing changes until they accept.

Curating the list is the whole workflow. Add a team member to the project and
they get access, with an origin of "from a team" recorded on the grant so it
is obvious where it came from. Remove them and the access goes with it —
unless they also hold direct access, or are on another attached team, in which
case they keep what that other route gives them.

Detaching the whole team asks you which outcome you want: detach and let
access fall away, or **detach and keep members**, which converts them to
direct project members first. The dialog names exactly who would lose access
either way before you confirm. The team itself is untouched and can be
attached again later.

## Team settings

Four tabs, behind the team's gear:

- **General** — name, photo, description, labels and status, and the billing
  identity used when a project bills through this team. Deleting the team
  lives here too, for the owner only.
- **Projects** — every project this team is attached to, with the same detach
  choices in bulk.
- **Time** — whether time tracking is on for this team, and beneath it the
  member-rates and payouts switches, the retroactive-logging window, the
  default currency and the cut-off schedule. See
  [time tracking](/docs/teams-time-and-rates/time-tracking).
- **Logs** — the team's own audit trail, separate from any single project's
  [activity](/docs/delivery-governance/activity).

## Teams and your plan

Your plan sets how many teams a workspace can hold. Personal teams are not
counted.

> At the team limit, creating a **new** team is blocked. Every team you
> already have stays exactly as it is — same members, same attached projects,
> same rates and logs, all still editable.

Business adds **private teams and guests**: teams that are not visible to the
rest of the workspace, and people brought in for one piece of work. See
[plans](/docs/workspaces-and-plans/plans) and
[limits and usage](/docs/workspaces-and-plans/limits-and-usage).

## Where to go next

- [Project access and roles](/docs/projects/access-and-roles) — what the roles
  a team grants actually permit
- [Time tracking](/docs/teams-time-and-rates/time-tracking) — logging and
  approving a team's hours
