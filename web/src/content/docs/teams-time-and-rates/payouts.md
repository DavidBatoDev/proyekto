A payout is a record. It groups a member's approved, unpaid team time — all in
one currency — into a total, and says that total was paid. Proyekto keeps the
record; the payment itself happens through whatever channel you already use.
Payouts come with Business, a team owner switches them on from the team's
Time settings underneath member rates, and they live on the web: the app
leaves them out.

## What can be paid

A payout pays **team time**: time a member logged for the team, priced by
their [member rate](/docs/teams-time-and-rates/rates-and-currency), on a
timesheet that has been approved, and not in a payout already. The Payouts
page calls this **approved and unpaid**.

Nothing else is paid here. Workspace time carries no cost, Just me time is
never paid, and agreement time is settled under its agreement. Time on a
fixed rate is not paid by entry either — "Fixed-fee time is paid as a manual
payment, not by entry." — because its pay is a set figure, not hours times a
rate.

## The Payouts page

**Payouts** is one of the team's Time pages, next to Report and Rates, for the
team's owner and admins while payouts are on. It opens on **To pay**:
approved, unpaid time grouped by the team's pay cut-offs, newest first, with
each member's total inside each cut-off. A cut-off that has not ended yet is
marked **In progress**; one that has is **Ready to pay**.

1. **Approve the cut-off's timesheets in Time.** Approval is what makes time
   payable, and it happens on the Time page —
   [approving time](/docs/teams-time-and-rates/approving-time).
2. **Pay the cut-off here once its time is approved.**

Cut-offs come from **Billing and pay cut-offs** in the team's settings, so
the grouping matches how the team actually pays, and their days are counted
in the team's timezone. The page reads the last couple of months. If older
approved time is still unpaid it says so — "Some approved time from before
Aug 1, 2026 isn't paid yet." — and **Show older time** brings it in.

Unapproved time never holds a payment up. A member's row says "2h not yet
approved", and **Review** opens the team report on that person and cut-off.
You can pay the approved part now and the rest once it is approved.

## Recording a payment

**Pay** on a member's row opens the record: "Record a payment you made
outside Proyekto. The time below is marked as paid."

- The **total** is each entry's approved hours times the rate it was approved
  at, added up and rounded once.
- **Where it went**: members can store where they want to be paid — a bank
  account or a wallet, with an optional scan-to-pay image — and whoever
  records the payout sees those details at the moment of paying, rather than
  hunting for them in chat.
- The **date paid**, and optionally a **reference**, a **note** and a file as
  **proof** — a screenshot or a receipt.
- Time in the period that is not approved yet is named and left out: it
  "isn't part of this payment; pay it once it's approved."

Saving marks every entry in it **Paid**, and the member gets a "Payment
recorded" notification and email. Neither ever shows the amount.

> You cannot pay yourself: "Someone else on the team has to record your
> payment." For the same reason, nobody approves their own priced time.

## Why one currency

> A payout never mixes currencies. If a member has approved time in two, run
> one payout per currency.

A mixed total is not a total — there is no sensible number to write on it, and
no honest figure to reconcile against. So outstanding balances are calculated
per member *per currency*, and the same member can appear twice in the list
with two separate amounts to settle. Keeping a team on one
[default currency](/docs/teams-time-and-rates/rates-and-currency) is what
stops that happening in the first place.

## What a payout does not do

This is the part people expect to work differently, so it is worth stating
plainly:

> Proyekto does not move money. It holds nothing, transfers nothing, and takes
> no cut. A payout is a record of what was owed and what was paid.

You pay through your bank, your wallet, your payroll — whatever you already
use — and then record it here so the hours, the amounts and the settlement all
live in one place. The same principle applies to
[invoices](/docs/clients-and-marketplace/contracts-and-invoices): Proyekto
records that an invoice was paid, it never collects the payment.

## Fixing a mistake

Paid time is locked. It cannot be edited, it cannot go into a second payout,
and its timesheet cannot be reopened — the refusal says "Void the payout to
reopen." Correcting something therefore means undoing the record rather than
editing it:

**Void the payout.** Its time goes straight back to approved and unpaid —
"Payout voided. Its time is approved and unpaid again." — and the payout stays
in **Payout history** marked Void rather than vanishing. Then record a new one
with the right time, amount or details.

Nothing is deleted by this, which is the point. A voided payout plus its
replacement is an honest history of what happened; a silently edited payout is
not.

## Payouts and your plan

On a plan without payouts, To pay is replaced by "Payouts are part of
Business." and payouts cannot be switched on. Nothing recorded is lost:
"Recorded payments stay readable here, and can still be voided."

## Where to go next

- [Approving time](/docs/teams-time-and-rates/approving-time) — how team time
  reaches approved, and who approves it
- [Rates and currency](/docs/teams-time-and-rates/rates-and-currency) — where
  the amount on each entry comes from
- [Teams](/docs/teams-time-and-rates/teams) — the settings that switch
  payouts, rates and cut-offs on
- [Plans](/docs/workspaces-and-plans/plans) — what Business adds
