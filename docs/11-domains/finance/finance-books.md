# Finance Books

> **Last updated:** 2026-08-28 · **Status:** current

Finance used to be one page gated to verified consultants (`ConsultantOnlyGuard` on
`/api/finance/*`). **Books** replace that wall with a created surface any execution user can
have, where a contract unlocks **data** rather than creation.

That distinction is the whole design: creating a book is never blocked, and a book with no
contracts behind it renders empty states. What a signed contract unlocks is the timer,
payroll membership, and payout eligibility — see
[engagement eligibility](../../03-backend/authorization-axes.md#5-engagement-eligibility--is-this-work-contract-backed).

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

## Contract-gated time

Migration
[`20260827110000_timer_contract_enforcement.sql`](../../../supabase/migrations/20260827110000_timer_contract_enforcement.sql)
adds `teams.contract_enforcement` with values `off`, `warn` and `enforce`, defaulting to
`off` so every existing team is grandfathered.

| Dial | Behaviour |
| --- | --- |
| `off` | Log freely; no eligibility check applies |
| `warn` | Logs go through, with a returned `contract_warning`; manual logs are stamped `flagged_reason='no_active_contract'` |
| `enforce` | `startLog` is refused with the typed `NO_ACTIVE_CONTRACT` |

A contract lapsing **mid-timer never kills the timer**. `stopLog` stamps
`flagged_reason='contract_lapsed'` best-effort instead — losing eligibility must not destroy
work already recorded. The owner's dial lives on the add-ons page.

## Add-ons

`EntitlementGuard` with `@RequiresEntitlement('time_tracking')` gates the Time module per
team. It is a sibling of `ConsultantOnlyGuard`, deliberately *not* a layer inside
`resolvePermissions` — see
[Authorization axes](../../03-backend/authorization-axes.md#6-entitlement--has-the-team-enabled-the-module).
Today it reads `teams.time_tracking_enabled` and everything is free; a billing table can
replace the resolver without touching call sites. Surface:
`/engagements/finance/team/$teamId/addons`.

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
- [Authorization axes](../../03-backend/authorization-axes.md) — how book roles relate to the other five axes
- [Engagements](../../14-engagement/README.md) — the commercial relationships books report on
- [Teams and Time](../teams-and-time/README.md) — the time ledger the timer dial gates
