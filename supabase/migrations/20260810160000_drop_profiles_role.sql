-- Drop profiles.role and the account_role enum (identity-and-enrollment, phase 1).
-- Account-level roles are removed for good: execution authz uses share_role, marketplace
-- capability uses is_consultant_verified (later consultant_profiles), and client/consultant
-- are contract positions. See docs/13-proposals/identity-and-enrollment.md.
--
-- DEPLOY ORDERING: apply to prod ONLY AFTER the role-free backend/web code is deployed.
-- Old code selects and filters on profiles.role and breaks once the column is gone; the
-- new code never references it, so it runs correctly with or without the column.

-- 1) Capability predicate: verification alone. (Latest body: 20260809131000.)
--    The RLS policy "Active consultants can view public profiles" and
--    tg_team_member_rates_check_consultant() both call this and are untouched.
CREATE OR REPLACE FUNCTION public.is_active_consultant(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = target_user_id
      AND p.is_consultant_verified IS TRUE
  );
$$;

-- 2) Privileged-columns trigger: guard only is_consultant_verified.
--    (Latest body: 20260809162000_account_role_foundation_retry.)
CREATE OR REPLACE FUNCTION public.tg_profiles_protect_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.is_consultant_verified := false;
    ELSIF NEW.is_consultant_verified IS DISTINCT FROM OLD.is_consultant_verified THEN
      RAISE EXCEPTION 'profiles.is_consultant_verified is server-managed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) Onboarding settings: signup no longer records a lane, so lane becomes optional
--    legacy data on historical rows. (Latest body: 20260809164000.) New rows carry
--    only completed_at.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS settings_onboarding_structure_check;
ALTER TABLE public.profiles ADD CONSTRAINT settings_onboarding_structure_check CHECK (
  settings IS NULL
  OR NOT (settings ? 'onboarding')
  OR (
    (settings->'onboarding'->>'completed_at') IS NOT NULL
    AND (
      NOT (settings->'onboarding' ? 'lane')
      OR (settings->'onboarding'->>'lane') IN ('client_freelancer', 'client', 'talent', 'consultant')
    )
  )
);

-- 4) Drop the column and the orphaned enum.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;
DROP TYPE IF EXISTS public.account_role;
