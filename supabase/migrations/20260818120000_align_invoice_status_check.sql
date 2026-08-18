-- Align invoices.status with the vocabulary the application actually writes.
--
-- INCIDENT: recording a PARTIAL payment has never worked in production.
--
-- `20260805040000_invoice_receivables.sql` introduced `partially_paid` and
-- retired the legacy `sent`, but that migration was never applied to prod.
-- `20260814010000_repair_invoice_receivables.sql` then rebuilt the receivables
-- machinery — `invoice_payments`, `invoice_events` — WITHOUT carrying the status
-- CHECK across. Production was left holding the payment ledger next to a
-- constraint that forbids the status the ledger produces:
--
--   CHECK (status IN ('draft','issued','sent','paid','void'))
--
-- while InvoicesService.refreshPaymentState() writes 'partially_paid' whenever a
-- payment covers less than the balance (see backend invoices.service.ts). A full
-- payment settles to 'paid' and passes; anything short of it raises 23514.
--
-- The failure is NOT atomic. `recordPayment` inserts the ledger row first and
-- calls refreshPaymentState() after, so a rejected partial payment leaves the
-- money recorded against the invoice while the header still reads 'issued', and
-- the consultant is shown an error for a payment that actually landed.
-- Reproduced on 2026-08-18: demo invoice INV-0004 carries a 45,000 payment row
-- against a 120,000 total and a status of 'issued'.
--
-- (Portfolio and list reads derive balance from the ledger rather than from the
-- status, so they survive the split — but that is luck, not design.)
--
-- Fix-forward, matching INVOICE_STATUSES in
-- backend/src/modules/marketplace/invoices/dto/invoices.dto.ts.

-- 'sent' predates the `sent_at` timestamp and no code writes it any more. Fold
-- any survivor into 'issued' so the narrowed constraint can be trusted. (Zero
-- rows carry it in production today; this keeps the migration safe on any
-- environment that still does.)
UPDATE public.invoices SET status = 'issued' WHERE status = 'sent';

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'void'));

COMMENT ON COLUMN public.invoices.status IS
  'draft | issued | partially_paid | paid | void. Mirrors INVOICE_STATUSES in the invoices DTO; partially_paid and paid are derived from the invoice_payments ledger by refreshPaymentState().';
