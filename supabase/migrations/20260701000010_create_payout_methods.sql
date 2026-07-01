-- Migration: 20260701000010_create_payout_methods.sql
--
-- Purpose:
--   Store a user's payout destinations (bank accounts / e-wallets like
--   GCash, Maya, PayPal). These are entered once on the user's own profile
--   and are reusable across every team they work under.
--
--   Privacy: a payout method holds sensitive account numbers. RLS grants the
--   OWNER full access only. There is deliberately NO cross-user SELECT policy
--   for team owners/consultants — a paying owner reads a member's method
--   through the backend service-role client after an explicit authorization
--   check (see the payouts module). Service-role bypasses RLS, so no broad
--   policy is needed and numbers never leak to owners at rest.

CREATE TABLE public.payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  method_type text NOT NULL
    CHECK (method_type IN ('bank', 'gcash', 'maya', 'paypal', 'other')),
  label text,                        -- user-facing nickname e.g. "BPI Payroll"
  account_name text NOT NULL,        -- name on the account
  account_identifier text NOT NULL,  -- account number / mobile / paypal email
  bank_name text,                    -- required for method_type='bank' (app-enforced)
  currency text,                     -- optional preferred currency
  is_default boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payout_methods IS
  'User-owned payout destinations (bank / e-wallet). At most one active default per user. Read cross-user only via backend service-role after an authorization check.';

-- At most one active default per user.
CREATE UNIQUE INDEX payout_methods_one_default_per_user
  ON public.payout_methods (user_id)
  WHERE is_default AND NOT is_archived;

CREATE INDEX payout_methods_user_idx
  ON public.payout_methods (user_id)
  WHERE NOT is_archived;

-- updated_at touch trigger (mirrors team_member_rates).
CREATE OR REPLACE FUNCTION public.tg_payout_methods_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER payout_methods_touch_updated_at
  BEFORE UPDATE ON public.payout_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_payout_methods_touch_updated_at();

-- Owner-only RLS. Backend service-role handles authorized cross-user reads.
ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_methods_owner_all ON public.payout_methods
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
