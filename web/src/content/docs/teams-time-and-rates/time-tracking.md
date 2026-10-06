Time in Proyekto lives on one page: **Time**, in the main sidebar. Whatever
the time is for — your team, your workspace, an agreement with a client, or
nobody but you — you start timers, add time you have already worked and see
your week in the same place. A time entry says who worked, on which project
and task, and for how long. Its **For** tag says who, if anyone, approves it.

Tracking time just for yourself works on every plan, Free included. Sending
team and workspace time for approval is what the plans add (time under an
agreement is never limited by plan) — see
[timesheets](/docs/teams-time-and-rates/timesheets).

## Who can track time

Tracking time on a project needs the **Log time** permission, which editors
and above have by default and a project admin can switch off for one person
([fine-tuning permissions](/docs/projects/permissions)). Viewers and
commenters can read their own past entries but cannot add new ones; the
timer buttons say so, with "Ask a project admin for editor access to log
time."

The Time item appears in the sidebar when you can track time on at least one
project, when timesheets are waiting for your approval, or when you look after
a workspace's time policy. Its badge counts the timesheets waiting for you.
Guests never see it.

## Starting a timer

Start a timer from a task — on the roadmap, the timeline or the task's own
panel — or with **Start timer** on the Time page, where you pick the project
and then the task. Work that is not on a task gets a preset instead: **Meeting**,
**Review**, **Admin** or **Other**. A workspace can hide presets it does not
use.

> There is only ever one timer. Starting another asks "Stop *Fix login bug*
> (1:12) and start this?", and **Switch** does both in one step.

While a timer runs you can take a break: the work clock freezes and the break
is recorded separately, so the entry counts working time, not elapsed time.
The running timer sits in a bar at the top of Time and in a small floating
card on your other pages, with **Open in Time** to jump to the entry.

Long timers are caught rather than trusted. At 10 hours the entry joins
**Needs review** and you get a "Timer still running" notification. At 24
hours Proyekto stops it for you — "Stopped automatically after 24 hours.
Check the end time." — and a timer running under an agreement stops when your
assignment under it is ended.

## Adding time you have already worked

**Add time** opens a form with an exact start and end, any break, and a note.
Times are entered in the timezone of whatever the time is for, and the form
says so when that is not your own.

On a wide screen there is also a quick-add row under the toolbar: a task or
preset, a duration (`1:30`, `90m` and `1.5h` all work), a day — today,
yesterday or one of the five before — and For. The start defaults to the end
of that day's last entry, or 09:00. **More options** opens the full form. On a
phone, the **Track time** button offers Start timer and Add time.

The rules for what you are logging for can limit manual time, and the form
says so in place rather than failing on save: "Manual time is off for Acme."
or "Acme accepts time up to 7 days back." See
[time policy and team rules](/docs/teams-time-and-rates/time-policy) for where
those rules are set.

## Who the time is for

Every entry is logged **For** exactly one thing, and that choice decides which
timesheet it lands on and who approves it.

| For | When it is offered | Who approves |
| --- | --- | --- |
| **A team** | You are on a team attached to the project, and that team tracks time | The workspace's owners and admins — or, on Business, the team's own owners and admins if the team approves its own time |
| **The workspace** | No team of yours is on the project, the workspace tracks time, and you have a seat in it | The workspace's owners and admins |
| **An agreement** | You are assigned to the project under a client or talent agreement | The hirer — or nobody, when a client agreement confirms hours on submit |
| **Just me** | None of the above is available to you | Nobody. It is never approved, billed or paid |

Most of the time there is one answer and Proyekto picks it: the chip is read
only and reads "Only option on this project". When there are two or more —
usually two agreements on one project — you choose the first time, and ticking
"Use for new time on this project" remembers it. A remembered choice is
offered first but never applied silently: the button names it, "Start for
Acme Corp", so one tap confirms.

Options you cannot use right now are greyed out with the reason, such as
"Time tracking is off for this team." or "Your agreement with Acme has
ended." Open any chip to see **Who approves this time**: where the time goes,
the timesheet period, and each rule along with where it was set. On a project
where you cannot log at all, the task says "You can't log time on this
project", and **Why?** explains.

## Just me

"Just me" is personal time. It is available on every plan to anyone who can
log on the project, whenever no team, workspace or agreement option is
available. Only you see it. It never goes on a timesheet, never appears in a
project or team report, and is never approved, billed or paid.

On Free it is what everyone on a workspace project uses, and **Why?** says so:
"Your workspace's plan doesn't include timesheets; this time is just for
you." Time logged under an agreement is the exception — it is never limited
by plan.

## Your week on the Time page

The page shows one week at a time: **‹ ›** step through weeks and **This
week** comes back (on a keyboard, `j`, `k` and `t` do the same). Under the
week, a strip shows each day's total and marks any day over 8 hours with ⚠;
click a day to show only that day.

Below it sit the **timesheets** that overlap the week, then your entries
grouped by day — task, project, For, start, end and duration — with a
**Needs review** group at the top for entries of 10 hours or more and timers
Proyekto stopped for you. The
toolbar filters by For (All, one team, workspace or agreement, or Just me)
and switches between **List** and **Month**.

Days are counted in a timezone. Under **All**, that is yours, set from the ⚙
**Your time settings** menu along with the day your week starts. Under one
For, it is that timesheet's own timezone, and the page labels it when it
differs from yours.

If you approve other people's time but have not logged any yourself in 30
days, Time opens in approver mode instead: what is waiting for you, what you
decided recently, and a single Start timer button. See
[approving time](/docs/teams-time-and-rates/approving-time).

## Editing, moving and deleting

You can edit or delete an entry while its timesheet is **Open** or
**Returned**, and a Just me entry at any time. From an entry's menu you can
change its times, its task, or what it is for.

**Change For…** works on several selected entries at once. Both the timesheet
an entry leaves and the one it joins must be Open or Returned, amounts are
re-estimated for the new choice, and moving time *into* an agreement skips
anything logged before that agreement started.

An entry locks when its timesheet is submitted or approved, or when the entry
has been paid or billed. A locked entry keeps **View details** and
**Comment**, and nothing else — to change it, withdraw the timesheet before
it is decided, or ask for it to be reopened. Adding time to a week that is
already submitted says "This week's Acme timesheet is submitted. Withdraw it
to add time." with a **Withdraw** button right there.

Anyone who can see an entry can comment on it. Comments never unlock
anything.

## Time on a project

A project's **Time** page is for seeing everyone's time rather than logging
your own. **Everyone** splits the project's time by team, workspace and
agreement, for people allowed to see everyone's time there; **Client hours**
is the client's view. "Your time on this project →" opens your own entries on
Time, and someone who can only log is taken straight there.

Under the project's Settings › Time, **Who can log time here** lists each
person with what their time goes to by default, and **Hour limits** caps
weekly or monthly hours for each team member with a rate on the project, with
a switch to block time past the limit instead of just warning.

## On your phone

The app carries Time in full: the timer, adding and editing time,
timesheets, and approvals. Rates, payouts and amounts on agreement time stay
on the web.

## Where to go next

- [Timesheets](/docs/teams-time-and-rates/timesheets) — sending your time for
  approval
- [Approving time](/docs/teams-time-and-rates/approving-time) — the other side
  of the same timesheet
- [Time policy and team rules](/docs/teams-time-and-rates/time-policy) — the
  period, timezone and rules your time follows
- [Plans](/docs/workspaces-and-plans/plans) — which time features each tier
  includes
