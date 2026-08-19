-- Migration: 20260819160000_pin_roadmap_notes_trigger_search_path.sql
--
-- Purpose:
--   Pin search_path on the roadmap_notes touch-updated_at trigger function
--   (advisor: function_search_path_mutable).
--
--   20260819150000 created handle_roadmap_notes_updated_at() without a
--   search_path, so it inherits the caller's. The body only assigns NEW.updated_at
--   from now(), so the exposure is small -- but now() is resolvable through the
--   search_path, and a trigger function is exactly the place where the caller
--   controls that path. The function also pre-dates no other definition, so
--   ALTER FUNCTION is enough: rebuilding the body here would fork it from the
--   migration that owns it for no gain.
--
--   Follows the precedent set for the payout trigger functions in
--   20260701000030_harden_payout_functions.sql.

ALTER FUNCTION public.handle_roadmap_notes_updated_at() SET search_path = public;
