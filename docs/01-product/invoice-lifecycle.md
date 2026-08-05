# Invoice Lifecycle

> **Last updated:** 2026-08-05 · **Status:** draft

Proyekto invoices are the client-facing side of project billing. A contract supplies commercial terms, completed work becomes client-priced line items, and the consultant reviews every document before it can reach the client. Payment happens outside Proyekto; the consultant records the result here so billed, collected, and outstanding money stay distinct.

> **Note:** The receivables workflow is implemented in the repository and becomes available when `20260805040000_invoice_receivables.sql` is applied.

## Lifecycle

```text
Contract terms or a manual request
              |
              v
        Draft invoice
              |
              +-- edit lines, dates, notes, and PDF
              |
              v
         Issue and send
              |
              +-- final PDF is stored and emailed
              |
              v
     Issued / awaiting payment ---- due date passes ----> Overdue
              |
              +-- record external payment
              v
      Partially paid -------------> Paid
```

## Starting an invoice

| Path | When to use it | Rule |
| --- | --- | --- |
| Manual draft | Deposit, milestone, change request, or one-off service | The consultant enters client-facing line items. A contract is optional. |
| Scheduled draft | Recurring contract period | Requires a signed or active contract. The scheduler creates a draft only; it never emails a client. |
| Attached hours | Time-based or hybrid work | Requires a live contract so hours are priced at the client rate. Only approved or paid real-work logs are included, net of breaks. |

Internal team rate snapshots, team allocation, and member identity never appear on a client invoice. See the [backend invoice service](../../backend/src/modules/invoices/invoices.service.ts) and [composition service](../../backend/src/modules/invoices/invoice-composition.service.ts).

## States and actions

| State | Meaning | Allowed actions |
| --- | --- | --- |
| Draft | Internal work in progress; the client has not seen it. | Edit, delete, generate a preview PDF, issue. |
| Issued | Final document exists and a balance is due. Email delivery is tracked separately by `sent_at`. | Re-send final PDF, record payment, void and replace. |
| Partially paid | Payments exist but the balance is not zero. | Record another payment or reverse an incorrect payment. |
| Paid | Recorded payments equal the invoice total. | View the final PDF and payment history. |
| Void | A preserved, cancelled issued invoice. | View its reason and linked replacement; no edit, send, or payment action. |

**Overdue** is a derived label, not a stored state: the due date has passed and a non-zero balance remains.

## Issuing and delivery

Issue is the boundary between a working draft and a commercial document. Proyekto verifies a client recipient, sets the issue date, finalizes the PDF in the private R2 bucket, locks invoice content, records the issue event, and emails the stored PDF.

Email address resolution is: contract client-email snapshot, linked recipient account, then the project client account. A delivery failure does not undo issuance; the consultant fixes the recipient and uses **Re-send**. Re-sends attach the stored final PDF, not a re-rendered version.

## Payments and corrections

Payments are manual records of an external bank transfer, GCash payment, card charge, or similar event. Each record stores amount, payment date, optional method, reference, and note. Proyekto rejects a payment that exceeds the remaining balance.

Payment entries are immutable. If one is wrong, the consultant records an equal reversal with a required reason. The original and reversal remain in the invoice event history, and the balance and state are recalculated.

An issued invoice with no active payments can be corrected through **Void and replace**: the consultant gives a reason, the original becomes `void`, and Proyekto creates a linked replacement draft with copied client-facing content and a new invoice number. The replacement is manual so it cannot collide with scheduled-period deduplication.

## Reporting terms

| Term | Definition |
| --- | --- |
| Billed | Total value of issued, partially paid, and paid invoices. |
| Collected | Sum of active payment records. Reversed payments reduce this amount. |
| Outstanding | Billed amount minus collected amount. |
| Billed margin | Billed revenue minus delivery cost. |

Amounts are grouped by currency; Proyekto does not convert across currencies. The Finance portfolio presents billed, collected, and outstanding values per currency.

## Access and audit

Only a verified consultant with finance access to the project can create, issue, record, reverse, void, or replace invoices. Invoice PDFs and receivables records are served through the API; browser clients do not have direct access to the accounting tables. The event history records creation, issue, PDF finalization, email outcomes, payments, reversals, voiding, and replacement creation.

## Related references

- [Project lifecycle](./project-lifecycle.md#6-billing)
- [Backend API reference](../03-backend/api-reference.md)
- [Invoice receivables migration](../../supabase/migrations/20260805040000_invoice_receivables.sql)
