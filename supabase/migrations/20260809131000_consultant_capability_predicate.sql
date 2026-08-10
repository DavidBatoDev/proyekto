-- Make consultant authorization depend on both durable account identity and
-- completed vetting while keeping the old helper name as a compatibility alias.

BEGIN;

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
      AND p.role = 'consultant'
      AND p.is_consultant_verified IS TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_verified_consultant(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_active_consultant(target_user_id);
$$;

CREATE OR REPLACE FUNCTION public.tg_team_member_rates_check_consultant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_owner_is_active_consultant boolean;
BEGIN
  SELECT public.is_active_consultant(t.owner_id)
  INTO v_owner_is_active_consultant
  FROM public.teams AS t
  WHERE t.id = NEW.team_id;

  IF v_owner_is_active_consultant IS NOT TRUE THEN
    RAISE EXCEPTION 'Team owner must be an active consultant to set rates on team members';
  END IF;

  RETURN NEW;
END
$$;

DROP POLICY IF EXISTS "Verified consultants can view public freelancers"
  ON public.profiles;

CREATE POLICY "Active consultants can view public profiles"
ON public.profiles
FOR SELECT
USING (
  is_public IS TRUE
  AND public.is_active_consultant(auth.uid())
);

COMMIT;
