# Payments, Payouts & Invoices

> **Last updated:** 2026-08-11 · **Status:** current

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
| `contracts` | Commercial agreement and immutable party/project-title snapshots |
| `invoices` | Invoice header (`status` = draft \| issued \| sent \| paid \| void) |
| `invoice_line_items` | Lines (`source_type` = manual \| time_log) |
| `invoice_documents` | Generated PDFs (storage path) |

HTTP: create, get/update, `POST /invoices/:id/issue`, `POST /invoices/:id/generate-pdf`.

Finance access requires active consultant capability plus a `project_access` row with
`role=owner` and `origin=consultant`; that access row is also the consultant-of-record.
Project deletion is refused while contracts are sent/signed/active or
invoices are issued/sent. Drafts are discarded; ended/cancelled contracts and paid/void
invoices survive with `project_id=NULL` and their project-title snapshots intact.

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
