# Engagement Integration Surface

> **Last updated:** 2026-08-18 · **Status:** current

This page is the contract for building against P4b. It states what the engagement model
actually exposes today, what it does not, and the rules any new marketplace surface must
hold. Read it before adding an engagement-aware page — several of the tables below look
available but cannot be reached from the web client at all.

## The one-sentence summary

Contract signing creates engagements, and a **party-scoped read path now exists** —
`GET /api/engagements` plus an Engagements tab on `/finance`. What is still missing is
everything downstream: assignments, attributed time, submission, and approval have no
writer and no route.

## What is live

All 9 tables exist in production with the column counts below (verified against
`information_schema.columns` on 2026-08-18).

| Table | Columns | Written by | Read by |
| --- | --- | --- | --- |
| `contract_positions` | 14 | Contract create/amend, and the signing RPC | Contract payload composition |
| `engagements` | 14 | `sign_contract_position_and_activate` | `EngagementsService` |
| `engagement_parties` | 7 | `sign_contract_position_and_activate` | `EngagementsService` (scoping + counterparty) |
| `engagement_project_links` | 12 | `sign_contract_position_and_activate` | `EngagementsService` |
| `engagement_time_settings` | 14 | `sign_contract_position_and_activate` | `EngagementsService` (effective row only) |
| `engagement_time_rates` | 13 | `sign_contract_position_and_activate` | `EngagementsService` (effective rows only) |
| `engagement_assignments` | 16 | nothing yet | nothing |
| `engagement_time_approvals` | 14 | nothing yet | nothing |
| `engagement_time_approval_items` | 8 | nothing yet | nothing |

Activation happens entirely inside one `SECURITY DEFINER` function. Reads go through
`backend/src/modules/marketplace/engagements/`, which is the only module permitted to
touch these tables — it runs on the admin client because RLS denies everyone else, so it
owns the redaction itself.

### HTTP surface

Every route is under the global `/api` prefix. Two controllers share the `contracts` path.

| Route | Purpose |
| --- | --- |
| `GET /api/contracts/project/:projectId` | Contracts for a project |
| `POST /api/contracts/counterparties/resolve` | Exact-email counterparty lookup |
| `POST /api/contracts` | Create a draft |
| `GET /api/contracts/:id` | Contract detail |
| `PATCH /api/contracts/:id` | Edit a `draft` or `sent` contract |
| `DELETE /api/contracts/:id` | Delete a draft |
| `POST /api/contracts/:id/sign` | Stamp a signature; may activate the engagement |
| `POST /api/contracts/:id/unsign` | Withdraw a signature |
| `PATCH /api/contracts/:id/signature-placement` | Cosmetic signature reposition |
| `POST /api/contracts/:id/amend` | Create the next contract version |
| `POST /api/contracts/:id/provider` | Provider identity |
| `GET`/`POST`/`DELETE /api/contracts/:id/signature-link` | Manage a signing link |
| `GET`/`POST /api/contracts/sign/:token` | Public token signing |
| `GET /api/engagements` | Engagements the caller is a party to (`kind`, `status`, `project_id` filters) |
| `GET /api/engagements/:id` | One engagement, 404 if the caller holds no seat |

Contract routes still expose only the opaque `engagement_id`. Everything engagement-shaped
comes from the two `/api/engagements` routes, which return the viewer's seat, the
counterparty, project links, and the settings and rates effective today. Superseded
effective-dated rows are filtered server-side rather than returned for the client to sort.

### Authorization model for engagement reads

Party membership, and nothing else. A caller sees an engagement only when they occupy one
of its two seats, which is what keeps the commercial sides apart without a separate
redaction pass. Two consequences worth knowing before extending this:

- There is deliberately **no** "list every engagement on this project" route. It would have
  to re-derive the redaction that party scoping gives for free.
- A non-party fetch returns 404, not 403, so the endpoint cannot be used to probe which
  engagement ids exist.
- The controller uses `SupabaseAuthGuard` alone. `ConsultantOnlyGuard` would gate on a
  capability rather than the position that owns the row, and would lock Clients and Talent
  out of reading their own agreements.

### Web routes

`web/src/routes/_marketplace/` holds `finance/index.tsx` (portfolio and creation),
`finance/$contractId.tsx` (editor, terms, signatures, amendments), `contract/sign/$token.tsx`
(public signing), the two invoice routes, plus the `consultant/`, `freelancer/`, and
`project-posting` surfaces.

## Access posture — read this before designing a query

All 9 tables have **RLS enabled with zero policies**. That is deny-all for `anon` and
`authenticated`: the browser's Supabase client cannot select a single engagement row, and
adding a client-side query will silently return empty rather than error in the usual way.
Only the backend's `service_role` client can reach them.

The practical consequence: **every engagement read must go through a backend route that
applies its own redaction.** There is no "just query it from the client" shortcut, and
that is deliberate — the redaction rules below cannot be enforced in the browser. Route
engagement reads through `EngagementsService` rather than adding a second module that
touches these tables, so the party-scoping rule has exactly one implementation.

## What one successful final signature writes

```text
POST /api/contracts/:id/sign
        |
        v
  positions.length == 2 ?
        |                 \
        | yes              no --> sign_contract_and_flip   (legacy compat path,
        v                                                   writes no engagement)
  sign_contract_position_and_activate
        |
        +-- lock contract row (FOR UPDATE)
        +-- validate positions + commercial terms
        +-- recheck Consultant enrollment
        +-- stamp this position's signature
        |
        +-- both positions signed?
              |
              +-- no  --> return contract (status may flip draft -> sent)
              |
              +-- yes --> create engagement
                          + 2 immutable engagement_parties
                          + engagement_project_links   (project_specific only)
                          + engagement_time_settings
                          + engagement_time_rates      (per billing_mode)
                          + supersede prior signed contract in the family
                          + contract.status = 'signed'
```

Activation is idempotent under the row lock, so a duplicate request cannot create a second
engagement. Signing does **not** create an assignment — that stays an explicit later step.

## Error codes

The RPC, its legacy wrapper, and the `tg_contracts_lock_parties` trigger all signal with
typed tokens. `SIGNING_ERRORS` in `contracts.service.ts` translates all 22 into human copy
and the right status:

| Kind | Status | Examples |
| --- | --- | --- |
| Missing row | 404 | `CONTRACT_NOT_FOUND` |
| State conflict | 409 | `CONSULTANT_ENROLLMENT_INACTIVE`, `CONTRACT_ALREADY_SIGNED`, `CONTRACT_NOT_SIGNABLE`, `ENGAGEMENT_PARTIES_MISMATCH`, `ENGAGEMENT_REQUIRES_TWO_PARTIES`, the four `*_LOCKED` tokens |
| Incomplete agreement | 400 | `CONTRACT_REQUIRES_TWO_POSITIONS`, `CONTRACT_TERM_INCOMPLETE`, `CONTRACT_{FIXED_FEE,MONTHLY_RATE,HOURLY_RATE}_REQUIRED`, `CONTRACT_SELF_DEALING`, `CONTRACT_PROJECT_SEVERED`, `CONTRACT_POSITION_INVALID`, `AMENDMENT_EFFECTIVE_DATE_{PAST,NOT_PROSPECTIVE}` |

Add new tokens to that table rather than matching strings per page. An unrecognised token
still surfaces its raw message instead of being swallowed, so a newly added one is visible
in support rather than silently generic — there is a test asserting exactly that.

## Invariants a page may rely on

| Invariant | Enforced by |
| --- | --- |
| An engagement exists only after a fully signed root contract | The activation RPC |
| Exactly two parties, hirer and provider, and never the same user | `engagement_parties` constraint + `CONTRACT_SELF_DEALING` |
| Parties, `relationship_kind`, `scope_mode`, and `contract_family_id` are frozen once a contract is `sent` | `tg_contracts_lock_parties` |
| Project scope may only transition to `NULL`, on project delete | Same trigger |
| Rate and settings changes are effective-dated and prospective | Amendment rollover in the RPC |
| An engagement never grants project access | No engagement table is consulted by any authorization path |
| Nothing was backfilled | Production held 0 engagement and 0 position rows at deploy |

## Redaction rules any engagement read must hold

These are product-locked, and because RLS denies direct access the backend route is the
only place they can be enforced:

- A Client must never see Talent identity, Talent cost rates, payouts, or Consultant margin.
- Client revenue (`client_services`) and Talent cost (`talent_services`) are separate
  engagements and must never be merged into one figure.
- `engagement_time_rates.rate_kind` is `billing` on client engagements and `cost` on talent
  engagements — leaking a `cost` row to a Client is the exact failure this model exists to
  prevent.

## Build order for the next slice

1. ~~**Read APIs first**, with redaction — a position-redacted engagement list and detail.~~
   Shipped 2026-08-18: `EngagementsService`, the two `/api/engagements` routes, and the
   Engagements tab on `/finance`.
2. Engagement assignment APIs and UI, including flexible-engagement project placement.
3. Attributed timers and manual time logs writing `task_time_logs.engagement_assignment_id`.
4. Talent submission, then Consultant approval/rejection.
5. Approval-driven payout consumption.
6. Milestone billing for fixed contracts, which are manual-invoice only today.

Historical backfill stays rejected at every step.

## Re-verifying this page

```bash
# tables and column counts
#   information_schema.columns where table_name like 'engagement%'
# RLS posture
#   pg_class.relrowsecurity + pg_policies count per table
# read surface — expect hits only under modules/marketplace/engagements/
grep -rn "from('engagement" backend/src --include=*.ts
# routes
grep -nE "@(Get|Post|Patch|Delete)\(" backend/src/modules/marketplace/contracts/*.controller.ts
```

## Related documentation

- [Engagements hub](./README.md)
- [Data model](./data-model.md)
- [Lifecycle and edge cases](./lifecycle-and-edge-cases.md)
- [Scenarios](./scenarios.md)
- [Finance](../11-domains/finance/README.md)
