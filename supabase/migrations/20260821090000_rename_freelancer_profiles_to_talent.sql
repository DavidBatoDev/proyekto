-- freelancer_profiles -> talent_profiles
--
-- The product calls this role Talent everywhere a person can see it -- the
-- footer, the survey, and CLAUDE.md's own definition ("Clients fund the work,
-- vetted Consultants lead delivery, Talent executes"). Only the schema still
-- said freelancer, which is also Upwork and Fiverr's word for a different
-- model: individuals selling themselves directly. Here the pool is visible
-- only to verified consultants, and work arrives through a consultant who
-- leads delivery.
--
-- A table rename does NOT rename the objects hanging off it, so all eight are
-- renamed explicitly. The one that matters most is the function.
ALTER TABLE public.freelancer_profiles RENAME TO talent_profiles;

ALTER TABLE public.talent_profiles
  RENAME CONSTRAINT freelancer_profiles_status_check TO talent_profiles_status_check;
ALTER TABLE public.talent_profiles
  RENAME CONSTRAINT freelancer_profiles_user_id_fkey TO talent_profiles_user_id_fkey;

ALTER INDEX public.freelancer_profiles_pkey RENAME TO talent_profiles_pkey;
ALTER INDEX public.idx_freelancer_profiles_status RENAME TO idx_talent_profiles_status;

ALTER TRIGGER update_freelancer_profiles_updated_at ON public.talent_profiles
  RENAME TO update_talent_profiles_updated_at;

ALTER POLICY "Users can view own freelancer enrollment" ON public.talent_profiles
  RENAME TO "Users can view own talent enrollment";
ALTER POLICY "Admins can manage freelancer enrollments" ON public.talent_profiles
  RENAME TO "Admins can manage talent enrollments";

-- is_active_freelancer is LANGUAGE sql with a STRING body, which PostgreSQL
-- does not dependency-track. The rename above leaves its body pointing at a
-- relation that no longer exists, and it fails at RUNTIME rather than here --
-- surfacing as the RLS policy "Active consultants can view public profiles" on
-- `profiles` breaking for every verified consultant. It must be rebuilt in the
-- same transaction.
--
-- Body carried forward from its newest defining migration,
-- 20260812101000_retire_profile_capability_flags.sql:29-42, per the
-- latest-function-body rule.
CREATE OR REPLACE FUNCTION public.is_active_talent(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.talent_profiles AS tp
    WHERE tp.user_id = target_user_id
      AND tp.status = 'active'
  );
$$;

-- The policy references the function by OID, so it must be repointed at the new
-- one before the old can be dropped.
DROP POLICY IF EXISTS "Active consultants can view public profiles" ON public.profiles;
CREATE POLICY "Active consultants can view public profiles"
ON public.profiles
FOR SELECT
USING (
  public.is_active_talent(profiles.id)
  AND public.is_active_consultant(auth.uid())
);

DROP FUNCTION IF EXISTS public.is_active_freelancer(uuid);

COMMENT ON TABLE public.talent_profiles IS
  'Public-pool enrollment for Talent (active | paused). Renamed from freelancer_profiles on 2026-08-21; the role is called Talent everywhere else in the product.';
