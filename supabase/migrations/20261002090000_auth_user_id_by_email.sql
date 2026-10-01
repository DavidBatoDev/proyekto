-- Exact, case-insensitive email → auth user id lookup, for the backend only.
--
-- SECURITY FIX. EmailOtpService.resolveUserIdByEmail fell back to
-- GET /auth/v1/admin/users?email=<x>, but GoTrue ignores that parameter and
-- returns the first page of ALL users; the code took users[0]. A password reset
-- requested for any address without a profile row was therefore bound to some
-- other user's id, and confirming the emailed code reset THAT user's password.
-- (Verified 2026-10-02: 36 users came back for a nonexistent address. One such
-- mis-linked reset row existed in prod; it expired unused.)
--
-- Profiles cannot replace the lookup: 46 of 89 auth users had no profile row.
-- This function reads auth.users directly, matches the whole address, and is
-- callable by the service role only.

CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
    FROM auth.users u
   WHERE lower(u.email) = lower(btrim(p_email))
     AND u.deleted_at IS NULL
   ORDER BY u.created_at
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.auth_user_id_by_email(text) IS
  'Exact case-insensitive email lookup on auth.users. Service role only: used by password reset and the sign-up email availability check.';

REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;
