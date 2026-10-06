# Finance Navigation

> **Last updated:** 2026-10-06 · **Status:** draft

The Engagements shell used to have five overlapping places for money: Home,
Personal, a team page, a team *book* page, and project book pages. The team page
and team book page showed the same team, and project pages linked "up" to the
book instead of the team, so users got lost. It is now one tree, and the sidebar,
the breadcrumb, and the URL are all derived from the same resolver
(`resolveEngagementsLocation` in `web/src/components/layout/sidebar/engagementsNavigation.ts`),
so they always agree about where you are. A finance *book* is storage behind a
page, never a place you navigate to.

## The tree

```text
ENGAGEMENTS
  Overview         /engagements                     needs-attention + engagement list
  Contracts        /engagements/contracts           My contracts · Drafted by me · Team contracts
    contract       /engagements/contracts/$id       editor, signing, amendments
FINANCE
  My finance       /engagements/finance             consolidated across every team
  My teams         /engagements/finance/teams       teams you run (auto-opens when only one)
    team           /engagements/finance/team/$teamId[/invoices|time-logs|rates|payouts|expenses|imports|members]
      project      /engagements/finance/team/$teamId/project/$bookId[?tab=invoices|expenses|imports|settings]
  Shared with me   /engagements/finance/shared      books other teams granted you
```

Rules:

- **Contracts are listed only in Engagements → Contracts.** Finance pages link to a
  contract (the project overview's "View in Engagements →" chip), never list them.
- **Nothing leaves the shell.** Rates and payouts render the same panels as Team › Time
  (`web/src/components/team-time/TeamRatesPanel.tsx`, `TeamPayoutsPanel.tsx`), and the
  **Time** tab (id `time-logs`) renders the shared team time report
  (`web/src/components/time/report/`).
- **"My teams" means teams you run.** You own or administer the team, or hold a finance
  role on its book. Plain memberships appear only in My finance, as your share.
- **Team members and finance access are different lists** on the Members tab. Finance
  access never grants workspace access or team membership.

## My finance

Served by `GET /api/finance-books/me/summary`; no personal book required. For each team
you own or belong to:

- **scope `team`** (team owner, or book role owner/manager/accountant): full money in
  (billed, collected, open) and money out (payouts + expenses).
- **scope `self`** (plain member): only your hours and payouts made to you.

Totals are per currency; nothing is converted or summed across currencies.

## Money out

`finance_expenses` (migration `20260924090000_finance_expenses`) stores manual
expenses: salary, contractor, software and subscriptions, overhead, taxes and fees,
other. Monthly or yearly recurrence is expanded when the data is read. Recorded
payouts are added to summaries as virtual salary rows and are never copied into the
table. Writing requires `manage_expenses` (owner, manager, accountant). Reading
requires `manage_expenses` or `view_costs`. Voiding is soft.

## Legacy URLs

Every old URL redirects:

- `/finance/book/$id` goes to the team page (team book) or the nested project page (project book).
- `/finance/me` and `/finance/portfolio` go to My finance.
- `/finance/contracts` and `/finance/$contractId` go to Engagements → Contracts; the
  notification deep link `?projectId&step` still works.
- `/finance/invoices?projectId` and `/finance/imports?projectId` go to that project's tab
  when the project has project finance. Otherwise they render the workspace in place.

## Known issues and follow-ups

Logged 2026-09-25. Items 2–9 were resolved on 2026-09-30 (branch
`feat/contract-signature-integrity`).

1. **Production is missing the expenses table.** The migration is applied to dev only.
   Until it reaches prod, My finance and the Expenses tab fail for team owners there.
   *Still open.* Prod also lacks `20260930090000_team_invite_expiry` (see 8).
2. ~~The role badge appears only on the team Overview tab.~~ **Resolved.**
   `TeamFinanceChrome` derives the badge (`teamRoleLabel`) on every tab.
3. ~~Team contracts are limited to team owners and admins.~~ **Resolved.**
   `TeamFinanceAccessService.listTeamProjects` admits team owners/admins *or* an
   owner/manager/accountant on the team's finance book holding the matching book
   capability (`view_contracts`; `manage_money` for invoice management). A book grant
   covers every project attached to the team. Accountants now hold `view_contracts`.
   Client viewers on a team book are excluded.
4. ~~Money in on the team overview is admin-only.~~ **Resolved** by the same gate; the
   overview fetches the portfolio when `canSeeTeamMoneyIn(team)`.
5. ~~The imports document page is not nested under its team.~~ **Resolved.** Documents
   live at `/engagements/finance/team/$teamId/project/$bookId/imports/$documentId`
   (breadcrumb: team › project › Imports › file). The old
   `/engagements/finance/imports/$documentId` redirects there, or renders in place when
   the project has no project finance.
6. ~~Setup wizards still use the old breadcrumbs.~~ **Resolved.** `setup/personal` is
   deleted. My finance has an "Export my records" section (time logs and payouts, CSV/
   Excel/PDF), which creates the private personal book on first use. `setup/team` uses
   `FinanceTrail` under My teams, and the sidebar resolves it to My teams.
7. ~~Accepting a finance invite takes an extra hop.~~ **Resolved.** The accept endpoint
   returns `path` (team page or nested project page); the web goes straight there and
   toasts "You now have access as <Role>".
8. ~~Team invites never expire.~~ **Resolved.** Migration
   `20260930090000_team_invite_expiry` adds `team_invites.expires_at` (14 days) and the
   `expired` status (**applied to dev only**). Listing marks lapsed invites expired,
   accepting a lapsed one is refused, and the Members tab and workspace team page show
   "Expired" with a Resend button.
9. ~~Pre-existing lint and type errors.~~ **Resolved.** `.gitattributes` pins LF (the
   index was already LF, so no churn); the Prettier and Biome errors were CRLF working
   copies. The TS2352 (and TS2322/TS2677 in `accountDeletionCopy.test.ts`) are fixed.
10. **Local env.** Base `.env` files point at prod, and the app runs on
    `.env.development.local` (dev). Scripts that read `backend/.env` directly hit prod.
11. **Test data in dev.** JC Studio has a test expense, "Figma team plan (e2e)", PHP 2,500.
    `node scripts/seed_dev_project_finance.mjs` (idempotent, dev-only) adds the project
    "Harbor Coffee — Rebrand (seed)" with a signed contract, a project book, invoices,
    two imported documents, time logs, and expenses.

Found while testing the seeded project on 2026-09-30; items 12–16 resolved the same day
(branch `feat/contract-authoring-intake`):

12. ~~The project Overview shows no money in.~~ **Resolved.** The book overview's invoice
    slice carries `amount_paid` (net of reversals, via `collectedByInvoice`), and the
    Overview draws Billed / Collected / Outstanding per currency
    (`summariseProjectMoneyIn`; drafts and voids excluded).
13. ~~A recorded document still opens an editable workspace.~~ **Resolved.** Documents
    carry `recorded_invoice`; the Imports list shows "Recorded · <number>", the workspace
    opens read-only with "View invoice →" (Invoices tab), and `importInvoice` refuses a
    document that already backs an invoice.
14. ~~"Billed in" defaults to AUD.~~ **Resolved.** It defaults to the project's currency
    (`defaultBilledCurrency`); a value read off the document or picked by hand still wins.
15. ~~No "Imported" badge; "Hours summarised" on imported/manual invoices.~~ **Resolved.**
    Imported invoices show an "Imported" badge; the hours label (`invoiceHoursLabel`) is
    omitted for imported invoices and for manual ones with no time-based lines.
16. ~~Expense dates render as `9/18/2026`.~~ **Resolved.** Expenses and import rows use
    `formatFinanceDate` (`Sep 18, 2026`).
