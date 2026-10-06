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
| **Owner** | Everything below, plus the things that move money or decide approval — the team's billing identity, its default currency, the member-rates and payouts switches, the billing and pay cut-offs, and, among the team rules, the approvers, whether approval is required, the retroactive window and rounding. Only the owner can delete the team. |
| **Admin** | The team's name, photo, description, labels and status; its members and invites; its attached projects; whether time tracking is on, and the team rules for the timesheet period and manual time. Admins also see the team's time report, manage rates and record payouts — and approve the team's timesheets when the team approves its own time. |
| **Member** | Nothing about the team itself. A member takes part in projects the team is on and tracks their time for the team on the Time page. |

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

The attach dialog also says where the team's time on the project will be
decided: "Time this team logs here is approved in Acme. Approvers who can't
open this project see hours only." The approvers are the team's workspace
owners and admins (or, on Business, possibly the team itself), and they do
not need access to the project to approve its hours.

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
- **Time** — whether time tracking is on for this team; on Business, the
  team rules that override the workspace's time policy (who approves, the
  timesheet period, manual time, the retroactive window, rounding); and, on
  the web, the money settings — member rates, payouts, billing and pay
  cut-offs, and the default currency. See
  [time policy and team rules](/docs/teams-time-and-rates/time-policy).
- **Logs** — the team's own audit trail, separate from any single project's
  [activity](/docs/delivery-governance/activity).

## The team's Time pages

A team's time is tracked on the **Time** page like everyone else's — members
choose the team in the For chip and submit from there. What the team itself
keeps is the management side, for its owner and admins, behind the team's
**Time** item in the sidebar:

| Page | What it shows |
| --- | --- |
| **Report** | Everything members logged for the team, filtered and grouped by person, project, task, day or week, with Approved and Not yet approved kept apart. An hours-only **Under agreements** line covers agreement work assigned through the team |
| **Rates** | The members' [rates](/docs/teams-time-and-rates/rates-and-currency), while member rates are on |
| **Payouts** | Recording [payments](/docs/teams-time-and-rates/payouts), while payouts are on |

A member who opens the team's Time page is taken to their own time for the
team instead. In the app only Report is shown; rates and payouts stay on the
web. Old links to the team's My Logs and Team Logs pages still work and land
in the right new place.

## Teams and your plan

Your plan sets how many teams a workspace can hold. Personal teams are not
counted.

> At the team limit, creating a **new** team is blocked. Every team you
> already have stays exactly as it is — same members, same attached projects,
> same rates and time, all still editable.

A team's time needs Pro: on Free, members track time just for themselves.
Business adds **team rules** — including a team approving its own time —
member rates that price approved time, and payouts.

Business also adds **private teams and guests**: teams that are not visible to
the rest of the workspace, and people brought in for one piece of work. See
[plans](/docs/workspaces-and-plans/plans) and
[limits and usage](/docs/workspaces-and-plans/limits-and-usage).

## Where to go next

- [Project access and roles](/docs/projects/access-and-roles) — what the roles
  a team grants actually permit
- [Tracking time](/docs/teams-time-and-rates/time-tracking) — logging time
  for a team
- [Approving time](/docs/teams-time-and-rates/approving-time) — who decides a
  team's timesheets
