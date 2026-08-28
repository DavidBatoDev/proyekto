# Authorization Axes

> **Last updated:** 2026-08-28 · **Status:** current

Proyekto answers six *different* authorization questions with six *different* pieces of
state. They are independent by design. This page names all six in one place, states which
question each one answers, and fixes the rule that keeps them from collapsing into each
other.

The rule, in one line: **each axis answers exactly one question, and no guard, policy, or
`beforeLoad` may consult another axis's values to answer its own.**

That rule is not decorative. Proyekto has already paid for breaking it twice — once with
`profiles.role` and the `account_role` enum (deleted 2026-08-10), and once with
`project_access.origin`, which carried `'client'` and `'consultant'` values until
2026-08-18 and let a *how you joined* field masquerade as a permission input. Both were
removed rather than fixed. See [Personas](../01-product/personas.md).

## The six axes

| # | Axis | State | Values | Answers |
| --- | --- | --- | --- | --- |
| 1 | Project role | `project_access.role` | `owner > admin > editor > commenter > viewer` | What may I do **inside a project**? |
| 2 | Finance-book role | `finance_book_members.role` | `owner`, `manager`, `accountant`, `viewer_client`, `viewer` | What may I do **inside a finance book**? |
| 3 | Commercial position | `engagement_parties` (and `contract_positions`) | `hirer`/`provider` × `client`/`consultant`/`talent` | **Who hired whom**, on this agreement? |
| 4 | Marketplace capability | `consultant_profiles.status`, `talent_profiles.status`, `admin_profiles` | `verified`/`pending`/`suspended`/`revoked`; `active`; present/absent | May I **author contracts** / be **discovered** / **govern the platform**? |
| 5 | Engagement eligibility | derived | `engaged`, `grandfathered`, `ineligible` | Is this person's work on this project **contract-backed**? |
| 6 | Entitlement | `teams.time_tracking_enabled` (today) | enabled / not | Has this **team** turned on (later: paid for) the module? |

### 1. Project role — execution authorization

`project_access` is the **only** source of execution authorization. Nothing else grants
entry to a project: not a contract, not an engagement, not an assignment, not a finance
book. Resolution lives in
[`project-permissions.ts`](../../backend/src/modules/execution/projects/permissions/project-permissions.ts)
with per-member capability overrides over the ladder default.

### 2. Finance-book role — money-surface authorization

Books are a separate membership space, resolved by
[`finance-book-permissions.ts`](../../backend/src/modules/marketplace/finance/books/finance-book-permissions.ts)
— a pure `(role, overrides) → capabilities` function with no I/O, so it is snapshot-tested
and mirrorable on the web without drift. Because every finance service runs on
`SUPABASE_ADMIN`, whatever that function returns **is** the security boundary.

The load-bearing consequence: **a book member with every capability still has zero
execution access**, because books never write `project_access`. That is what lets an
external accountant or HR administrator see money without seeing the work. See
[Finance books](../11-domains/finance/finance-books.md).

### 3. Commercial position — who hired whom

Client, Consultant and Talent are **positions on a contract**, never account attributes.
The same account may pay for one project and deliver another. The database enforces the
matrix (`client_services`: hirer=client, provider=consultant; `talent_services`:
hirer=consultant, provider=talent) and forbids one user holding both seats.

Engagement reads are authorized by **party membership and nothing else** — a non-party
receives 404 rather than 403, so ids cannot be probed. See
[Engagement integration surface](../14-engagement/integration.md).

> **Constraint worth knowing before you design against this.**
> `engagement_parties.user_id` and `contract_positions.user_id` are **profile FKs**. A
> *team* or organization therefore cannot occupy a position today, even though the product
> intent is that any party — solo or team — may take any position. Expressing that requires
> the organization work in
> [organizations-and-services](../13-proposals/organizations-and-services.md); until it
> lands, a team's agreement is held by an individual account.

### 4. Marketplace capability — what you are allowed to become

Capability is stateful enrollment, not identity:

- `consultant_profiles.status = 'verified'` → may author contracts and reach consultant-only
  surfaces. Shared predicate: `is_active_consultant()` in SQL,
  [`consultant-capability.ts`](../../backend/src/common/auth/consultant-capability.ts) in
  TypeScript, behind `ConsultantOnlyGuard`.
- `talent_profiles.status = 'active'` → discoverable in the talent directory. It controls
  **public discovery only**; a consultant may privately contract any account.
- An active `admin_profiles` row → platform administration, behind `AdminGuard`.

Signup is lane-free and there is no account role. See
[auth-and-guards.md](./auth-and-guards.md).

### 5. Engagement eligibility — is this work contract-backed?

Derived, not stored, by
[`EngagementEligibilityService.getEngagementStatus(userId, projectId)`](../../backend/src/modules/marketplace/finance/eligibility/engagement-eligibility.service.ts):

| Value | Means |
| --- | --- |
| `engaged` | The user holds a **signed** `contract_positions` seat on a `signed`/`active` contract linked to the project — directly via `contracts.project_id`, or through `engagement_project_links` for flexible-scope contracts |
| `grandfathered` | No live seat, but the user predates enforcement: pre-cutoff time logs on the project, or a verified consultant with a pre-cutoff `project_access` row |
| `ineligible` | Neither |

The cutoff is the hardcoded constant `ENFORCEMENT_CUTOFF = '2026-08-27T00:00:00Z'`.
Results are cached in-process for 60 s per user+project, so contract signing takes up to a
minute to be reflected — an accepted staleness window, deliberately traded for keeping the
module dependency-free so both execution (`team-time`) and marketplace (`finance`) can
import it without a cycle.

One definition, three consumers — the timer gate, finance-book payroll membership, and
payout eligibility — so the three can never disagree.

### 6. Entitlement — has the team enabled the module?

[`EntitlementGuard`](../../backend/src/modules/execution/entitlements/entitlement.guard.ts)
with `@RequiresEntitlement('time_tracking')`. It is a **sibling** of `ConsultantOnlyGuard`,
deliberately *not* a fourth layer inside `resolvePermissions`: permissions answer "may this
role do this here", entitlement answers "has this team enabled the module". The route must
carry a `teamId` param — that is the billing subject; a route without one is not gated.

Today the resolver reads `teams.time_tracking_enabled` and everything is free. When billing
ships, the resolver swaps to an entitlements table without touching call sites. Refusal is
the typed `ADDON_NOT_ENABLED`.

## How the axes compose

Two worked examples, because the combinations are where testing goes wrong.

**A talent member starting a timer** is checked on four axes in turn:

```text
project role      project_access >= editor        ── else no project entry at all
entitlement       teams.time_tracking_enabled     ── else ADDON_NOT_ENABLED
eligibility       engaged | grandfathered         ── else depends on the dial below
enforcement dial  teams.contract_enforcement
                    off     -> log freely
                    warn    -> log, with contract_warning; manual logs stamped
                               flagged_reason='no_active_contract'
                    enforce -> startLog refused with typed NO_ACTIVE_CONTRACT
```

A contract lapsing mid-timer never kills a running timer; `stopLog` stamps
`flagged_reason='contract_lapsed'` best-effort instead.

**A client opening their own agreement** is checked on exactly one axis — commercial
position. Not consultant capability, not project role, not book membership. This is the
axis confusion most likely to produce a wrong gate, because the surface *looks* like
finance: `GET /api/engagements` carries `SupabaseAuthGuard` alone, and adding
`ConsultantOnlyGuard` there would lock Clients and Talent out of reading their own
agreements.

## Anti-patterns

| Do not | Because |
| --- | --- |
| Gate on a declared identity or stated intent | `marketplace_survey_responses.intents` is personalization; `scripts/check_survey_is_not_authz.mjs` fails the build if it is referenced from an authorization path |
| Infer a billing counterparty from `projects.owner_id` or a `project_access` row | A project is the execution layer and does not model the two sides of a commercial arrangement — the parties live on the contract |
| Let an engagement, assignment, or finance book grant project access | `project_access` is the sole execution authorization source; no engagement table is consulted by any authorization path |
| Read `project_access.origin` as a role | Origin records *how* someone joined and takes no part in permission resolution |
| Add a second module that touches engagement tables | All nine have RLS enabled with **zero** policies; `EngagementsService` owns redaction so the party-scoping rule has exactly one implementation |
| Re-derive a status label locally | One vocabulary, in [`web/src/lib/finance-status.ts`](../../web/src/lib/finance-status.ts) |

## Related documentation

- [auth-and-guards.md](./auth-and-guards.md) — the guards themselves
- [Personas](../01-product/personas.md) — why there is no account role
- [Engagement integration surface](../14-engagement/integration.md) — party-scoped reads
- [Engagement action surface](../14-engagement/action-surface.md) — which seat may do what
- [Finance books](../11-domains/finance/finance-books.md) — axis 2 in full
- [RLS and security](../07-data-and-db/rls-and-security.md)
