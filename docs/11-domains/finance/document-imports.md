# Finance Document Imports

> **Last updated:** 2026-08-28 · **Status:** current (code) / **not deployed** (database)

> **⚠️ The migration is not applied to production.** The code is merged and the routes are
> wired, but
> [`20260826090000_finance_document_imports.sql`](../../../supabase/migrations/20260826090000_finance_document_imports.sql)
> appears in **no** applied migration version — the newest applied versions are
> `20260827103415 finance_books` and `20260827104156 timer_contract_enforcement`. Verified
> 2026-08-28 against the live migration list. Until it is applied via the Supabase MCP
> `apply_migration` tool (**never** `supabase db push` — see
> [supabase/CLAUDE.md](../../../supabase/CLAUDE.md)), every `finance-imports` route fails on
> the missing tables and `origin='imported'` is rejected by the still-narrow
> `invoices_origin_check`.

Recording invoices and payments that were **created outside Proyekto** — the backfill path
for billing that predates the platform, or that runs beside it.

## The shape

```text
upload a document
      |
      v
server reads the PDF text layer
      |
      v
an LLM drafts the header fields          <- suggestions only, never authoritative
      |
      v
snip regions on the rendered page        <- each figure gets a visual evidence anchor
      |
      v
commit into the existing invoices /
invoice_payments tables, origin='imported'
```

The design intent is DataSnipper-style: **every committed figure keeps a pointer back to the
region of the source document it came from**, so a number in Proyekto can always be traced
to the paper it was read off. Extraction is a drafting aid; a human commits.

## Schema

| Table / column | Holds |
| --- | --- |
| `finance_documents` | The uploaded file: `kind` (`invoice` / `payment_proof` / `other`), `extraction_status` (`pending` / `ready` / `failed` / `skipped`), `size_bytes` (must be > 0) |
| `finance_document_snips` | One evidence region: `page` (≥ 1), `origin` (`snip` / `extraction` / `manual`), and a required link to `invoice_id` **or** `payment_id` |
| `invoices.source_document_id` | The document an imported invoice came from |
| `invoices.origin` | Widened from `manual \| scheduled` to include `imported` |
| `invoice_payments.settled_currency`, `settled_amount`, `fx_rate`, `proof_document_id` | Settlement facts |

Two constraints carry the rules: `invoices_imported_needs_document_check` makes
`source_document_id` mandatory whenever `origin = 'imported'` — an imported invoice with no
document is not a record, it is a claim — and `invoice_payments_settlement_check` keeps the
settlement fields coherent.

**FX lives on the payment, never on the invoice.** An AUD invoice settled by PESONet lands
as PHP at that individual transfer's own rate (42.1650 on 2026-08-14; 41.3724 on
2026-06-26). Putting a rate on the invoice would force one rate onto a bill that may be
settled in several transfers on several days.

Both new tables have RLS enabled with an explicit `*_api_only` deny policy
(`FOR ALL TO authenticated USING (false) WITH CHECK (false)`) — a stated denial rather than
the zero-policy default used elsewhere, but the same posture: backend-only.

## HTTP surface

| Route | Purpose |
| --- | --- |
| `POST /api/finance-imports/documents` | Upload |
| `GET /api/finance-imports/documents` | List |
| `GET /api/finance-imports/documents/:id` | Detail |
| `GET /api/finance-imports/documents/:id/file` | Presigned fetch of the original |
| `POST /api/finance-imports/documents/:id/read` | Run extraction |
| `DELETE /api/finance-imports/documents/:id` | Remove |
| `POST /api/finance-imports/invoices` | Commit an imported invoice |
| `GET /api/finance-imports/invoices/:invoiceId/snips` | The evidence behind one invoice |

Backend: [`backend/src/modules/marketplace/finance-imports/`](../../../backend/src/modules/marketplace/finance-imports/)
(`finance-imports.service.ts`, `invoice-reader.service.ts`).

## Web surface

The Imports tab at `/engagements/finance/imports` (project-scoped — a project must be picked
first) and the snipping workspace at `/engagements/finance/imports/$documentId`, built on
`components/finance/imports/DocumentCanvas.tsx` and `SnipField.tsx`. `pdfjs-dist` renders
the page and resolves a snipped region back to text.

## How this relates to adopted engagements

Document imports bring in the **money**; the
[off-platform engagement adoption](../../13-proposals/off-platform-engagement-adoption.md)
proposal brings in the **relationship**. They compose deliberately and must not be merged:
an imported invoice is evidence of a past transaction, while an adopted engagement is a
live commercial relationship going forward. A project migrating into Proyekto typically
needs both — adopt the agreement, then import the invoices already raised under it.

## Related documentation

- [Finance hub](./README.md) — the invoice and payment tables this writes into
- [Finance books](./finance-books.md)
- [Invoice lifecycle](../../01-product/invoice-lifecycle.md)
- [Migrations workflow](../../07-data-and-db/migrations-workflow.md) — the production apply path
