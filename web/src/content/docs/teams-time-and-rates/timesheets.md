A timesheet is one person's time for one period, going to one set of
approvers. You never create one: the first entry you log for a team, a
workspace or an agreement in a period opens it, and every later entry for the
same thing in that period joins it. At the end of the period you send the
whole timesheet once, instead of each entry on its own.

"Just me" time never goes on a timesheet — it is yours alone, and there is
nothing to approve. See [tracking time](/docs/teams-time-and-rates/time-tracking).

## Which timesheet your time lands on

Timesheets are grouped by who decides them, so two kinds of time that go to
the same approvers share one timesheet.

| Timesheet | What goes on it | Shown as |
| --- | --- | --- |
| **Workspace** | Time logged for the workspace, and team time from teams that follow the workspace's rules | The workspace's name |
| **Team** | Time logged for a team that sets its own time rules (Business) | The team's name |
| **Agreement** | Time logged under one client or talent agreement | The other party's name, with "· agreement" |

So on Pro, an hour logged for your Design team on one project and an hour
logged for the workspace on another land on the same workspace timesheet —
both are decided by the workspace's owners and admins.

## Periods and timezones

A timesheet covers one period: **weekly** (the default, starting Monday),
**every two weeks**, **twice a month** (1–15 and 16–end), or **monthly**. The
period, the day a week starts and the timezone come from the workspace's time
policy, a team's own rules, or an agreement's terms —
[time policy and team rules](/docs/teams-time-and-rates/time-policy) explains
which wins.

> Timesheets count days in their own timezone. An entry belongs to the day it
> started on in the timesheet's timezone, which is not always your day.

When the period, timezone or week start changes, the change applies from the
next period. Timesheets already open keep their dates.

## The four states

A timesheet is always in one of four states. The smaller line under the state
— its sublabel — tells you what is happening inside it.

| State | What it means | Sublabels you may see |
| --- | --- | --- |
| **Open** | You can still add and change time | "until Oct 5", "sends itself Oct 6", "overdue", "Reopened by you" |
| **Submitted** | Waiting for a decision. Its entries are locked | "Waiting on Ana Reyes", "Waiting on Acme's owners and admins", "Sent automatically", "Sent when the account was closed", "Imported from per-entry review" |
| **Returned** | Sent back to you with a note. You can edit again | "Returned by Ana · 'Split Thursday'", "Reopened by Ana · '…'" |
| **Approved** | Decided. Hours and amounts are fixed | "Self-approved", "Confirmed", "Overtime approved", "Imported" |

Entries also carry a **Paid** badge once a payout covers them, and people
who can see cost see **Billed** once the hours are on an invoice.

## Submitting

On the Time page, each timesheet in the week you are looking at has a card.
**Submit** appears on it from the last day of the period. Before that the
card reads "Open · until Oct 5".

Submit opens a check of the whole period first:

- **Day totals**, counted in the timesheet's timezone.
- **Where it goes** — "Goes to Ana Reyes", "Goes to Acme's workspace owners
  and admins", and so on.
- **Blockers** that stop the send: a timer still running inside the period,
  or a timesheet with no time on it.
- **Warnings to tick** before you can send: entries of 10 hours or more, days
  over 8 hours, entries added after their day, timers that were stopped
  automatically, and time over an agreement's weekly limit or your own weekly
  cap — "Your agreement with Acme allows 40h a week. You logged 43h 30m. The
  3h 30m over needs Ana's approval."

Sending locks the entries and tells the approvers. The toast says where it
went: "Sent to Acme's workspace owners and admins for approval."

## Withdrawing and fixing

Until somebody decides it, you can **Withdraw** a submitted timesheet. It goes
back to Open — "Withdrawn. You can edit again." — and the approvers'
notification goes with it.

If an approver **returns** it, the card turns amber and shows their note.
**Fix** shows just that timesheet's entries, across the whole period, so you
can change what the note asks for and then **Resubmit**. The note stays in the
timesheet's history.

## Timesheets that send themselves

Some timesheets have nobody else to decide them: approval is switched off,
or you are the only person who could approve and the time carries no cost.
Those cards read "Open · sends itself Oct 6". One day after the period ends
(or after the reminder delay the policy sets, if that is longer), Proyekto
sends and approves the timesheet for you — unless a timer is still running
inside it. You can still press Submit early.

> A timesheet whose time carries a cost — team time priced by member rates,
> or time on a talent agreement — never approves itself. It goes to somebody
> else, and if there is nobody, it waits: "No one else can approve this. Add
> a workspace admin."

Time on a client agreement you deliver yourself is confirmed rather than
approved: "Submitting confirms these hours for your agreement with Acme
Corp."

## Reminders

Every other timesheet waits for you. Proyekto sends a "Time to submit"
reminder a day after the period ends — or after the number of days the
policy sets — by notification and email, and the dashboard's welcome line
adds "Submit last week (28h 45m)" until you do.

## Reopening an approved timesheet

Approved time is meant to stay approved, so reopening depends on who decided
it:

| Situation | What you can do |
| --- | --- |
| Someone else approved it | **Ask to reopen**, with an optional note. The approvers are told, and if they agree they reopen it — it comes back to you as Returned, with their note |
| It approved itself (yours alone) | **Reopen** it yourself, with an optional note. It goes back to Open, marked "Reopened by you" |

Nobody can reopen a timesheet whose time is already settled, and the refusal
says what to undo first:

- **In a payout** — void the payout to reopen.
- **On a draft invoice** — remove the hours from the draft to reopen.
- **On an issued invoice** — void the invoice without a replacement to
  reopen.
- **Paid outside Proyekto** (time from before timesheets existed) — it cannot
  be reopened.

In the app, those read "This time has already been paid." or "This time is
already being billed.", with "Reopen it on the web."

## Time from before timesheets

Time that was tracked before timesheets existed has been grouped into
timesheets by period. The first time you open Time afterwards, a banner says
so: "Your time is now grouped into timesheets. Past weeks were sent for
approval for you." Weeks that were still waiting show as submitted, marked
"Imported from per-entry review"; weeks that were already approved show as
approved, marked "Imported". Earlier entries that were already paid say "Paid
outside Proyekto" in their details.

## When the plan changes

Timesheets for team and workspace time come with Pro; timesheets for
agreement time work on every plan. If a workspace's plan stops including
timesheets, nothing already recorded is touched:

> "Acme's plan no longer includes timesheets. Your existing time is safe, and
> open timesheets can still be decided."

New team and workspace time on that workspace's projects becomes Just me
until the plan includes timesheets again; time under an agreement carries on
as before. If your account is deleted, your open timesheets are sent
for approval first, marked "Sent when the account was closed".

## Where to go next

- [Approving time](/docs/teams-time-and-rates/approving-time) — what the
  approver sees when your timesheet arrives
- [Time policy and team rules](/docs/teams-time-and-rates/time-policy) — where
  periods, timezones and approval are set
- [Tracking time](/docs/teams-time-and-rates/time-tracking) — the entries a
  timesheet is made of
- [Plans](/docs/workspaces-and-plans/plans) — which timesheet features each
  tier includes
