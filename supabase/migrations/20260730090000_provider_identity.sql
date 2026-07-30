-- Migration: 20260730090000_provider_identity.sql
-- Date: July 30, 2026
-- Description:
--   Gives the service-provider block on a contract a real source of truth,
--   instead of retyping a name, address and TIN into every new contract.
--
--   The four business-identity fields go on `teams` rather than into a new
--   table because `teams` already carries this entity's billing-adjacent
--   config (`default_currency` from 20260702000010, `pay_period_config` from
--   20260723000010), the resolution path already exists
--   (ContractsService.getTeamPayPeriodConfig walks projects.primary_team_id ->
--   teams), and `is_personal` (20260507000040) means a solo contractor already
--   HAS a team row — so there is no agency-vs-no-agency cardinality problem to
--   model around.
--
--   Which identity signs a PARTICULAR deal is a per-contract choice, not a
--   per-team one: a consultant may run most work through the agency but take
--   one engagement personally for tax reasons. So `provider_kind` goes on
--   `contracts`, alongside the other snapshotted party fields.
--
--   Both defaults are backward-safe. Existing contracts become 'agency', and
--   because every new `teams` column is NULL, seedParties keeps falling back
--   to today's profile-derived behaviour until a team fills them in. No
--   backfill, and no already-signed contract changes.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS legal_name      text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS tax_id          text,
  ADD COLUMN IF NOT EXISTS billing_email   text;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS provider_kind text NOT NULL DEFAULT 'agency';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_provider_kind_check'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_provider_kind_check
      CHECK (provider_kind IN ('individual', 'agency'));
  END IF;
END
$$;

COMMENT ON COLUMN public.teams.legal_name IS
  'Registered business name used on contracts and invoices. Falls back to teams.name when null.';
COMMENT ON COLUMN public.teams.billing_address IS
  'Business address printed in the service-provider block of contracts and invoices.';
COMMENT ON COLUMN public.teams.tax_id IS
  'Tax identification number (TIN/VAT/EIN) printed on contracts and invoices.';
COMMENT ON COLUMN public.teams.billing_email IS
  'Address invoices are issued from. Falls back to the contract creator''s profile email.';
COMMENT ON COLUMN public.contracts.provider_kind IS
  'Which identity signs this contract: "individual" = the consultant''s personal profile, "agency" = the project''s primary team record.';

-- RLS: nothing new. `teams` policies (20260507000010) and `contracts` policies
-- (20260724100000) are column-agnostic, so the new columns inherit them.
