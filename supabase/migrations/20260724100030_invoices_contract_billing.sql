-- Migration: 20260724100030_invoices_contract_billing.sql
-- Date: July 24, 2026
-- Description:
--   Wires `invoices` to `contracts` so an invoice knows which billing period it
--   covers, whether a human or the scheduler created it, and how much time
--   detail the client is allowed to see.
--
--   The partial unique index on (contract_id, period_start, period_end) for
--   scheduled invoices IS the automation's idempotency guarantee: a cron retry
--   after a partial failure cannot double-bill a client. This is stronger than
--   the `reminder_sent_at` claim stamp used by the meetings cron, because the
--   constraint lives in the database rather than in a read-then-write window.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS hours_detail_level text NOT NULL DEFAULT 'summary',
  -- Party snapshots for the rendered PDF. Snapshotted at create/issue so a
  -- later profile or contract edit cannot rewrite a document already sent.
  ADD COLUMN IF NOT EXISTS bill_to jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS issued_by jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_method text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_origin_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_origin_check
      CHECK (origin IN ('manual', 'scheduled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_hours_detail_level_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_hours_detail_level_check
      CHECK (hours_detail_level IN ('none', 'summary', 'detailed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_period_order_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_period_order_check
      CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end);
  END IF;
END
$$;

-- Idempotency for the scheduler. Manual invoices are intentionally exempt: a
-- consultant may legitimately issue two ad-hoc invoices for the same window.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_scheduled_period
  ON public.invoices(contract_id, period_start, period_end)
  WHERE origin = 'scheduled' AND contract_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_contract_id
  ON public.invoices(contract_id, period_start DESC)
  WHERE contract_id IS NOT NULL;

-- Retainer and overage lines are computed from the contract, not from a manual
-- entry or a time log, so the source_type domain has to grow with them.
ALTER TABLE public.invoice_line_items
  DROP CONSTRAINT IF EXISTS invoice_line_items_source_type_check;

ALTER TABLE public.invoice_line_items
  ADD CONSTRAINT invoice_line_items_source_type_check
  CHECK (source_type IN ('manual', 'time_log', 'retainer', 'overage'));
