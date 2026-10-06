Every workspace has one **time policy**: how its time is grouped into
timesheets, in which timezone, whether it needs approval, and what counts as
acceptable time. Teams follow it unless, on Business, they set their own
rules. Agreements bring their own terms, and those win. This page covers all
three, and the order they apply in.

## Which rules apply

Rules are resolved field by field — the period might come from the workspace
while the rounding comes from the team — in this order, each layer overriding
the one before:

1. **Proyekto's defaults** — weekly from Monday, approval required, manual
   time allowed with no limit on how far back, no rounding, and a reminder one
   day after each period ends.
2. **The workspace's time policy.**
3. **The team's rules**, on Business, for time logged for that team.
4. **A team member's hour limits** on a project — their weekly or monthly
   cap.
5. **The agreement's terms**, for time logged under an agreement. These come
   from the signed agreement and override team and workspace rules.

**Who approves this time**, on any For chip, shows the result for one piece
of time, with each line tagged with where it came from.

## The workspace time policy

Open the workspace's settings and choose **Time**. Owners and admins can
change the policy; every other member sees it read only, with "Only workspace
owners and admins can change the time policy."

The first time an owner or admin opens Time on a workspace with timesheets, a
card asks them to confirm what Proyekto set up — "Acme tracks time weekly
from Monday in Asia/Manila." — with **Looks right** and **Change**. It is a
confirmation, not a setup step: time is tracked under those settings either
way.

The policy has three parts.

**Timesheets**

| Setting | What it does |
| --- | --- |
| **Time on workspace projects** | Whether people on the workspace's projects who are not on a team can log for the workspace. Off, they can only track time for themselves |
| **Timesheet period** | Weekly, every two weeks, twice a month (1–15 and 16–end) or monthly |
| **Week starts on** | The first day of a week, for weekly and two-weekly periods |
| **Timezone** | The timezone days and periods are counted in |
| **Reminder** | How many days after a period ends people are reminded to submit (1–14) |

**Approval**

| Setting | What it does |
| --- | --- |
| **Approval** | Required, or not. Approvers are the workspace's owners and admins. When approval is off and the time carries no cost, timesheets approve themselves |

**Adding time**

| Setting | What it does |
| --- | --- |
| **Manual time** | Whether people can add time they have already worked, and how many days back (0 means no limit). Timers are unaffected |
| **Rounding** | None, or 5, 6, 10, 15 or 30 minutes. Each entry rounds to the nearest step, ties rounding up, when its timesheet is approved |
| **Weekly limit** | Optional. People see a warning past it — "Acme has a 40h weekly limit. You've logged 41h this week." — but it never blocks or cuts time |
| **Presets** | Which of Meeting, Review, Admin and Other are offered for work that is not on a task |

> Changes to the period, timezone or week start apply from the next period —
> "Applies from Mon Oct 12. Open timesheets keep their dates." A timesheet
> never changes shape halfway through.

Every save is recorded. For owners and admins, the **History** line under the
form shows the latest change — "Changed by Ana Reyes, Oct 2: period weekly → twice a month" — and
**Show all** lists the rest, including team rule changes. Confirming the
settings without changing them is recorded as "Confirmed (no changes)".

The policy page also has a **Report** tab with the workspace's time report,
which comes with Business — see
[approving time](/docs/teams-time-and-rates/approving-time).

### On Free

Free includes personal time, not timesheets, so most of the policy is shown
but cannot be changed: "Everyone can still track time just for themselves."
The timezone and the week start stay editable.

## Team rules (Business)

A team's own settings — the gear on the team, then **Time** — start with a
**Time tracking** switch that the team's owner and admins control. With it
off, nobody can log for the team: "Members can't log for this team while time
is off. They can still track time just for themselves."

Below it, **Team rules** let a team override the workspace on Business. Each
row says what it inherits — "Use Acme's policy (Weekly · Mon · Asia/Manila)"
— until someone presses **Override**, after which it reads "Override for this
team" and can be reset back to the workspace's value.

| Rule | What it controls |
| --- | --- |
| **Approvers** | The workspace's owners and admins, or **this team's owners and admins** |
| **Timesheet period** | The period, week start and timezone for the team's timesheets |
| **Manual time** | Whether members can add time they already worked |
| **Retroactive window** | How many days back that time can go |
| **Rounding** | The rounding step at approval |
| **Approval** | Required, or not |

The team's owner sets the approvers, approval, the retroactive window and
rounding; admins can change the period and manual time. Approval cannot be
switched off while member rates are on — "Stays on while member rates are
on." — because priced time always needs someone to agree to it.

A team with its own rules gets its own timesheets, shown under the team's
name, instead of sharing the workspace's.

> Without Business, team rules are read only and nothing stored is lost:
> "Saved rules apply again when Acme is on Business." Until then the team's
> time follows the workspace policy and goes to the workspace's owners and
> admins.

The team's **Money** settings — member rates, payouts, billing and pay
cut-offs and the default currency — sit underneath, on the web. See
[rates and currency](/docs/teams-time-and-rates/rates-and-currency) and
[payouts](/docs/teams-time-and-rates/payouts).

## Agreement terms

Time logged under a client or talent agreement follows that agreement's
terms: who approves, whether manual time is allowed, rounding, a weekly
limit, and the period. They are read only in Proyekto and shown wherever the
rules are — the For chip's popover and the timesheet's rules line — and on
the web **View terms** opens the agreement itself. A project's Settings ›
Time also shows how much of the approved time each client agreement shares
with the client: "These come from the signed terms."

Where an agreement leaves the period or timezone unset, it falls back to the
policy of the workspace the agreement belongs to, never the project's.

## Limits that warn and limits that cut

Three kinds of limit, two behaviours:

- **A workspace's weekly limit** only warns. People see it when they add time
  and approvers see it on the review screen; nothing is ever cut.
- **An agreement's weekly limit** cuts paid time at approval, unless the
  approver ticks the box to approve the overtime.
- **A team member's hour limits** — weekly or monthly, set per person in a
  project's Settings › Time — also cut paid time at approval unless the
  overtime is approved. While people add time they only warn, unless "Block
  time past a limit (otherwise people just get a warning)" is switched on,
  which refuses time past them instead.

## Where to go next

- [Timesheets](/docs/teams-time-and-rates/timesheets) — what the period and
  approval settings do to your time
- [Approving time](/docs/teams-time-and-rates/approving-time) — overtime,
  limits and reports in practice
- [Teams](/docs/teams-time-and-rates/teams) — who owns and administers a team
- [Plans](/docs/workspaces-and-plans/plans) — what Free, Pro and Business
  include
