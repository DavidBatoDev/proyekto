-- Migration: 20260503000080_consultant_persona_requires_verification.sql
-- Date: May 3, 2026
-- Description:
--   Defensive CHECK constraint on profiles. The application layer already
--   prevents `switchPersona('consultant')` for unverified users (see
--   AuthService.switchPersona), but a CHECK constraint guarantees the
--   invariant even if a future bug or direct-DB write tries to bypass it.
--
--   Invariant: a profile cannot have active_persona='consultant' unless
--   is_consultant_verified=true.
--
--   This is part of slice 3 (specs/platform-foundations/tasks.md task 3.3).

-- Defensive cleanup: any existing rows that violate the invariant get their
-- active_persona reset to 'freelancer' (the default) before we add the
-- constraint, so the migration cannot fail on legacy data.
UPDATE public.profiles
SET active_persona = 'freelancer'
WHERE active_persona = 'consultant'
  AND is_consultant_verified IS NOT TRUE;

ALTER TABLE public.profiles
ADD CONSTRAINT consultant_persona_requires_verification
CHECK (
  active_persona <> 'consultant'
  OR is_consultant_verified = true
);

COMMENT ON CONSTRAINT consultant_persona_requires_verification ON public.profiles
  IS 'Invariant: cannot be active_persona=consultant without is_consultant_verified=true. Mirrors AuthService.switchPersona enforcement.';
