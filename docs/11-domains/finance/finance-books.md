# Finance Books

> **Last updated:** 2026-10-06 · **Status:** current

Finance used to be one page gated to verified consultants (`ConsultantOnlyGuard` on
`/api/finance/*`). **Books** replace that wall with a created surface any execution user can
have, where a contract unlocks **data** rather than creation.

That distinction is the whole design: creating a book is never blocked, and a book with no
contracts behind it renders empty states. What a signed contract unlocks is data — the
project book, its contracts and invoices, and the time logged **for** the agreement through
engagement assignments. It no longer gates the timer: the contract-gated timer was retired
with the old time module (see [below](#contract-gated-time-retired)).

## The three kinds

| Kind | Who owns it | What it is |
| --- | --- | --- |
| **Personal** (F1) | A user | One private book per account, in any capacity — client, consultant or talent. Hours worked, money in and out, payouts, rates across engaged projects. |
| **Team** (F2) | A team | One book per team, created by the team owner. Grants finance access to internal *and* external actors — an accountant, an HR administrator — who never appear in `project_access` and never gain execution access. |
| **Project** (F3) | A team | A child of an F2, one per project. Creatable only for a project with a live (`signed`/`active`) `client_services` contract; archives to read-and-export when that contract ends or is cancelled. |

## Schema

Migration
[`20260827100000_finance_books.sql`](../../../supabase/migrations/20260827100000_finance_books.sql)
adds three tables. All three have **RLS enabled with zero policies** — deny-all for `anon`
and `authenticated`, matching the engagement tables. The TypeScript access service is the
boundary, because every finance service runs on `SUPABASE_ADMIN` where RLS never backstops
it.

| Table | Holds |
| --- | --- |
| `finance_books` | `kind` (`personal` / `team` / `project`), `owner_kind` (`user` / `team`), `owner_user_id`, `owner_team_id`, `parent_book_id`, `project_id`, `currency`, `status` (`active` / `archived`) |
| `finance_book_members` | `book_id`, `user_id` **or** `invited_email`, `finance_role`, `capabilities` (jsonb per-member overrides), `inherited_from_book_id`, `granted_by` |
| `finance_invites` | `book_id`, `email`, `finance_role`, `capabilities`, single-use `token`, `status` (`pending` / `accepted` / `declined` / `cancelled` / `expired`) |

A single `finance_books_shape_check` constraint enforces the whole per-kind shape rather
than leaving it to application code: personal is user-owned with no parent and no project;
team is a team-owned root; project is a team-owned child that must carry both a parent and a
project. Partial unique indexes give one personal book per user, one team book per team, and
one book per project.

`finance_invites.finance_role` deliberately excludes `owner`: ownership is implicit, never
granted.

## Roles and capabilities

The single source is
[`finance-book-permissions.ts`](../../../backend/src/modules/marketplace/finance/books/finance-book-permissions.ts)
— a pure `(role, overrides)` to capabilities function with no I/O, snapshot-tested so the
web mirror cannot drift. Capabilities: `view`, `view_time`, `view_costs`, `view_contracts`,
`export`, `manage_money`, `manage_members`, `manage_book`.

| Role | Is | Sees costs? | Manages |
| --- | --- | --- | --- |
| `owner` | The account or team owner | yes | everything |
| `manager` | The HR tier | yes | money, not members or the book |
| `accountant` | View and export of time and payouts | **no** | nothing |
| `viewer_client` | The client seat | **never** | nothing |
| `viewer` | Time only | no | nothing |

Invariants that must survive any change:

- **`viewer_client` can never be granted `view_costs`**, even through a capability
  override — the book-side twin of `assertNoInternalRates`. A client seat sees contracts and
  invoices, never anything that could carry an internal cost figure.
- **Ownership is implicit** — the personal owner user, the current team owner — so
  transferring team ownership needs no finance writes at all.
- **F2 to F3 inheritance** (owner and manager only) is resolved at read time in
  `FinanceBookAccessService`, never materialized. New project books and re-parenting
  therefore need no fan-out.
- **Access misses throw NotFound, never Forbidden**, so book ids cannot be probed.
- **A book grants no execution access.** Books never write `project_access`. A member with
  every capability still cannot open the project.
- **What makes a project eligible for a book** (`contractedTeamProjects`): it is attached to
  the team, and it is covered by signed client authority — either a `signed`/`active`
  `client_services` contract whose `project_id` is the project, or (since 2026-09-24) an
  active `operational_assignment` link from an active `client_services` engagement. The
  second is how a *flexible* client contract reaches a book: "Set up the project" after
  signing creates or links the project and opens its book, at the currency of the contract
  that activated the engagement.

## HTTP surface

Every route is under the global `/api` prefix.

| Route | Purpose |
| --- | --- |
| `GET /api/finance-books` | Books the caller can reach |
| `GET /api/finance-books/hub` | The unified hub payload |
| `GET /api/finance-books/engaged-projects` | Projects where the caller is contract-engaged |
| `GET /api/finance-books/personal/dashboard` | F1 dashboard figures |
| `POST /api/finance-books/personal`, `POST /api/finance-books/team` | Create F1 / F2 |
| `POST /api/finance-books/:bookId/projects` | Create an F3 under an F2 |
| `GET /api/finance-books/:bookId`, `GET /api/finance-books/:bookId/overview` | Book detail and dashboard |
| `GET/POST /api/finance-books/:bookId/members`, `PATCH/DELETE …/:memberId` | Membership |
| `POST/GET /api/finance-books/:bookId/invites`, `DELETE …/:inviteId` | Issue and manage invites |
| `GET /api/finance-invites/:token`, `POST …/accept`, `POST …/decline` | Token invite response |
| `GET /api/finance-books/:bookId/export` | `.csv` / `.xlsx` / `.pdf`, columns filtered by `view_costs` |

Export column filtering is not a UI concern: `export-columns.ts` drops cost columns for any
role lacking `view_costs`, so an accountant's spreadsheet cannot carry margin.

## Time figures

Books read the time ledger (`time_entries`) with the same predicates as every other money
surface. **Approved** = `payable_seconds` frozen by an approved timesheet and not a legacy
rejection; hours are `payable_seconds`, never logged duration.

| Figure | Rule |
| --- | --- |
| Pending | Entries on `open`, `submitted` or `returned` sheets, on logged duration |
| Approved | Book overview: `approved_seconds` = payable seconds of approved entries, paid ones included. `GET /api/finance-books/me/summary` splits them: `approved_seconds` = approved and unpaid, `paid_seconds` = paid (a payout, or paid outside Proyekto) |
| Cost (`view_costs` only) | Σ `amount_snapshot` frozen at approval; approved hours with no amount are reported as `uncosted_seconds`. Cost columns are never selected for a reader without `view_costs` |
| Legacy rejections | Excluded from every figure |
| Scope | Personal book: the owner's entries in every context, personal time included; team book: entries logged for the team; project book: the project's non-personal entries |

On project books a placed talent's agreement rows are masked for readers who are not
provider-side on that agreement (`user_id` `masked:<assignment>`, "Delivery team"). The time
export keeps `kind=time_logs` and a `status` column (derived: paid, rejected, approved,
pending), adds For, approved hours, timesheet status and period columns, and never includes
email.

## Contract-gated time (retired)

Migration
[`20260827110000_timer_contract_enforcement.sql`](../../../supabase/migrations/20260827110000_timer_contract_enforcement.sql)
added `teams.contract_enforcement` (`off`, `warn`, `enforce`). **It has no effect since the
time rebuild:** the column is still accepted by `PATCH /api/teams/:id` so the current web keeps
working, nothing reads it, and the contract migration (M5) drops it. No prod team has it set
past `off` (2026-10-05 snapshot). The alias route `GET /api/team-time/projects/:projectId/contract-status` always
answers `{enforcement:'off', engagement_status:'engaged'}`.

Contract-backed time is now a choice of **what the time is for**: a worker on an engagement
assignment logs for that agreement, and the agreement's own settings decide whether time is
optional, required (no other option is offered) or disabled. Ending an assignment stops a
timer logging to it at the end time (`flagged_reason='stopped_by_assignment_end'`); nothing
refuses.

## Add-ons

A team's time is switched by `teams.time_tracking_enabled` (turning it on needs the workspace
plan's `time_tracking`) and, from there, by the workspace plan's time features
(`time_team_rules`, `time_payouts`, `time_billable_invoices`, `time_reports_export`,
`time_audit_export`), checked on the team's workspace where each feature is used. The old
`EntitlementGuard` was removed with the old time module. See
[Authorization axes](../../03-backend/authorization-axes.md#6-entitlement--does-the-plan-include-it-and-is-the-team-on).
Surface: `/engagements/finance/team/$teamId/addons`.

## Web surface

The finance sidebar entry is no longer consultant-gated. Non-consultants reaching the
portfolio are routed to `/engagements/finance/me` (the F1 dashboard); F1 setup is at
`/engagements/finance/setup/personal` and F2 setup at `/engagements/finance/setup/team`. The
consultant portfolio is unchanged and remains what a verified consultant sees in the same
section.

Routes live under
[`web/src/routes/_execution/engagements/finance/`](../../../web/src/routes/_execution/engagements/finance/);
the service is
[`web/src/services/financeBooks.service.ts`](../../../web/src/services/financeBooks.service.ts).

## Deferred

| Item | Note |
| --- | --- |
| FX conversion | Dashboards group by native currency |
| Cross-module cache invalidation on contract signing | The eligibility service's 60 s staleness is accepted |
| Contract amendments UX for projects and talents | Schema already supports it via `contract_family_id` |
| Add-on pricing and grandfathering pricing | See [pricing tiers](../../13-proposals/pricing-tiers-and-add-ons.md), edge case E7 |

## Related documentation

- [Finance hub](./README.md) — invoices, payouts, receivables, contract parties
- [Authorization axes](../../03-backend/authorization-axes.md) — how book roles relate to the other six axes
- [Engagements](../../14-engagement/README.md) — the commercial relationships books report on
- [Teams and Time](../teams-and-time/README.md) — the time ledger the books report on
