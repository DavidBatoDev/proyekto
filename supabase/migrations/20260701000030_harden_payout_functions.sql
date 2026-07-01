-- Migration: 20260701000030_harden_payout_functions.sql
--
-- Purpose:
--   Lock down the payout SECURITY DEFINER RPCs and trigger functions.
--
--   create_payout_and_mark_paid() and void_payout_and_revert() run as the
--   definer (bypassing RLS) and deliberately hold NO caller-authorization of
--   their own — the "must be a team approver / cannot pay your own logs"
--   checks live in the backend PayoutsService, which invokes them with the
--   service-role client. By default Postgres grants EXECUTE on new functions
--   to PUBLIC (anon + authenticated), which would let any signed-in user call
--   them directly and skip those checks. Revoke that and grant to service_role
--   only, so the backend remains the single entry point.
--
--   Also pin search_path on the touch-updated_at trigger functions
--   (advisor: function_search_path_mutable).

-- RPCs: service-role only.
REVOKE EXECUTE ON FUNCTION public.create_payout_and_mark_paid(
  uuid, uuid, uuid, text, uuid[], uuid, text, text, text, timestamptz, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payout_and_mark_paid(
  uuid, uuid, uuid, text, uuid[], uuid, text, text, text, timestamptz, text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.void_payout_and_revert(uuid, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_payout_and_revert(uuid, uuid)
  TO service_role;

-- Trigger functions: pin search_path.
ALTER FUNCTION public.tg_payout_methods_touch_updated_at() SET search_path = public;
ALTER FUNCTION public.tg_payouts_touch_updated_at() SET search_path = public;
