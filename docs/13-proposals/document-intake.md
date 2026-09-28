# Document Intake

> **⚠️ Proposed — not built.**

> **Last updated:** 2026-09-28 · **Status:** draft

A single place in Engagements where someone uploads the paper behind work that started outside
Proyekto: signed contracts, amendments, invoices, receipts and proofs of payment. The AI
detects each document, classifies it, extracts its fields and builds the matching Proyekto
records. A person confirms every record before it exists.

**The purpose is migration, not bookkeeping.** A consultant with three running client
engagements on paper should be able to bring all three into Proyekto in one sitting and come
out with projects, recorded agreements, invoice history and invitations to their clients. Until
the marketplace on `main` is ready, this is a way to acquire users: every imported agreement has
a counterparty, and every counterparty gets an invitation to confirm it.

## How it relates to existing work

| Piece | State | Role here |
| --- | --- | --- |
| [off-platform-engagement-adoption.md](./off-platform-engagement-adoption.md) | Proposed | The legal model for a contract signed outside Proyekto: `execution_origin = 'external'`, the uploaded document as evidence, attestation by **both** parties. Intake is the front door to it; it does not change its rules |
| Finance document imports (`finance_documents`, the snip model, `invoice-reader.service.ts`) | Built on `feat/finance-imports-ship`; **reverted off `main` by David; migration `20260826090000` not in production** | The storage, extraction and field-provenance model intake reuses for invoices and receipts |
| [two-way-contract-authoring.md](./two-way-contract-authoring.md) | Proposed | Recorded agreements get the same version history and AI change summary as any other contract |

**Intake cannot ship until David and August agree on bringing the imports work back to `main`.**
It depends on that code and that table.

## The pipeline

```text
 upload ──> detect ──> classify ──> extract ──> group ──> review ──> replicate ──> invite
 (files)   (split     (contract,   (fields +   (by       (person    (create      (counterparty
           pages      amendment,   source      parties   confirms   records)     attests)
           into docs) invoice,     boxes)      and       each
                      receipt)                 refs)     record)
```

| Stage | What happens | Who decides |
| --- | --- | --- |
| **Upload** | PDFs, phone photos, scans; many files at once. Each file is hashed; a file already imported is flagged, not re-read | — |
| **Detect** | A single scan can hold several documents (a contract followed by three invoices). Pages are split into documents by page-level classification and page-number/heading breaks | AI; the person can re-split |
| **Classify** | Each document gets a type: `contract`, `amendment`, `invoice`, `receipt`, `proof_of_payment`, `other` | AI; the person can change it |
| **Extract** | Type-specific fields (below). Every value carries the page and box it came from, as the imports snip model already does, plus a confidence | AI; every field is editable |
| **Group** | Documents are grouped into **relationships**: same two parties. Invoices are matched to a contract by parties, reference numbers and dates; payments to invoices by amount, date and reference | AI proposes; the person confirms |
| **Review** | One screen per relationship: the original on the left, the extracted record on the right, low-confidence fields highlighted. Nothing below this line happens without **Confirm** | Person |
| **Replicate** | Creates the Proyekto records (below) | System, from the confirmed data |
| **Invite** | The counterparty is invited to attest the recorded agreement, by account or token link | Counterparty |

### Who may run intake

**Consultants and clients.** Whoever uploads becomes the *importer* and takes the seat the
document shows them in. The other party is the one invited to attest. A client importing their
provider's contract produces the same recorded agreement a consultant would; only the direction
of the invitation changes. The contract then defines each person's role, as in
[two-way-contract-authoring.md](./two-way-contract-authoring.md).

### Handwriting and language

Typed English and handwritten English. Other languages are out of scope for now; a document the
model identifies as another language is flagged in review rather than extracted.

Handwriting is where the model will most often be unsure (signatures, handwritten dates and
amounts, margin notes). That is what the correction step below is for.

### Fields per type

| Type | Fields |
| --- | --- |
| Contract | Parties (names, emails, legal names, addresses, tax IDs), date signed, service start and end, rates and currency, billing mode and timing, payment terms, notice period, clause text split into numbered clauses |
| Amendment | Which contract it amends, effective date, changed terms |
| Invoice | Number, issuer, recipient, issue and due dates, line items, subtotal, tax, total, currency |
| Receipt / proof of payment | Payer, payee, amount, currency, date, bank reference, and the invoice numbers it mentions |

### Review and correction

Modelled on DataSnipper and on the snip model finance imports already has
(`finance_document_snips`: a field, the box it came from, its text and an `origin`).

```text
 ┌─ original ─────────────────────┐  ┌─ extracted record ─────────────────┐
 │                                │  │ Client        Yachatdac Pty Ltd ✓  │
 │  [Yachatdac Pty Ltd]◄──────────┼──┤ Rate          AUD 95 / hour     ✓  │
 │  ...                           │  │ Start date    ░░░░░░░░  needs input │
 │  Start: [ 3/?/26 ] ◄───────────┼──┤ Notice        30 days  ⚠ 62%       │
 │                                │  │                                    │
 └────────────────────────────────┘  └────────────────────────────────────┘
```

Every field is in one of four states:

| State | Shown as | Meaning |
| --- | --- | --- |
| Read | ✓ | The model read it with high confidence. Hovering highlights its box on the page |
| Unsure | ⚠ and a confidence | Read, but below the confidence threshold. Must be confirmed or corrected before Confirm is enabled |
| Needs input | Empty, highlighted | The model found the field's location but could not read it, or did not find it. The person types it |
| Corrected | ✎ | A person changed it. The model's original reading is kept alongside |

What the person can do, all in the preview:

- **Type or fix a value**, including spelling in names and clause text.
- **Assign a field by drawing a box** on the page. The text under the box is read again (a
  small, cheap call on that region only) and fills the field.
- **Reassign** a value the model put in the wrong field by dragging it to the right one.
- **Split or merge** clauses the model divided wrongly.

Each field records its `origin`: `ai`, `snip` (from a drawn box), or `typed`. Records created on
replicate carry this provenance, so anyone can later see which values a person entered.

**Confirm is disabled until no field is Unsure or Needs input.** A field the document genuinely
does not contain can be marked "Not in document".

### What "replicate" creates

| From | Creates | Status |
| --- | --- | --- |
| A relationship | A **project** in the uploader's workspace, or links to an existing one | Immediate |
| A contract | A contract with `execution_origin = 'external'`, `external_agreed_at` and the original attached, clauses transcribed into Proyekto's clause format | `sent` for attestation, per the adoption proposal. It becomes an engagement only when **both** parties attest |
| An amendment | Version 2+ in the same contract family, with the amendment document attached | Same attestation rule |
| An invoice | An imported invoice on the project, original attached | Imported, never re-issued or re-sent |
| A receipt / proof of payment | A payment on the matched invoice | Recorded |

The original document is always the legal authority. The replicated contract is labelled
**"Recorded agreement — signed outside Proyekto on *date*"** everywhere it appears, as the
adoption proposal requires.

## The acquisition loop

The counterparty named in an imported contract receives:

> *Name* has recorded your agreement of *date* in Proyekto. Check that it matches what you
> signed.

The link opens the recorded agreement next to the original, with **Confirm it matches** and
**Something is wrong**. Confirming requires only a token; creating an account is offered after
confirming, with their project, invoices and payment history already there.

Measure: imports started, relationships replicated, invites sent, attestations, and accounts
created from attestation links.

## Where the AI runs

On the agent service, like the contract change summary: new internal routes
`POST /intake/classify` and `POST /intake/extract`, authorized by NestJS and called with
`AGENT_INTERNAL_TOKEN`, following `agent/app/api/routes/briefs.py`. The agent never touches the
database; NestJS stores results.

The model is `OPENAI_MODEL_V2` (currently `gpt-5.6-luna`), the execution platform's model.
It accepts image input (OpenAI's model page, checked 2026-09-28), and the agent's API key has
access to it. **Its handwriting accuracy is untested:** run a sample of real handwritten
documents before committing to the confidence threshold. If it is not good enough, the
extraction stage alone can use a larger model set by `AGENT_VISION_MODEL` on the same key.

`backend/.../finance-imports/invoice-reader.service.ts` currently calls `gpt-4o-mini` directly
from NestJS with the backend's `OPENAI_API_KEY`, which returns 401. Intake replaces that path:
the invoice reader moves to the agent too, so all document AI runs in one place on one working
key.

## Guardrails

- **No record without a person's Confirm.** The AI output is a draft, always.
- **No engagement without both parties.** A recorded agreement stays `sent` until the
  counterparty attests. A one-sided record of a two-sided agreement is exactly what the
  adoption proposal forbids.
- **Backdating stays narrow.** Only the root contract of an external family may take effect
  in the past, and only back to `external_agreed_at`.
- **Duplicates are refused.** Same file hash, same invoice number from the same issuer, or an
  existing active engagement between the same parties is flagged with a link to the existing
  record.
- **Totals are checked, not trusted.** Line items must sum to the subtotal, and subtotal plus
  tax to the total. A mismatch is flagged in review.
- **Private by default.** Originals live in private storage, fetched through presigned URLs, as
  `finance_documents` already does.

## Schema

`finance_documents.project_id` is `NOT NULL`, but intake starts before any project exists. So
intake stages its own work and copies into `finance_documents` on replicate:

| Table | Purpose |
| --- | --- |
| `intake_batches (id, workspace_id, created_by, status, created_at)` | One upload session |
| `intake_documents (id, batch_id, file_path, file_sha256, page_range, doc_type, extraction jsonb, confidence jsonb, relationship_id, status)` | One detected document |
| `intake_relationships (id, batch_id, counterparty_name, counterparty_email, project_id, status)` | One group of documents between the same parties |

On replicate, each confirmed document becomes a `finance_documents` row on the chosen project.
The intake rows are kept as the audit trail of where each record came from.

## Plan limits

### Cost per page

`gpt-5.6-luna`: $0.20 per million input tokens, $1.20 per million output tokens. OpenAI does not
publish how many tokens a page image costs on this model, so the figures below assume about
2,500 tokens per high-detail page image. **Measure this on real scans before setting final
prices.**

| Call | Input tokens | Output tokens | Cost |
| --- | --- | --- | --- |
| Classify (low-detail page image) | 1,000 | 50 | $0.0003 |
| Extract (high-detail page image + instructions) | 4,000 | 800 | $0.0018 |
| Re-read, for about 30% of pages (handwriting, drawn boxes) | 1,500 × 0.3 | 100 × 0.3 | $0.0001 |
| **Per page** | | | **about $0.0022** |

Budget with a 2× margin for retries and longer pages: **$0.005 per page**. Storing a scanned
page (about 1 MB) is a fraction of a cent a month.

A typical migration is small: one relationship is roughly a 6-page contract, one or two
amendments, 12 invoices and 12 receipts — about 40 pages, or **$0.20** at the budgeted rate.

### Limits

| Key | Kind | Estimate (Free / Pro / Business / Enterprise) | Worst-case AI cost per workspace per month |
| --- | --- | --- | --- |
| `document_intake_pages_monthly` | quota | 30 / 500 / 3,000 / negotiated | $0.15 / $2.50 / $15 / — |
| `document_intake_onboarding_pages` | quota, once per workspace | 200 on every plan | $1.00 once |

Worst case assumes the whole quota is used. Pro is $12 per seat and Business $24 per seat
(`web/src/lib/pricing.ts` on `main`), so even a one-seat workspace using all of its quota keeps
AI cost at about 21% of Pro revenue and 63% of Business revenue. With two or more seats, which
is normal for Business, that falls under 32%.

**The onboarding allowance is the acquisition lever.** Every new workspace, Free included, gets
200 pages once, enough to bring in about five relationships. It costs at most $1 per workspace,
and each imported agreement invites a counterparty. The monthly quota is for ongoing imports
after that.

Pages, not files, because cost is per page. Replicated contracts count toward
`active_contracts` once they are sent for attestation.

## Build order

1. **Agree with David** on bringing finance imports back to `main`, and apply migration
   `20260826090000` to production.
2. Adoption proposal phases A1–A3 (external contracts and attestation).
3. Move the invoice reader onto the agent service and check the model accepts images.
4. Intake tables, upload, detect, classify and extract for contracts.
5. Review screen and replicate for contracts, then invoices and payments.
6. Grouping and matching across documents.
7. The counterparty invite and attestation page, and the acquisition metrics.

## Decisions (2026-09-28)

1. Consultants and clients may both run intake.
2. Typed and handwritten English. Unreadable or uncertain fields are typed or corrected by the
   person in the preview, DataSnipper-style.

## Open questions

1. **Plan values and costs** above are estimates for review. The per-page token count is an
   assumption until measured.
2. **Handwriting accuracy** of `gpt-5.6-luna` needs a real-document test before launch.
