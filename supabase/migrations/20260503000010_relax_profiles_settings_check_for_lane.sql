-- Migration: 20260503000010_relax_profiles_settings_check_for_lane.sql
-- Date: May 3, 2026
-- Description:
--   Replace the existing settings_onboarding_structure_check CHECK constraint on
--   profiles to additionally require an `onboarding.lane` key with one of two
--   values ('client_freelancer' | 'consultant'). This is needed for the
--   lane-aware signup refactor (slice 1) so completeOnboarding() can route the
--   user to the correct post-signup destination.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS settings_onboarding_structure_check;

ALTER TABLE public.profiles
ADD CONSTRAINT settings_onboarding_structure_check
CHECK (
  settings IS NULL
  OR settings::text = '{}'
  OR (
    settings->'onboarding' IS NOT NULL
    AND settings->'onboarding'->>'intent' IS NOT NULL
    AND settings->'onboarding'->'intent'->>'freelancer' IN ('true', 'false')
    AND settings->'onboarding'->'intent'->>'client' IN ('true', 'false')
    AND settings->'onboarding'->>'completed_at' IS NOT NULL
    AND settings->'onboarding'->>'lane' IN ('client_freelancer', 'consultant')
  )
);

COMMENT ON COLUMN public.profiles.settings IS 'JSONB user settings. Onboarding shape: {"onboarding": {"lane": "client_freelancer"|"consultant", "intent": {"freelancer": bool, "client": bool}, "completed_at": timestamp}}';
