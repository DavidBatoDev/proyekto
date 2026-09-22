Time in Proyekto is tracked by a team, against the projects that team is
attached to. A log says who worked, on which project and task, for how long —
and then moves through review. Time tracking is part of Pro and above, and a
team owner or admin switches it on from the team's Time settings before
anything appears.

## Logging time

Two ways in, and both produce the same kind of log.

**Run the timer.** Start it on a task and it runs until you stop it. You can
take a break mid-session, which freezes the work clock and records the break
separately, so the duration that lands on the log is working time rather than
elapsed time.

**Add past work.** Pick the project, then optionally the epic, feature and
task — there is a *general time* option for work that does not belong to one
task — and enter a time-in, a time-out and any break minutes. A team can limit
how far back a manual log is allowed to reach; if it does, dates outside that
window are refused, and an owner sets the window in team settings.

Every log carries the project, the task if there is one, the date and
duration, and the note or comments left on it during review.

## My logs and Team logs

The team's Time section has up to four tabs, and which ones you see depends on
what you are:

| Tab | Who sees it |
| --- | --- |
| **My Logs** | Every member of the team — your own entries, and nobody else's. |
| **Team Logs** | The team owner and team admins. |
| **Manage Rates** | Owner and admins, when member rates are on. |
| **Payouts** | Owner and admins, when payouts are on. |

Team Logs is the review surface: everyone's entries, filtered by status,
member, project, task status or date range, with running totals of hours and —
where rates are set — fees, per currency.

## Approval states

A log is always in one of four states.

| State | Meaning |
| --- | --- |
| **Pending** | Submitted, waiting for review. Every new log starts here. |
| **Approved** | Accepted by a reviewer. Approved time is what a payout can draw on. |
| **Rejected** | Turned down, with the reviewer's reason on the log. |
| **Paid** | Covered by a recorded [payout](/docs/teams-time-and-rates/payouts). |

The moves between them are deliberately narrow:

- **Pending → Approved or Rejected.** Only the team owner or a team admin can
  make this move, and **nobody can review their own logs** — even the owner.
- **Approved → Paid** happens only by recording a payout. There is no button
  that marks a log paid on its own.
- **Anything → Pending.** A reviewer can send a log back, which clears the
  review and reopens it for editing.

Rejecting a log notifies the person who logged it, and a reason is the point
of the state, so write one.

## How Proyekto decides what is billable

A log's amount is frozen onto it the moment it is created — the rate and the
currency are copied onto the entry rather than looked up later. Resolution
runs in this order:

1. **Which team.** The team you belong to on that project. If the project has
   a primary team, that one wins.
2. **Which rate.** That team's active rate for you on that project, which
   supplies the work rate, the training rate and the currency. Tasks marked as
   training resolve at the training rate.
3. **No rate set?** The log still records fine. It carries no amount, and
   takes the project's currency so it lines up when a rate arrives later.

If the team has member rates switched off, hours are tracked and no amounts
are calculated at all — some teams only want the hours. Rate setup is covered
in [rates and currency](/docs/teams-time-and-rates/rates-and-currency).

A rate can also carry a weekly or monthly hour cap. Going over it does not
block the log; it flags the entry as over the cap, and can mark it as needing
approval for the overtime.

## Editing and deleting an entry

You can edit or delete your own log **while it is pending** — the time-in,
time-out, break, task and note are all still yours to change. Changing the
task re-resolves the rate, because the new task may sit on a different project
or be training rather than work.

Once a log is approved, rejected or paid, it is locked. Editing it means
asking a reviewer to move it back to pending first, and the error says so.
That is what makes an approved timesheet mean something: an approved figure
cannot quietly change underneath the person who approved it.

## On the Free plan

The Time pages are not shown on Free, and a team cannot switch time tracking
on without the feature in its workspace's plan.

> Nothing that was already logged is lost. A team that tracked time and then
> moved to a plan without it keeps every entry, and they come back exactly as
> they were on a plan that includes it.

See [plans](/docs/workspaces-and-plans/plans) for what each tier includes.
