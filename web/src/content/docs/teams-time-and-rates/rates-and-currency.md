Member rates turn a team's approved hours into amounts. A rate belongs to one
member, on one or more of the team's projects, in one currency, from a start
date. A team owner switches member rates on from the team's Time settings,
and rates price time on Business. Nobody needs a rate to track time: without
one, Proyekto records the hours and calculates nothing.

## The team's default currency

A team has one default currency, set by the owner in the team's Time
settings. It is the fallback for new rates, and the currency a team is
expected to operate in.

It sits at the team, not on each entry, for a mundane but important reason:
totals have to add up. A list of entries with a currency picked per row is a
list you cannot sum, cannot review as one figure, and cannot pay out in one
go. Putting the choice at the team means every screen underneath it — the
team report, outstanding balances, payouts — has one answer to "in what".

> Changing the default currency affects what happens next, never what already
> happened. Approved time keeps the currency it was approved in.

If you genuinely work in more than one currency, give the rate in the other
currency and expect the money screens to group by currency — which they do
throughout, one line per currency.

## The Rates page

**Rates** is one of the team's Time pages, next to Report and Payouts, for
the team's owner and admins while member rates are on. It is a web page; the
app leaves money settings out.

**Add a rate** picks a member and the projects it covers — all of the team's
available projects, or specific ones — which is how you give someone the same
rate everywhere, or a different one on a single project. Each rate holds:

- **hourly** or **fixed** pay. A fixed rate pays the same figure each month or
  each cut-off (half month), whatever the hours
- a **work rate** and a **training rate**, so time on tasks marked as training
  is priced differently from real work
- a **currency**, defaulting to the team's
- a **start date**, and an optional **end date**
- an optional **custom ID**, such as an employee or contractor ID

A member's hour limits are not set in the rate dialog. They are set per
person and per project in the project's Settings › Time, where they are kept
with the member's rate on that project — so a person needs a rate there
before a limit can be set. See
[time policy and team rules](/docs/teams-time-and-rates/time-policy).

**View time** on a member opens the team report filtered to them.

## Estimates, and the amount at approval

A rate prices time in two steps, and only the second one counts.

**While time is open, the amount is an estimate.** When an entry is created,
Proyekto estimates it from the rate in force that day, and anyone who can see
cost sees it marked as such — "Estimated cost … (final at approval)". Moving
an entry to another For re-estimates it.

**Approval fixes it.** When a timesheet is approved, each entry is priced
with the rate in force **on the entry's own date**, counted in the
timesheet's timezone. A rate is in force from its start date up to and
including its end date. The hours are rounded first and any cap applied, and
the result is frozen onto the entry as the **amount at approval**.

> An approved timesheet is a settled number, not a live query. Changing a rate
> afterwards changes nothing that is already approved.

If a timesheet is reopened and approved again, its entries are priced again
at that point. Fixed-rate time carries no per-entry amount: the hours are
still tracked, because caps and the client's view still use them, but the pay
is the fixed figure.

## Which time a rate prices

Member rates price **team time** — time logged for the team — and nothing
else:

| Time | Priced by |
| --- | --- |
| **For a team** | That team's member rates, when rates are on and the plan is Business |
| **For the workspace** | Nothing. Workspace time carries no cost |
| **Under a talent agreement** | The agreement's own cost terms, never a team rate |
| **On a client agreement you deliver yourself** | Nothing internal; the client is billed by the agreement |
| **Just me** | Nothing, ever |

A rate set on one project never leaks onto another. If someone should be
paid differently on one piece of work, give them a rate on that project.

## When a rate changes

To change what someone earns, give the current rate an end date and add a new
one from the day after. Time on each side of the change is priced by the rate
in force on its own day, and the member's rate history keeps both, so an old
amount can always be reconciled against the rate that produced it.

An end date ends a rate for time after it — it does not delete it, and time
up to and including that day stays priced by it. Time after the end date has
no rate until the next one starts.

## Who can see and edit rates

| Who | What they get |
| --- | --- |
| **Team owner** | Everything: create, edit and end rates, switch member rates and payouts on or off, and set the default currency |
| **Team admin** | Create, edit and end rates. The switches and the currency are shown but stay with the owner |
| **Member** | Their own amounts. Not other people's |

Amounts are shown to the person who logged the time, to the team's owner and
admins while member rates are on, and to a talent agreement's hirer. A
workspace's owners and admins can approve team time without ever seeing its
cost.

Turning member rates off hides the money layer for the team — rates,
amounts and payouts go with it. Approved time keeps the amounts it was
approved at.

## Rates and your plan

Rates are stored on any plan, but only price time on **Business**. Without
it the Rates page says so — "Saved rates are kept, and price approved time
again when Acme is on Business." — and approved team time carries no amount
in the meantime.

## Currency and payouts

One rule carries through to settlement:

> A payout only ever groups time of a **single currency**. If a member has
> approved time in two currencies, that is two payouts.

This is a hard constraint, not a preference — a total in mixed currencies is
not a total. See [payouts](/docs/teams-time-and-rates/payouts) for how the
grouping works, and [approving time](/docs/teams-time-and-rates/approving-time)
for how time reaches approved in the first place.
