-- Invoice receivables: immutable payment ledger, corrections, and commercial states.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaces_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_by_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

-- `sent_at` remains the delivery record. Status represents the commercial state.
UPDATE public.invoices SET status = 'issued' WHERE status = 'sent';

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'void'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_replacement_source
  ON public.invoices(replaces_invoice_id)
  WHERE replaces_invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  payment_method text,
  reference text,
  note text,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reverses_payment_id uuid REFERENCES public.invoice_payments(id) ON DELETE RESTRICT,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_payment_reversal_reason_check
    CHECK ((reverses_payment_id IS NULL AND reversal_reason IS NULL)
      OR (reverses_payment_id IS NOT NULL AND length(trim(coalesce(reversal_reason, ''))) > 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payments_one_reversal
  ON public.invoice_payments(reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_created
  ON public.invoice_payments(invoice_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'created', 'issued', 'pdf_finalized', 'email_sent', 'email_failed',
    'payment_recorded', 'payment_reversed', 'voided', 'replacement_created'
  )),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice_created
  ON public.invoice_events(invoice_id, created_at ASC);

-- These records are accessed exclusively through the API's service-role client.
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_events ENABLE ROW LEVEL SECURITY;

-- The API is the sole access path; service_role bypasses RLS while browser
-- clients cannot query or mutate accounting records directly.
CREATE POLICY invoice_payments_api_only ON public.invoice_payments
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY invoice_events_api_only ON public.invoice_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
