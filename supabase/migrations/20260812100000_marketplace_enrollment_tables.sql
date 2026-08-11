-- Marketplace enrollment tables (expand phase).
--
-- This migration is safe to apply before the enrollment-aware backend deploys.
-- Temporary one-way sync triggers keep the legacy profiles flags current during
-- the expand/deploy window, so older clients and the deployed backend continue to
-- work without dual-writing in application code. Avoid application approvals and
-- freelancer go-live actions between the expand apply and backend deploy; run the
-- documented reconciliation query before applying the contract migration.
--
-- The backfill is not silent enrollment. Every consultant row comes from an
-- explicit admin approval recorded by is_consultant_verified=true (including one
-- historical approved test account without an application), and every freelancer
-- row comes from the only existing is_public writer: the explicit go-live action.
-- user_rate_settings deliberately remains the shared rate card for both enrollment
-- paths and is not absorbed into either table.
--
-- Both tables are owner-readable and admin-manageable through RLS. They expose no
-- authenticated owner write policy: self-service transitions use the backend's
-- service-role client. The contract migration uses SECURITY DEFINER predicates so
-- the profiles policy neither recurses into profiles nor evaluates enrollment-table
-- RLS as the caller.

BEGIN;

CREATE TABLE IF NOT EXISTS public.consultant_profiles (
  user_id uuid PRIMARY KEY
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  application_id uuid
    REFERENCES public.consultant_applications(id) ON DELETE SET NULL,
  verified_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  status_reason text,
  status_changed_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultant_profiles_status_check
    CHECK (status IN ('pending', 'verified', 'suspended', 'revoked'))
);

CREATE TABLE IF NOT EXISTS public.freelancer_profiles (
  user_id uuid PRIMARY KEY
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  went_live_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT freelancer_profiles_status_check
    CHECK (status IN ('active', 'paused'))
);

CREATE INDEX IF NOT EXISTS idx_consultant_profiles_status
  ON public.consultant_profiles(status);
CREATE INDEX IF NOT EXISTS idx_freelancer_profiles_status
  ON public.freelancer_profiles(status);

DROP TRIGGER IF EXISTS update_consultant_profiles_updated_at
  ON public.consultant_profiles;
CREATE TRIGGER update_consultant_profiles_updated_at
  BEFORE UPDATE ON public.consultant_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_freelancer_profiles_updated_at
  ON public.freelancer_profiles;
CREATE TRIGGER update_freelancer_profiles_updated_at
  BEFORE UPDATE ON public.freelancer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.consultant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freelancer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own consultant enrollment"
  ON public.consultant_profiles;
CREATE POLICY "Users can view own consultant enrollment"
ON public.consultant_profiles
FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage consultant enrollments"
  ON public.consultant_profiles;
CREATE POLICY "Admins can manage consultant enrollments"
ON public.consultant_profiles
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can view own freelancer enrollment"
  ON public.freelancer_profiles;
CREATE POLICY "Users can view own freelancer enrollment"
ON public.freelancer_profiles
FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage freelancer enrollments"
  ON public.freelancer_profiles;
CREATE POLICY "Admins can manage freelancer enrollments"
ON public.freelancer_profiles
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

INSERT INTO public.consultant_profiles (
  user_id,
  status,
  application_id,
  verified_at,
  status_changed_by,
  created_at,
  updated_at
)
SELECT
  p.id,
  'verified',
  ca.id,
  COALESCE(ca.reviewed_at, p.updated_at, now()),
  ca.reviewed_by,
  COALESCE(ca.reviewed_at, p.updated_at, now()),
  now()
FROM public.profiles AS p
LEFT JOIN public.consultant_applications AS ca
  ON ca.user_id = p.id
 AND ca.status = 'approved'
WHERE p.is_consultant_verified IS TRUE
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.freelancer_profiles (
  user_id,
  status,
  went_live_at,
  created_at,
  updated_at
)
SELECT
  p.id,
  'active',
  COALESCE(p.updated_at, p.created_at, now()),
  COALESCE(p.updated_at, p.created_at, now()),
  now()
FROM public.profiles AS p
WHERE p.is_public IS TRUE
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tg_sync_consultant_enrollment_legacy_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET is_consultant_verified = (NEW.status = 'verified')
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE
  ON FUNCTION public.tg_sync_consultant_enrollment_legacy_flag()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_consultant_enrollment_legacy_flag
  ON public.consultant_profiles;
CREATE TRIGGER sync_consultant_enrollment_legacy_flag
  AFTER INSERT OR UPDATE OF status ON public.consultant_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_consultant_enrollment_legacy_flag();

CREATE OR REPLACE FUNCTION public.tg_sync_freelancer_enrollment_legacy_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET is_public = (NEW.status = 'active')
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE
  ON FUNCTION public.tg_sync_freelancer_enrollment_legacy_flag()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_freelancer_enrollment_legacy_flag
  ON public.freelancer_profiles;
CREATE TRIGGER sync_freelancer_enrollment_legacy_flag
  AFTER INSERT OR UPDATE OF status ON public.freelancer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_freelancer_enrollment_legacy_flag();

INSERT INTO public.notification_types (name, category, priority)
VALUES
  ('consultant_application_approved', 'global', 'high'),
  ('consultant_application_rejected', 'global', 'high'),
  ('consultant_suspended', 'global', 'high'),
  ('consultant_reinstated', 'global', 'high'),
  ('consultant_revoked', 'global', 'high')
ON CONFLICT (name) DO NOTHING;

COMMIT;
