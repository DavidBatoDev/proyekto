-- Trigger functions execute through their trigger and must not be exposed as RPCs.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.tg_profiles_protect_privileged_columns()
  FROM PUBLIC, anon, authenticated;

COMMIT;
