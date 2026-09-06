-- Make a team's money layer opt-in.
--
-- compensation_enabled gates the WHOLE money layer for a team: per-member
-- rates, payout cut-off periods, and payouts. False means the team tracks and
-- approves hours and nothing more.
--
-- It deliberately defaults to false for every existing team. This is an opt-in
-- feature; teams that were using rates or payouts are switched back on by hand
-- after deploy rather than backfilled here.
--
-- Named compensation_enabled rather than payouts_enabled because it also hides
-- the rates surface and zeroes new rate snapshots — a column called
-- "payouts_enabled" doing those things would mislead the next reader.

BEGIN;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS compensation_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.teams.compensation_enabled IS
  'Gates the whole money layer for a team: per-member rates, payout cut-off periods, and payouts. False means the team tracks hours only.';

-- Re-declare create_payout_and_mark_paid with a compensation guard.
--
-- Rebuilt from the LATEST body (20260701000040_fix_payout_total_lock.sql), not
-- the original in 20260701000020 — that one combined FOR UPDATE with aggregates
-- and was invalid SQL. The only change below is the new guard after the
-- empty-log check; everything else is carried over verbatim.
--
-- EXECUTE is already service-role-only (20260701000030_harden_payout_functions),
-- so this is defence in depth: it keeps "no payouts when disabled" true at rest
-- even if a future caller reaches the RPC without going through the service.

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
       AND compensation_enabled
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
-- Re-apply 20260701000040_fix_payout_total_lock.sql to drop the guard, then:
-- ALTER TABLE public.teams DROP COLUMN IF EXISTS compensation_enabled;
-- ---------------------------------------------------------------------------
