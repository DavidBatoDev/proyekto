# Finance Books (F1/F2/F3) — the book-based finance surface in Engagements

Status: **shipping in phases** (2026-08-27). Phases 1–3 and 6 are live in code;
this document moves to `11-domains/finance` + `14-engagement` once the full
surface has shipped and stabilized.

## Why

Finance was gated to verified consultants (`ConsultantOnlyGuard` on
`/api/finance/*`). The overhaul makes finance a **created** surface every
execution user can have, with contract-gated data:

- **F1 Personal** — one private book per user (any capacity: client,
  consultant, talent). Hours worked, money in/out, payouts, rates across
  engaged projects. Creation is never blocked; a zero-contract book renders
  empty states. Contracts unlock **data** (timer, payouts), not creation.
- **F2 Team** — one book per team, created by the team owner. Grants finance
  access to internal AND external actors (HR, accountant) who never appear in
  `project_access` and never gain execution access.
- **F3 Project** — children of an F2, one per project, creatable only for
  projects with a live (`signed`/`active`) `client_services` contract. When
  that contract ends/cancels the book archives (read + export only).

Core rule: **engaged = a signed seat (`contract_positions.signed_at`) on a
live contract linked to the project.** No contract → no timer (per-team
rollout), no payroll membership, no payout eligibility.

## Schema (migration `20260827100000_finance_books.sql`)

`finance_books`, `finance_book_members`, `finance_invites` — see the migration
for shapes. All deny-all RLS (service-role only), matching the engagement
tables: the TypeScript access service is the boundary because every finance
service runs on `SUPABASE_ADMIN`.

Roles → capabilities (single source `books/finance-book-permissions.ts`, pure
+ snapshot-tested):

| role | view_time | view_costs | view_contracts | export | manage_money | manage_members |
|---|---|---|---|---|---|---|
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| manager (HR) | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| accountant | ✓ | – | – | ✓ | – | – |
| viewer_client | – | – | ✓ | – | – | – |
| viewer | ✓ | – | – | – | – | – |

Invariants:
- `viewer_client` can NEVER be granted `view_costs`, even by capability
  override — the book-side twin of `assertNoInternalRates`.
- Ownership is implicit (personal owner user; current team owner), so team
  ownership transfer needs no finance writes.
- F2 → F3 inheritance (owner/manager only) is resolved at read time in
  `FinanceBookAccessService` — never materialized, so new F3s and
  re-parenting need no fan-out.
- Access misses throw NotFound, never Forbidden.

## Eligibility engine (`finance/eligibility/`)

`EngagementEligibilityService.getEngagementStatus(userId, projectId)` →
`engaged | grandfathered | ineligible`. Grandfathered = pre-cutoff
(`2026-08-27`) time logs on the project, or a verified consultant with a
pre-cutoff `project_access` row. 60s in-process cache; deliberately
dependency-free so both execution (team-time) and marketplace modules import
it without cycles.

## Timer gating (migration `20260827110000_timer_contract_enforcement.sql`)

`teams.contract_enforcement ∈ off | warn | enforce`, default `off`
(grandfathered). `warn` lets logs through with a returned `contract_warning`
(toast) and stamps manual logs `flagged_reason='no_active_contract'`;
`enforce` refuses `startLog` with typed `NO_ACTIVE_CONTRACT`. A contract
lapsing mid-timer never kills the timer — `stopLog` stamps
`flagged_reason='contract_lapsed'` best-effort. Owner dial lives on the
Engagements add-ons page.

## Add-ons

`EntitlementGuard` + `@RequiresEntitlement('time_tracking')`
(`execution/entitlements/entitlement.guard.ts`) — the pricing-tiers
proposal's shape: entitlement is a guard, never a fourth layer inside
`resolvePermissions`. Today it reads `teams.time_tracking_enabled` and
everything is free; a billing table can replace the resolver without touching
call sites. Surface: `/engagements/finance/team/$teamId/addons`.

## Web

Sidebar finance entry is no longer consultant-gated. Non-consultants hitting
the portfolio get routed to `/engagements/finance/me` (F1 dashboard); F1
setup at `/engagements/finance/setup/personal`. The consultant portfolio is
unchanged and remains what a verified consultant sees in the same section.

## Deferred / out of scope (v1)

- FX conversion — dashboards group by native currency.
- Cross-module cache invalidation on contract signing (60s staleness
  accepted).
- Contract amendments UX for projects and talents (schema already supports
  via `contract_family_id`).
- Pricing for add-ons; grandfathering pricing questions (E7 in
  pricing-tiers-and-add-ons.md).
