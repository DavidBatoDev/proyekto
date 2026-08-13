-- Repair environments where the invoice receivables migration was recorded
-- but its two ledger tables are physically absent.

BEGIN;

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
    CHECK (
      (reverses_payment_id IS NULL AND reversal_reason IS NULL)
      OR (
        reverses_payment_id IS NOT NULL
        AND length(trim(coalesce(reversal_reason, ''))) > 0
      )
    )
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
    'created',
    'issued',
    'pdf_finalized',
    'email_sent',
    'email_failed',
    'payment_recorded',
    'payment_reversed',
    'voided',
    'replacement_created'
  )),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice_created
  ON public.invoice_events(invoice_id, created_at ASC);

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_payments_api_only ON public.invoice_payments;
CREATE POLICY invoice_payments_api_only ON public.invoice_payments
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS invoice_events_api_only ON public.invoice_events;
CREATE POLICY invoice_events_api_only ON public.invoice_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.invoice_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.invoice_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.invoice_payments TO service_role;
GRANT ALL ON TABLE public.invoice_events TO service_role;

COMMENT ON TABLE public.invoice_payments IS
  'API-only immutable invoice payment and reversal ledger.';
COMMENT ON TABLE public.invoice_events IS
  'API-only audit trail of invoice commercial state transitions.';

COMMIT;
