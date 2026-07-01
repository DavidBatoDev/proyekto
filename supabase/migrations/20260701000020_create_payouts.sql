-- Migration: 20260701000020_create_payouts.sql
--
-- Purpose:
--   Record manual payouts. A consultant/team owner pays a member OUTSIDE the
--   app (bank transfer, GCash, etc.) and records the payout here: the method
--   used (snapshotted), a reference number, an optional proof file, and the
--   date paid. Recording a payout flips its time logs to status='paid'.
--
--   A payout groups one member's APPROVED, single-currency time logs into one
--   total. The link is a payout_id FK column on task_time_logs (a log is paid
--   at most once). Voiding a payout detaches its logs (payout_id -> NULL) and
--   reverts them to 'approved'.
--
--   Atomicity: supabase-js has no client-side multi-statement transaction, so
--   the insert-payout + flip-logs happens inside the SECURITY DEFINER RPC
--   create_payout_and_mark_paid(), which re-enforces every guard in SQL.

-- ─── payouts table ───────────────────────────────────────────────────────
CREATE TABLE public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Payout method SNAPSHOT (the source method row may be edited/deleted later).
  payout_method_id uuid REFERENCES public.payout_methods(id) ON DELETE SET NULL,
  method_type text,
  method_label text,
  method_account_name text,
  method_account_identifier text,
  method_bank_name text,

  currency text NOT NULL,                          -- single currency per payout
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  reference_number text,
  proof_path text,                                 -- private R2 object key (nullable)
  note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'void')),
  source text NOT NULL DEFAULT 'batch'
    CHECK (source IN ('batch', 'quick')),          -- 'quick' = per-row/bulk mark-paid
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payouts IS
  'Manual payout records grouping a member''s approved single-currency logs. Reads/writes go through the backend service-role client.';

CREATE INDEX payouts_team_member_idx
  ON public.payouts (team_id, member_user_id, paid_at DESC);

CREATE OR REPLACE FUNCTION public.tg_payouts_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER payouts_touch_updated_at
  BEFORE UPDATE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.tg_payouts_touch_updated_at();

-- No permissive policy: all access is via the backend service-role client.
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

-- ─── link logs to payouts ────────────────────────────────────────────────
ALTER TABLE public.task_time_logs
  ADD COLUMN payout_id uuid REFERENCES public.payouts(id) ON DELETE SET NULL;

CREATE INDEX task_time_logs_payout_idx
  ON public.task_time_logs (payout_id)
  WHERE payout_id IS NOT NULL;

-- ─── atomic create ───────────────────────────────────────────────────────
-- Inserts the payout and flips the selected logs to 'paid' in one transaction.
-- Re-enforces (belt-and-suspenders vs. the backend checks): every log belongs
-- to the team+member, is currently 'approved', is unpaid (payout_id IS NULL),
-- and shares p_currency. Computes total_amount authoritatively from the logs'
-- own rate/duration snapshots. Locks the logs FOR UPDATE to prevent a
-- concurrent double-pay. Returns the new payout row.
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

-- ─── atomic void ─────────────────────────────────────────────────────────
-- Marks a recorded payout 'void' and reverts its logs from 'paid' back to
-- 'approved', detaching them (payout_id -> NULL). Idempotent-safe: raises if
-- the payout is already void.
CREATE OR REPLACE FUNCTION public.void_payout_and_revert(
  p_payout_id uuid,
  p_actor uuid
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.payouts;
BEGIN
  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;
  IF v_payout.status = 'void' THEN
    RAISE EXCEPTION 'Payout is already void';
  END IF;

  UPDATE public.task_time_logs
     SET status = 'approved',
         payout_id = NULL,
         reviewed_by = p_actor,
         reviewed_at = now(),
         updated_at = now()
   WHERE payout_id = p_payout_id
     AND status = 'paid';

  UPDATE public.payouts
     SET status = 'void', updated_at = now()
   WHERE id = p_payout_id
  RETURNING * INTO v_payout;

  RETURN v_payout;
END $$;
