-- Defence in depth for the password-reset takeover fixed in
-- 20261002090000_auth_user_id_by_email.sql: a reset row may only ever point at
-- the account that owns its email address.
--
-- The backend fix makes the lookup exact; this guard holds even against an old
-- backend still running (it closed the hole in production before the deploy),
-- and against any future caller that resolves the wrong id. Legitimate resets
-- are untouched: their user_id always owns the address.

CREATE OR REPLACE FUNCTION public.password_resets_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM auth.users u
     WHERE u.id = NEW.user_id
       AND lower(u.email) = lower(btrim(NEW.email))
  ) THEN
    RAISE EXCEPTION 'password reset user_id does not own this email'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.password_resets_owner_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS password_resets_owner_guard ON public.password_resets;
CREATE TRIGGER password_resets_owner_guard
  BEFORE INSERT OR UPDATE OF user_id, email ON public.password_resets
  FOR EACH ROW
  EXECUTE FUNCTION public.password_resets_owner_guard();

-- Void any unconsumed row that is already mis-linked, so it can never be used.
UPDATE public.password_resets r
   SET consumed_at = now()
 WHERE r.consumed_at IS NULL
   AND r.user_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM auth.users u
      WHERE u.id = r.user_id AND lower(u.email) = lower(btrim(r.email))
   );
