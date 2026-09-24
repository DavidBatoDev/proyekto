# Finance Navigation

> **Last updated:** 2026-09-25 · **Status:** draft

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
- **Nothing leaves the shell.** Rates, time logs, and payouts render the same panels
  as Teams → Time (`web/src/components/team-time/Team*Panel.tsx`).
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

Logged 2026-09-25, not yet addressed:

1. **Production is missing the expenses table.** The migration is applied to dev only.
   Until it reaches prod, My finance and the Expenses tab fail for team owners there.
2. **The role badge appears only on the team Overview tab.** The other tabs omit
   "Owner"/"Accountant".
3. **Team contracts are limited to team owners and admins.** A manager or accountant who
   is not a team admin cannot see the team's contracts, because the `team-finance` API
   gates on team admin.
4. **Money in on the team overview is also admin-only.** It comes from the team-admin-gated
   portfolio endpoint, so accountants see "—".
5. **The imports document page is not nested under its team.**
   `/engagements/finance/imports/$documentId` breadcrumbs as My finance → Imports rather
   than team → project.
6. **Setup wizards still use the old breadcrumbs.** `setup/team` and `setup/personal` show
   a "Finance" crumb. The personal-book setup is orphaned, since My finance no longer needs
   a personal book, and the personal-book CSV export is no longer reachable from the UI.
7. **Accepting a finance invite takes an extra hop.** It lands on `/finance/book/$id` and
   redirects from there.
8. **Team invites never expire.** `team_invites` has no expiry concept. Finance invites now
   expire correctly when listed.
9. **Pre-existing lint and type errors, untouched here:**
   - 6 prettier errors in `backend/src/modules/marketplace/contracts/contracts.service.ts`
     (lines 1726–2079).
   - 41 Biome errors in `web`, which are CRLF formatting on this Windows checkout.
   - TS2352 in `web/src/lib/marketplace-enrollment.test.ts`.
10. **Local env.** Base `.env` files point at prod, and the app runs on
    `.env.development.local` (dev). Scripts that read `backend/.env` directly hit prod.
11. **Test data in dev.** JC Studio has a test expense, "Figma team plan (e2e)", PHP 2,500.
