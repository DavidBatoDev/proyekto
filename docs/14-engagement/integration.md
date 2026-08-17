# Engagement Integration Surface

> **Last updated:** 2026-08-18 · **Status:** current

This page is the contract for building against P4b. It states what the engagement model
actually exposes today, what it does not, and the rules any new marketplace surface must
hold. Read it before adding an engagement-aware page — several of the tables below look
available but cannot be reached from the web client at all.

## The one-sentence summary

Contract signing now creates engagements in production, but **nothing reads them**: there
is no backend engagement module, no HTTP route returns an engagement, and RLS denies the
web client direct access to every engagement table. The write path is finished; the read
path does not exist.

## What is live

All 9 tables exist in production with the column counts below (verified against
`information_schema.columns` on 2026-08-18).

| Table | Columns | Written by | Read by |
| --- | --- | --- | --- |
| `contract_positions` | 14 | Contract create/amend, and the signing RPC | Contract payload composition |
| `engagements` | 14 | `sign_contract_position_and_activate` | nothing |
| `engagement_parties` | 7 | `sign_contract_position_and_activate` | nothing |
| `engagement_project_links` | 12 | `sign_contract_position_and_activate` | nothing |
| `engagement_time_settings` | 14 | `sign_contract_position_and_activate` | nothing |
| `engagement_time_rates` | 13 | `sign_contract_position_and_activate` | nothing |
| `engagement_assignments` | 16 | nothing yet | nothing |
| `engagement_time_approvals` | 14 | nothing yet | nothing |
| `engagement_time_approval_items` | 8 | nothing yet | nothing |

Activation happens entirely inside one `SECURITY DEFINER` function. There is no
`backend/src/modules/marketplace/engagements/` module, and no backend file contains a
`from('engagements')` or `from('engagement_*')` call.

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

The only engagement data any of these return is the opaque `engagement_id` on the
contract payload. The web `Contract` type carries `engagement_id: string | null` and
nothing else engagement-shaped.

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

The practical consequence: **every engagement read must be a new backend route that
applies its own redaction.** There is no "just query it from the client" shortcut, and
that is deliberate — the redaction rules below cannot be enforced in the browser.

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

The RPC raises typed tokens. The backend currently maps exactly one of them:

| Token | Current HTTP result |
| --- | --- |
| `CONSULTANT_ENROLLMENT_INACTIVE` | 409 with a written explanation |
| everything else below | 400 carrying the **raw token** as the message |

The unmapped tokens are `CONTRACT_POSITION_INVALID`, `CONTRACT_NOT_FOUND`,
`CONTRACT_NOT_SIGNABLE`, `CONTRACT_ALREADY_SIGNED`, `CONTRACT_PROJECT_SEVERED`,
`CONTRACT_TERM_INCOMPLETE`, `CONTRACT_FIXED_FEE_REQUIRED`, `CONTRACT_MONTHLY_RATE_REQUIRED`,
`CONTRACT_HOURLY_RATE_REQUIRED`, `CONTRACT_REQUIRES_TWO_POSITIONS`,
`CONTRACT_SELF_DEALING`, `ENGAGEMENT_PARTIES_MISMATCH`, `AMENDMENT_EFFECTIVE_DATE_PAST`,
and `AMENDMENT_EFFECTIVE_DATE_NOT_PROSPECTIVE`. The `tg_contracts_lock_parties` trigger
adds `CONTRACT_CONSULTANT_PARTY_LOCKED`, `CONTRACT_CLIENT_PARTY_LOCKED`,
`CONTRACT_COMMERCIAL_IDENTITY_LOCKED`, and `CONTRACT_PROJECT_SCOPE_LOCKED`.

**Known gap:** most of these reach the user as a raw token. Any signing UI built now
should map them to human copy in the client, and the durable fix is a mapping layer in
`stampSignature` rather than per-page string matching.

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

1. **Read APIs first**, with redaction — a position-redacted engagement list and detail.
   Everything else is unbuildable without them.
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
# read surface (expect no output)
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
