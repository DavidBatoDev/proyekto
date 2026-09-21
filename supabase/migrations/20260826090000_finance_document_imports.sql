-- Historical finance imports.
--
-- Money that was billed and settled before (or outside) Proyekto still has to
-- appear in the finance overview, and the only record of it is the documents
-- themselves: the PDF that was sent to the client and the bank screenshot that
-- proves it was paid. This migration adds the three pieces that lets those be
-- recorded without inventing anything:
--
--   1. `finance_documents` — the uploaded file, its extracted text, and what an
--      automated first pass thinks the fields are (a suggestion, never a fact).
--   2. `invoices.origin = 'imported'` — an invoice that was READ from a
--      document rather than issued by this system. It joins the existing
--      manual/scheduled domain (20260724100030) rather than taking a column of
--      its own, because those three ARE the ways an invoice comes to exist. It
--      lands in the same table on purpose: backfill exists to make the
--      overview, ageing, and project totals true, and a parallel ledger would
--      have to be unioned into every one of them.
--   3. `finance_document_snips` — which region of which page each recorded
--      figure came from, so every number stays traceable to the ink it was read
--      off. This is the part that makes the import auditable rather than typed.
--
-- Settlement in another currency is recorded on the PAYMENT, not the invoice:
-- an AUD 10,000 invoice settled by PESONet arrives as PHP 421,650.00 at that
-- transfer's own rate, and the next transfer uses a different one. The invoice
-- keeps its true face value; the payment keeps what actually landed.

CREATE TABLE IF NOT EXISTS public.finance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  -- Private R2 object key. These are commercial documents and bank records;
  -- they are never public-bucket material and are read through presigned URLs.
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  page_count integer,
  -- Text layer, kept so a re-run of the reader costs no second download.
  extracted_text text,
  -- { fields: { number: {value, confidence}, ... }, model, read_at }
  extraction jsonb NOT NULL DEFAULT '{}'::jsonb,
  extraction_status text NOT NULL DEFAULT 'pending',
  extraction_error text,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_documents_kind_check
    CHECK (kind IN ('invoice', 'payment_proof', 'other')),
  CONSTRAINT finance_documents_extraction_status_check
    CHECK (extraction_status IN ('pending', 'ready', 'failed', 'skipped')),
  CONSTRAINT finance_documents_size_check CHECK (size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS idx_finance_documents_project_created
  ON public.finance_documents(project_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_finance_documents_updated_at ON public.finance_documents;
CREATE TRIGGER trg_finance_documents_updated_at
BEFORE UPDATE ON public.finance_documents
FOR EACH ROW
EXECUTE FUNCTION public.handle_notifications_updated_at();

-- An imported invoice is not a draft this system can issue, render, or email:
-- the document of record already exists and was already sent. The service layer
-- refuses those transitions; `origin` is what it reads.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source_document_id uuid
    REFERENCES public.finance_documents(id) ON DELETE SET NULL;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_origin_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_origin_check
  CHECK (origin IN ('manual', 'scheduled', 'imported'));

-- An imported invoice without its document would be a figure with nothing
-- behind it, which is the one thing this feature exists to prevent.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_imported_needs_document_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_imported_needs_document_check
  CHECK (origin <> 'imported' OR source_document_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_invoices_source_document
  ON public.invoices(source_document_id)
  WHERE source_document_id IS NOT NULL;

-- What actually landed in the bank, when the invoice is billed in another
-- currency. `fx_rate` is stored rather than derived on read: it is a property
-- of that transfer, and recomputing it later from rounded figures would drift.
ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS settled_currency text,
  ADD COLUMN IF NOT EXISTS settled_amount numeric,
  ADD COLUMN IF NOT EXISTS fx_rate numeric,
  ADD COLUMN IF NOT EXISTS proof_document_id uuid
    REFERENCES public.finance_documents(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_payments
  DROP CONSTRAINT IF EXISTS invoice_payments_settlement_check;
ALTER TABLE public.invoice_payments
  ADD CONSTRAINT invoice_payments_settlement_check CHECK (
    (settled_currency IS NULL AND settled_amount IS NULL AND fx_rate IS NULL)
    OR (
      settled_currency IS NOT NULL
      AND settled_amount IS NOT NULL AND settled_amount > 0
      AND fx_rate IS NOT NULL AND fx_rate > 0
    )
  );

-- The evidence layer: one region of one page, tied to the field it filled.
CREATE TABLE IF NOT EXISTS public.finance_document_snips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL
    REFERENCES public.finance_documents(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.invoice_payments(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  page integer NOT NULL DEFAULT 1,
  -- { x, y, w, h } as fractions of the rendered page, so a snip survives any
  -- zoom level or device pixel ratio the viewer happens to render at.
  rect jsonb NOT NULL,
  value_text text,
  origin text NOT NULL DEFAULT 'snip',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_document_snips_page_check CHECK (page >= 1),
  CONSTRAINT finance_document_snips_origin_check
    CHECK (origin IN ('snip', 'extraction', 'manual')),
  -- A snip with no field to evidence is a stray rectangle.
  CONSTRAINT finance_document_snips_target_check
    CHECK (invoice_id IS NOT NULL OR payment_id IS NOT NULL)
);

-- One piece of evidence per field: re-snipping a field replaces its region
-- rather than accumulating rectangles nobody can tell apart.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_document_snips_invoice_field
  ON public.finance_document_snips(invoice_id, field_key)
  WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_document_snips_payment_field
  ON public.finance_document_snips(payment_id, field_key)
  WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_document_snips_document
  ON public.finance_document_snips(document_id, page);

-- Reached exclusively through the API's service-role client, like
-- `invoice_payments` and `invoice_events` (20260805040000): the browser must
-- not read commercial documents or accounting evidence directly.
ALTER TABLE public.finance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_document_snips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_documents_api_only ON public.finance_documents;
CREATE POLICY finance_documents_api_only ON public.finance_documents
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS finance_document_snips_api_only ON public.finance_document_snips;
CREATE POLICY finance_document_snips_api_only ON public.finance_document_snips
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
