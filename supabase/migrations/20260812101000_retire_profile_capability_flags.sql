-- Marketplace enrollment tables (contract phase).
--
-- DEPLOY ORDERING: apply ONLY AFTER the enrollment-aware backend and web are
-- deployed. The pre-contract backend selects profiles.is_consultant_verified and
-- profiles.is_public directly and will fail after these columns are removed.
-- Before applying, run the consultant/freelancer reconciliation queries from the
-- rollout plan and heal any drift created during the expand/deploy window.

BEGIN;

-- Latest body source: 20260810160000_drop_profiles_role.sql. Keep the exact
-- name/signature because profiles RLS and tg_team_member_rates_check_consultant()
-- call this predicate.
CREATE OR REPLACE FUNCTION public.is_active_consultant(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.consultant_profiles AS cp
    WHERE cp.user_id = target_user_id
      AND cp.status = 'verified'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_freelancer(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.freelancer_profiles AS fp
    WHERE fp.user_id = target_user_id
      AND fp.status = 'active'
  );
$$;

-- Latest policy source: 20260809131000_consultant_capability_predicate.sql.
DROP POLICY IF EXISTS "Active consultants can view public profiles"
  ON public.profiles;

CREATE POLICY "Active consultants can view public profiles"
ON public.profiles
FOR SELECT
USING (
  public.is_active_freelancer(profiles.id)
  AND public.is_active_consultant(auth.uid())
);

DROP TRIGGER IF EXISTS sync_consultant_enrollment_legacy_flag
  ON public.consultant_profiles;
DROP TRIGGER IF EXISTS sync_freelancer_enrollment_legacy_flag
  ON public.freelancer_profiles;

DROP FUNCTION IF EXISTS public.tg_sync_consultant_enrollment_legacy_flag();
DROP FUNCTION IF EXISTS public.tg_sync_freelancer_enrollment_legacy_flag();

DROP TRIGGER IF EXISTS profiles_protect_privileged_columns
  ON public.profiles;
DROP FUNCTION IF EXISTS public.tg_profiles_protect_privileged_columns();

DROP FUNCTION IF EXISTS public.is_verified_consultant(uuid);

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS is_consultant_verified,
  DROP COLUMN IF EXISTS is_public;

COMMIT;
