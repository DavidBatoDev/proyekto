Rates turn logged hours into amounts. They are set per team, per member and
per project, and the currency comes from the team rather than from each entry.
A team owner switches member rates on from the team's Time settings; until
then Proyekto tracks hours and calculates nothing.

## The team's default currency

A team has one default currency, set once by the owner in team settings. It is
the fallback for new rates and new logs, and it is the currency a team is
expected to operate in.

It sits at the team, not on each entry, for a mundane but important reason:
totals have to add up. A list of logs with a currency picked per row is a list
you cannot sum, cannot review as one figure, and cannot pay out in one go.
Putting the choice at the team means every screen underneath it — Team Logs
totals, outstanding balances, payouts — has one answer to "in what".

> Changing the default currency affects what happens next, never what already
> happened. Existing logs keep the currency frozen onto them when they were
> created.

If you genuinely work in more than one currency, the way to do it is a rate in
the other currency, and to expect the money screens to group by currency —
which they do throughout.

## Manage rates

The **Manage Rates** tab is visible to the team owner and team admins when
member rates are on. A rate is created for a member and applied to one or more
of the team's projects at once, which is how you give someone the same rate
across everything, or a different one on a single project.

Each rate holds:

- a **work rate** and a **training rate**, so time on tasks marked as training
  resolves differently from real work
- a **currency**, defaulting to the team's
- a **start date**, and an end date once it is superseded
- an optional **reference** for the member, such as an employee or contractor
  identifier
- optional **weekly and monthly hour caps**, and whether hours past a cap need
  approval as overtime

Rates can also be **fixed** rather than hourly — the same figure each pay
period, monthly or half-monthly, regardless of hours. Hours are still tracked
in that case, because they still matter for caps and for what the client is
shown.

## How a rate resolves

When a log is created, Proyekto works out which figure applies and copies it
onto the entry:

1. **The team.** The team you are on for that project — the project's primary
   team first if it has one.
2. **Your active rate on that project.** The rate row for you, on that
   project, that has not been ended. That row supplies the work rate, the
   training rate and the currency.
3. **Nothing set.** The log is still created. It carries no amount and takes
   the project's currency, so it slots in correctly once a rate exists.

A rate set on one project never leaks onto another. If someone should be paid
differently on one piece of work, give them a rate on that project; the
resolution above picks it up and leaves the rest alone.

## When a rate changes

Rates are **snapshotted onto the log**. The amount, and the currency, are
written into the entry at the moment it is created and never recalculated.

That means a rate change applies to time logged from then on, and every log
already recorded — pending, approved or paid — keeps the amount it resolved
at. An approved timesheet is a settled number, not a live query, which is
exactly what you want when someone has already agreed to it.

To change what someone earns, end the current rate and start a new one from
the date it takes effect. The member's rate history keeps both, so you can see
what applied when, and reconcile an old log against the rate that produced it.

## Who can see and edit rates

| Who | What they get |
| --- | --- |
| **Team owner** | Full control: create, edit and end rates, and set the team's default currency. |
| **Team admin** | Create, edit and end rates. The currency, the cut-off schedule and the retroactive window stay with the owner. |
| **Member** | Their own rate on a project they work on, and their own logs' amounts. Not other people's. |

Turning member rates off hides the money layer for the whole team — rates,
amounts and payouts go with it — and logs already carrying an amount keep it.

## Currency and payouts

One rule carries through to settlement:

> A payout only ever groups logs of a **single currency**. If a member has
> approved time in two currencies, that is two payouts.

This is a hard constraint, not a preference — a total in mixed currencies is
not a total. See [payouts](/docs/teams-time-and-rates/payouts) for how the
grouping works, and [time tracking](/docs/teams-time-and-rates/time-tracking)
for how a log reaches the approved state in the first place.
