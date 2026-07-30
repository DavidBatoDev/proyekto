-- Migration: 20260730091000_contract_billing_timing.sql
-- Date: July 30, 2026
-- Description:
--   Lets a retainer be invoiced BEFORE the period it covers (a prepaid
--   retainer), not only after it closes.
--
--   Until now the system was structurally postpaid: every code path bills a
--   period that has already ended (`lastBillablePeriod` requires
--   `periodEnd < today`, and `invoiceDate` is anchored to the period end). An
--   agency that invoices on November 30 for December had no way to express
--   that.
--
--   `invoice_offset_days` is deliberately NOT renamed. Under 'arrears' it is
--   lag after the period closes; under 'advance' it is lead before the period
--   opens. Renaming a shipped column to say so would churn the DTO, the
--   service, the web mirror and the schedule preview for a label — the column
--   comment carries the widened meaning instead.
--
--   Advance is retainer-only in v1: an hourly contract cannot be billed before
--   the hours are logged and approved, so `contracts_advance_retainer_only_check`
--   forbids it. The hybrid rule, once implemented, is one invoice per period
--   carrying the retainer line for period P plus the overage line for period
--   P-1 (the last closed one) — so the client is still never billed for
--   unapproved hours.
--
--   DEFAULT 'arrears' is exactly today's behaviour, so no existing contract
--   changes and no already-issued invoice is recomputed. No backfill.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS billing_timing text NOT NULL DEFAULT 'arrears';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_billing_timing_check'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_billing_timing_check
      CHECK (billing_timing IN ('arrears', 'advance'));
  END IF;

  -- Backstop only. The service pre-validates and raises a readable message so
  -- nobody is shown a raw constraint name.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contracts_advance_retainer_only_check'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_advance_retainer_only_check
      CHECK (billing_timing = 'arrears' OR billing_mode = 'retainer');
  END IF;
END
$$;

COMMENT ON COLUMN public.contracts.billing_timing IS
  'arrears = invoice raised after the period closes (periodEnd + invoice_offset_days). advance = invoice raised before the period starts (periodStart - invoice_offset_days). Advance is retainer-only in v1; see contracts_advance_retainer_only_check.';
COMMENT ON COLUMN public.contracts.invoice_offset_days IS
  'Lag days in arrears, LEAD days in advance. The name predates billing_timing and is kept to avoid renaming a shipped column.';
COMMENT ON COLUMN public.contracts.due_days IS
  'Payment window in days from the invoice date (net terms). NOT a late-payment grace period.';

-- RLS: unaffected. The contracts policies (20260724100000) are column-agnostic.
