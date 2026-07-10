# Payments, Payouts & Invoices

> **Last updated:** 2026-07-09 · **Status:** current

Money in Proyekto flows through three modules — but only two of them are live. The
**payouts** and **invoices** modules are the shipped financial path; the older
**payments** (escrow/checkpoints) module is largely vestigial after its tables were
dropped. `wallets` still exist for balances.

> **⚠️ Read this first:** `payment_checkpoints` and `transactions` were **dropped**
> on 2026-01-11 and never recreated. The `payments` module's fund/release/refund
> escrow code queries those missing tables and is effectively dead. Treat
> **payouts + invoices** as the real money system. See
> [Data → schema overview](../07-data-and-db/schema-overview.md).

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
  ([Backend → api reference](../03-backend/api-reference.md#payouts--payout-methods--payouts)).

## Invoices (live)

Project invoices with line items (manual or sourced from time logs) and a generated
PDF.

| Table | Holds |
| --- | --- |
| `invoices` | Invoice header (`status` = draft \| issued \| sent \| paid \| void) |
| `invoice_line_items` | Lines (`source_type` = manual \| time_log) |
| `invoice_documents` | Generated PDFs (storage path) |

HTTP: create, get/update, `POST /invoices/:id/issue`, `POST /invoices/:id/generate-pdf`.

## Wallets (partial)

`wallets` (available + escrow balance per user) still exist and the `GET
/payments/wallet[/transactions]` reads work. The escrow *mutation* RPCs
(`fund_escrow`, `release_milestone`, `refund_escrow`) reference the dropped
`transactions`/`payment_checkpoints` tables and are dead.

## How money connects to work

```
task_time_logs  ──approved──►  payouts (per member, single currency)
                └──────────►  invoice_line_items ──►  invoices ──►  invoice_documents (PDF)
```

Billable time (see [teams-and-time.md](./teams-and-time.md)) is the source for both
payouts and invoices.

## Code locations

- **Backend:** [`backend/src/modules/payouts/`](../../backend/src/modules/payouts/), [`backend/src/modules/invoices/`](../../backend/src/modules/invoices/), [`backend/src/modules/payments/`](../../backend/src/modules/payments/) (legacy)
- **Payout RPCs:** `create_payout_and_mark_paid`, `void_payout_and_revert` (see [migrations-workflow.md](../07-data-and-db/migrations-workflow.md))
