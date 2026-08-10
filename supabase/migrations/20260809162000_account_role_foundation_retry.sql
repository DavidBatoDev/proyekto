-- Fix-forward for the production migration record named
-- `account_role_foundation`, which was recorded without its query payload by
-- the MCP client. The original migration remains immutable. Every operation
-- here is idempotent so fresh databases can safely run both files.
--
-- The existing signup/profile creation functions intentionally remain unchanged:
-- the constant `talent` default covers their inserts. Account role is distinct
-- from project_access.role/origin and from admin_profiles staff authority.

BEGIN;

DO $$
BEGIN
  CREATE TYPE public.account_role AS ENUM ('client', 'talent', 'consultant');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role public.account_role NOT NULL DEFAULT 'talent';

COMMENT ON COLUMN public.profiles.role IS
  'Durable server-owned account identity: client, talent, or consultant. Project authority remains in project_access; consultant capability also requires verification.';

-- Backfill precedence:
--   1. Synthetic guest profiles are always talent.
--   2. Verified consultants and consultant-lane applicants are consultants.
--   3. Strong client-only evidence becomes client.
--   4. Mixed identities and accounts without evidence remain talent.
UPDATE public.profiles
SET role = 'talent'
WHERE is_guest IS TRUE;

UPDATE public.profiles
SET role = 'consultant'
WHERE is_guest IS NOT TRUE
  AND (
    is_consultant_verified IS TRUE
    OR settings->'onboarding'->>'lane' = 'consultant'
  );

UPDATE public.profiles AS p
SET role = 'client'
WHERE p.role = 'talent'
  AND p.is_guest IS NOT TRUE
  AND (
    (
      COALESCE(
        p.settings->'onboarding'->'intent'->>'client',
        'false'
      ) = 'true'
      AND COALESCE(
        p.settings->'onboarding'->'intent'->>'freelancer',
        'false'
      ) = 'false'
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects AS pr
      WHERE pr.client_id = p.id
        AND COALESCE(pr.is_personal_workspace, false) = false
    )
  )
  AND NOT (
    COALESCE(
      p.settings->'onboarding'->'intent'->>'freelancer',
      'false'
    ) = 'true'
    OR p.is_public IS TRUE
    OR EXISTS (
      SELECT 1 FROM public.user_rate_settings AS r WHERE r.user_id = p.id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_portfolios AS pf WHERE pf.user_id = p.id
    )
  );

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS settings_onboarding_structure_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT settings_onboarding_structure_check
  CHECK (
    settings IS NULL
    OR NOT (settings ? 'onboarding')
    OR (
      settings->'onboarding'->>'intent' IS NOT NULL
      AND settings->'onboarding'->'intent'->>'freelancer' IN ('true', 'false')
      AND settings->'onboarding'->'intent'->>'client' IN ('true', 'false')
      AND settings->'onboarding'->>'completed_at' IS NOT NULL
      AND settings->'onboarding'->>'lane' IN (
        'client_freelancer',
        'client',
        'talent',
        'consultant'
      )
    )
  );

CREATE OR REPLACE FUNCTION public.tg_profiles_protect_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.role := 'talent';
      NEW.is_consultant_verified := false;
    ELSE
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'profiles.role is server-managed';
      END IF;
      IF NEW.is_consultant_verified IS DISTINCT FROM OLD.is_consultant_verified THEN
        RAISE EXCEPTION 'profiles.is_consultant_verified is server-managed';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_privileged_columns ON public.profiles;
CREATE TRIGGER profiles_protect_privileged_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_profiles_protect_privileged_columns();

COMMIT;
