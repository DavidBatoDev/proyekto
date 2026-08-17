# Payments, Payouts & Invoices

> **Last updated:** 2026-08-18 · **Status:** current

Money in Proyekto flows through the **payouts** and **invoices** modules. The dead
payments/escrow backend surface was removed in Phase 3. `wallets` remains as
provisioned balance storage, but it has no HTTP module.

> **⚠️ Read this first:** `payment_checkpoints` and `transactions` were **dropped**
> on 2026-01-11 and never recreated. Phase 3 removed the dead backend module and
> the remaining `fund_escrow` / `refund_escrow` functions. Treat **payouts +
> invoices** as the real money system. See
> [Data → schema overview](../../07-data-and-db/schema-overview.md).

## Payouts (live)

Manual payouts group a team member's **approved, single-currency** time logs into a
recorded payout, with a snapshotted payout method and a proof document.

| Table | Holds |
| --- | --- |
| `payout_methods` | Saved methods (bank / GCash / QR), snapshotted onto a payout |
| `payouts` | A recorded payout (`status` = recorded \| void), grouping billable logs |

- **Lifecycle** goes through `SECURITY DEFINER` RPCs `create_payout_and_mark_paid`
  and `void_payout_and_revert` (which also flip the source `task_time_logs` paid
  status).
- **Proof documents** upload to the **private R2 bucket** (`payout_proofs`) via the
  `uploads` module and are served through presigned GETs.
- HTTP under `/payout-methods` and `/payouts`
([Backend → api reference](../../03-backend/api-reference.md#payouts--payout-methods--payouts)).

## Invoices (live)

Project invoices with line items (manual or sourced from time logs) and a generated
PDF.

| Table | Holds |
| --- | --- |
| `contracts` | Commercial agreement with a durable consultant seat and immutable terminal party/project-title snapshots |
| `invoices` | Invoice header (`status` = draft \| issued \| sent \| paid \| void) |
| `invoice_line_items` | Lines (`source_type` = manual \| time_log) |
| `invoice_documents` | Generated PDFs (storage path) |

HTTP: create, get/update, `POST /invoices/:id/issue`, `POST /invoices/:id/generate-pdf`.

Finance access requires active consultant capability plus a `project_access` row with
`role=owner` — a verified consultant, on a project they own. The predicate used to also
require `origin=consultant`; that origin no longer exists, and the execution layer no longer
designates a consultant of record. Note this is deliberately narrower than the finance RLS
(`20260811092000_finance_rls_project_access_only.sql`), which allows `owner|admin`: only
`finance.controller.ts` carries `ConsultantOnlyGuard`, so on the other four finance
controllers `assertProject` *is* the authorization, and these services run as
`SUPABASE_ADMIN` where RLS never backstops them.

Project deletion is refused while contracts are sent or signed, or while
invoices are issued/sent. Drafts are discarded; ended/cancelled contracts and paid/void
invoices survive with `project_id=NULL` and their project-title snapshots intact.

The consultant finance lists include the caller's severed contracts and linked invoices,
labeled from `project_title_snapshot`. Direct contract reads are position-based, so both
stored parties retain read-only access after severance. The portfolio summary and invoice
scheduler remain attached-project views: severed rows are intentionally absent from portfolio
totals and cannot drive future scheduled billing. Project lifecycle status does not control
whether a signed contract schedules invoice drafts.

## Contract parties

A contract is where the two sides of a piece of work are recorded. **A project is not.**
A project is the execution layer: it has members with a permissions catalog, and it does not
assume it has "a client" and "a consultant". Never infer a billing counterparty from
`projects.owner_id` or from a `project_access` row.

The paying counterparty is **snapshotted on the contract** — `client_name`,
`client_contact_name`, `client_address`, `client_tin`, `client_email`, and a nullable
`client_user_id`. They may never hold an account at all. `client_hourly_rate` is what the
client pays and is the invoice price; it is not a cost figure.

A signed contract's party snapshot is the billing authority.

| Action | Who |
| --- | --- |
| Read a live or severed contract | `client_user_id`, or the distinct live project owner when no client seat is stored |
| Sign the client party | Same rule |
| Edit, unsign, or move a signature | Not allowed from the client side |
| Sign a severed contract | Not allowed; severed contracts are durable read-only history |

### Tokenized signing

A counterparty with no account reaches exactly one surface in the product: the signing page
at `/contract/sign/$token`, which needs no login. `contract_signature_links` holds a
single-use 256-bit `token`, a `party` column constrained to `'client'`, and an `expires_at`
defaulting to 14 days. Token signing runs the same enrollment and severance checks as in-app
signing — the link is a delivery mechanism, not a bypass.

## Contract signing and invoice provenance

- Contract creation stores `consultant_user_id`; amendments inherit the seat.
- Every signature stamp re-checks the seat's active consultant enrollment in TypeScript and
  in the row-locking `sign_contract_and_flip` transaction. Severed contracts cannot sign.
- The final signature, prior-signed-contract supersede, and status flip are atomic.
- Invoice recomposition resolves the invoice's stored `contract_id` exactly. It never falls
  forward to a newer signed contract, so an amended agreement cannot silently reprice an old
  draft. If that exact contract is unavailable, stored priced lines remain authoritative.

## Wallets (retained storage)

`wallets` (available + escrow balance per user) still exists because
`create_wallet_for_user` participates in new-user provisioning. There is no payments
controller or wallet HTTP API; changing that table or trigger is a separate decision.

## How money connects to work

```
task_time_logs  ──approved──►  payouts (per member, single currency)
                └──────────►  invoice_line_items ──►  invoices ──►  invoice_documents (PDF)
```

Billable time (see [Teams and Time](../teams-and-time/README.md)) is the source for both
payouts and invoices.

## Code locations

- **Backend:** [`backend/src/modules/marketplace/payouts/`](../../../backend/src/modules/marketplace/payouts/), [`backend/src/modules/marketplace/invoices/`](../../../backend/src/modules/marketplace/invoices/)
- **Payout RPCs:** `create_payout_and_mark_paid`, `void_payout_and_revert` (see [migrations-workflow.md](../../07-data-and-db/migrations-workflow.md))
