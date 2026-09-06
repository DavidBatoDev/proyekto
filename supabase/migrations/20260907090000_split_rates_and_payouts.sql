-- Split the money layer into two switches.
--
-- compensation_enabled bundled three separable things — per-member rates,
-- payout cut-offs, and payouts — behind one flag labelled "Payouts". That made
-- the narrowest feature (recording a bank transfer someone already made) the
-- gatekeeper for the broadest one (whether an hour is worth money at all).
--
--   member_rates_enabled  - do this team's hours carry an internal cost?
--   payouts_enabled       - does this team record payments in Proyekto?
--
-- payouts_enabled DEPENDS on member_rates_enabled: create_payout_and_mark_paid
-- totals a batch as sum(hours * rate_snapshot), so payouts-with-no-rates would
-- insert a zero-total payment and raise nothing. The CHECK below makes that
-- state unrepresentable rather than merely discouraged.
--
-- Renaming rather than adding-and-backfilling is safe: compensation_enabled
-- shipped one day earlier and is false on every team on both refs.
--
-- These are INTERNAL COST rates, which is why the column is member_rates_enabled
-- and not billable_time_enabled — client lines are priced off
-- contracts.client_hourly_rate, never off rate_snapshot (see
-- invoice-composition.service.ts assertNoInternalRates).

BEGIN;

ALTER TABLE public.teams
  RENAME COLUMN compensation_enabled TO member_rates_enabled;

COMMENT ON COLUMN public.teams.member_rates_enabled IS
  'Do this team''s hours carry an internal cost? Gates the per-member rate cards, the rate snapshot written onto every log, and every fee figure. False means the team tracks hours only.';

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS payouts_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.teams.payouts_enabled IS
  'Does this team record payments in Proyekto? Gates the payouts module, the paid log status, and the cut-off schedule. Requires member_rates_enabled.';

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_payouts_require_rates;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_payouts_require_rates
  CHECK (NOT payouts_enabled OR member_rates_enabled);

-- Re-declare create_payout_and_mark_paid with the guard moved onto the narrower
-- flag. Body carried forward verbatim from 20260906130000 (itself the
-- 20260701000040 body plus the guard); only the guard's column changed.

CREATE OR REPLACE FUNCTION public.create_payout_and_mark_paid(
  p_team_id uuid,
  p_member_user_id uuid,
  p_created_by uuid,
  p_currency text,
  p_log_ids uuid[],
  p_payout_method_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_proof_path text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT now(),
  p_source text DEFAULT 'batch'
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected int := array_length(p_log_ids, 1);
  v_matched int;
  v_total numeric(14,2);
  v_method public.payout_methods%ROWTYPE;
  v_payout public.payouts;
BEGIN
  IF v_expected IS NULL OR v_expected = 0 THEN
    RAISE EXCEPTION 'No time logs supplied for payout';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.teams
     WHERE id = p_team_id
       AND payouts_enabled
  ) THEN
    RAISE EXCEPTION 'Payouts are disabled for this team';
  END IF;

  -- Lock the target logs (FOR UPDATE cannot be combined with aggregates, so
  -- this is a separate row-locking pass before the count/sum below).
  PERFORM 1
    FROM public.task_time_logs
   WHERE id = ANY (p_log_ids)
     AND team_id = p_team_id
     AND member_user_id = p_member_user_id
     AND status = 'approved'
     AND payout_id IS NULL
     AND currency_snapshot = p_currency
   FOR UPDATE;

  -- Validate + compute the authoritative total over the now-locked rows.
  SELECT count(*),
         COALESCE(round(sum(COALESCE(duration_seconds, 0) / 3600.0 * rate_snapshot), 2), 0)
    INTO v_matched, v_total
    FROM public.task_time_logs
   WHERE id = ANY (p_log_ids)
     AND team_id = p_team_id
     AND member_user_id = p_member_user_id
     AND status = 'approved'
     AND payout_id IS NULL
     AND currency_snapshot = p_currency;

  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'One or more logs are not payable (must be approved, unpaid, same member/team, and % currency)', p_currency;
  END IF;

  -- Snapshot the chosen method (verifying it belongs to the member being paid).
  IF p_payout_method_id IS NOT NULL THEN
    SELECT * INTO v_method
      FROM public.payout_methods
     WHERE id = p_payout_method_id
       AND user_id = p_member_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payout method does not belong to the member being paid';
    END IF;
  END IF;

  INSERT INTO public.payouts (
    team_id, member_user_id, created_by,
    payout_method_id, method_type, method_label,
    method_account_name, method_account_identifier, method_bank_name,
    currency, total_amount, reference_number, proof_path, note, paid_at, source
  ) VALUES (
    p_team_id, p_member_user_id, p_created_by,
    p_payout_method_id, v_method.method_type, v_method.label,
    v_method.account_name, v_method.account_identifier, v_method.bank_name,
    p_currency, v_total, p_reference_number, p_proof_path, p_note,
    COALESCE(p_paid_at, now()), p_source
  )
  RETURNING * INTO v_payout;

  UPDATE public.task_time_logs
     SET status = 'paid',
         payout_id = v_payout.id,
         reviewed_by = p_created_by,
         reviewed_at = now(),
         updated_at = now()
   WHERE id = ANY (p_log_ids);

  RETURN v_payout;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_payout_and_mark_paid(
  uuid, uuid, uuid, text, uuid[], uuid, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual)
-- BEGIN;
-- ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_payouts_require_rates;
-- ALTER TABLE public.teams DROP COLUMN IF EXISTS payouts_enabled;
-- ALTER TABLE public.teams RENAME COLUMN member_rates_enabled TO compensation_enabled;
-- -- then re-apply 20260906130000_team_compensation_enabled.sql to restore its guard.
-- COMMIT;
-- ---------------------------------------------------------------------------
