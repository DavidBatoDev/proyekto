-- Migration: 20260730094000_contract_amendments.sql
-- Date: July 30, 2026
-- Description:
--   Records the lineage of a contract amendment, so "change this and every
--   future invoice" has somewhere to land.
--
--   Future invoices are NOT materialized — recurrence is re-derived from the
--   contract on every scheduler run. So there is no row to edit for "this and
--   following": the change IS an amendment to the contract, creating
--   version + 1 with a later effective date while the current version keeps
--   governing until both parties re-sign.
--
--   A `contract_period_overrides` table was considered and rejected: it would
--   fork pricing away from the contract, so InvoiceCompositionService would
--   need a second source of truth for recurring_fee / client_hourly_rate; and
--   the client never signs an override, so the signed agreement and the
--   invoice would legally disagree. The versioning path already exists —
--   `nextVersion` and the supersede-on-sign block were built for exactly this.
--
--   Both columns are nullable with no default. No backfill, RLS unchanged
--   (the contracts policies are column-agnostic).

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS supersedes_contract_id uuid
    REFERENCES public.contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amendment_effective_date date;

CREATE INDEX IF NOT EXISTS idx_contracts_supersedes
  ON public.contracts(supersedes_contract_id)
  WHERE supersedes_contract_id IS NOT NULL;

COMMENT ON COLUMN public.contracts.supersedes_contract_id IS
  'The contract version this one amends. Null on an original.';
COMMENT ON COLUMN public.contracts.amendment_effective_date IS
  'First day the amended terms apply. Equals the predecessor''s service_start_date for a whole-engagement change, or the start of the chosen period for a "this and following" change.';
