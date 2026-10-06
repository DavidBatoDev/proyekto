Approving is where tracked hours become final. A timesheet arrives when its
person submits it; you read it day by day, then either approve it — which
fixes its hours and any amounts — or return it with a note saying what to
change. Everything happens on the **Time** page and the timesheet's own review
screen, on the web and in the app.

## Who approves what

The approvers of a timesheet are fixed at the moment it is submitted, from the
rules in force then.

| Timesheet | Who decides it |
| --- | --- |
| **Workspace** — workspace time, and team time on Pro | The workspace's owners and admins |
| **Team** — a team with its own rules (Business) | The team's owners and admins, if the team's rules say the team approves; otherwise the workspace's owners and admins |
| **Talent agreement** | The hirer named on the agreement |
| **Client agreement you deliver yourself** | Nobody — submitting confirms the hours |

Two rules sit on top of that table:

> Nobody approves their own time when it carries a cost. When a team approves
> its own time and member rates are on, a team owner's or admin's own
> timesheet goes to the team's other owners and admins; if there are none, it
> goes up to the workspace's owners and admins — and if there is nobody else
> at all, it waits with "No one else can approve this. Add a workspace admin."

When time carries no cost and you are the only person who could approve it,
it approves itself — see
[timesheets that send themselves](/docs/teams-time-and-rates/timesheets).

## Where approvals show up

You do not have to go looking. A submitted timesheet reaches its approvers in
several places at once:

- the **Time** item in the sidebar, whose badge counts what is waiting
- **Waiting for you · N** at the top of the Time page, and the Waiting for
  you section further down it
- the dashboard's **Waiting for your approval** card, with **Review all**, and
  "· 3 timesheets waiting" in the welcome line
- a **Timesheet to review** notification, and an email

If you approve but have not logged any time yourself in the last 30 days, Time
opens in **approver mode**: what is waiting, then **Decided in the last 30
days**, and a single Start timer button for when you do need one. With
nothing waiting it reads "You're all caught up."

## Reviewing a timesheet

Each row in Waiting for you opens the timesheet's review screen. The person
who submitted it sees the same screen, so you are both looking at the same
facts.

- **The header** names the person, what the timesheet is for and its period,
  with when it was sent and its total, and the **rules at submit** — period,
  who approves, how far back manual time could go, and rounding.
- **The grid** lays the period out as projects by days, with totals. A day
  over 8 hours is marked ⚠. Click a cell, a row total or a day total to list
  just those entries.
- **The flags line** collects what deserves a second look — days over 8
  hours, entries of 10 hours or more, timers stopped automatically, entries
  added after their day — and **Show flagged** lists the flagged entries.
- **Weekly limit** lines show the time against any weekly limit.
- **The entries** list, oldest first. Open one to read its details and its
  comment thread.
- **History**, oldest first: submitted, returned, resubmitted, approved,
  reopened, each with its note.

> If you cannot open one of the projects, you still see the hours. Those
> entries are merged into a "Projects you can't open" row, and their task and
> note read "A project you can't open".

People who can see cost — a team's owners and admins when member rates
price the team's time, a talent agreement's hirer — also see **Estimated
cost**, one line per currency, marked "final at approval". Workspace owners and admins never see
cost through time.

## Approving and returning

**Approve…** takes an optional note. Approval rounds each entry by the
rounding rule, applies any limit that cuts paid time, prices each entry at the
rate in force on its day, and freezes the lot — the toast reads "Approved ·
38:15 frozen". After that, the hours and amounts on the timesheet do not
change, whatever happens to rates later.

**Return…** needs a note — "What should Maria change?" — and the button,
which names the person (**Return to Maria**), waits until you have written
one. The timesheet goes back to them, amber, with your note on it.

Once approved, a timesheet can still be **reopened** by an approver, again
with a required note, which sends it back as Returned. Time that has already been paid
or billed cannot be reopened until that is undone — see
[reopening](/docs/teams-time-and-rates/timesheets).

## Overtime

Some limits only flag time; others cut what gets paid.

- A **workspace or team weekly limit** is an indicator: "Weekly limit 40h
  (Acme) · 38:15 logged · within limit". It never cuts anything.
- An **agreement's weekly limit**, or a **member's weekly or monthly cap** on
  a team, does cut. When a timesheet goes over one, an extra panel appears —
  "Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30
  over" — with a box: **Approve the 3h 30m over the limit**.

Left unticked, only the time up to the limit is approved for payment, and the
extra time stays on record. Ticking it approves the overtime too, and the
timesheet is marked "Overtime approved".

## Approving several at once

Tick timesheets in Waiting for you and press **Approve selected**. Three kinds
cannot be ticked, and say why:

- "Has flags. Open it to review." — an entry of 10 hours or more, a timer
  Proyekto stopped, or a timer still running
- "Over the limit. Open it to decide the overtime."
- "Not checked against the limit yet. Open it to review." — Proyekto couldn't
  finish checking it against its limits when the list loaded

A bulk approval is all or nothing. If any one of the timesheets changed while
you were choosing, none are approved — "Nothing was approved: Leo Cruz's
timesheet changed." — with a link to that one. There is no bulk return,
because every return needs its own note.

## When a timesheet changes under you

If the person withdraws, edits and resubmits while you are reading, the
screen says so — "Maria changed this timesheet while you were looking." —
and the decision buttons wait until you press **Review the latest**. You never
approve a version you did not see.

## Reports

Approving is one timesheet at a time. Reports are the same time viewed across
people and periods. Every report keeps **Approved** and **Not yet approved**
apart and never adds them together, so an unapproved hour can never be
mistaken for a settled one.

| Report | Where | Who can open it |
| --- | --- | --- |
| **Team** | The team's Time page → **Report** | The team's owners and admins |
| **Workspace** | Workspace settings → Time → **Report** | The workspace's owners and admins, on Business |
| **Project — Everyone** | The project's **Time** page | People allowed to see everyone's time on the project |
| **Project — Client hours** | The project's Time page | The client, when their agreement shares hours |

Reports filter by date range, person, status and, where it applies, what the
time was for, and group by person, project, task, day or week. A team report
adds an hours-only **Under agreements** line for agreement work done through
the team, and offers the team's pay cut-offs as date ranges when payouts are
on.

On Project › Time, time that placed talent logs under an agreement shows its
person only to the talent and the delivery side of the agreements; everyone
else, the client included, reads "Delivery team". A consultant's own time on
a client agreement always shows their name. **Client hours**
never names anyone and never shows cost: depending on the agreement, the
client sees hours by week or each entry's date, task and hours.

**Export** to CSV or Excel comes with Business, on the web.

## Where to go next

- [Timesheets](/docs/teams-time-and-rates/timesheets) — the same timesheet
  from the side of the person who sent it
- [Time policy and team rules](/docs/teams-time-and-rates/time-policy) — who
  approves, and the rules a timesheet is checked against
- [Payouts](/docs/teams-time-and-rates/payouts) — what happens to approved
  team time next
- [Plans](/docs/workspaces-and-plans/plans) — approvals, team approvers and
  reports by tier
