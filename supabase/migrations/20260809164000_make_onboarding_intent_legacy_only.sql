-- `profiles.role` and the canonical onboarding lane now carry account identity.
-- Keep the old two-boolean intent only for historical `client_freelancer` rows
-- and old clients that may still submit that combined lane during rollout.

BEGIN;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS settings_onboarding_structure_check;

UPDATE public.profiles
SET settings = jsonb_set(
  settings,
  '{onboarding}',
  (settings->'onboarding') - 'intent'
)
WHERE settings->'onboarding'->>'lane' IN ('client', 'talent', 'consultant')
  AND settings->'onboarding' ? 'intent';

ALTER TABLE public.profiles
  ADD CONSTRAINT settings_onboarding_structure_check
  CHECK (
    settings IS NULL
    OR NOT (settings ? 'onboarding')
    OR (
      settings->'onboarding'->>'completed_at' IS NOT NULL
      AND settings->'onboarding'->>'lane' IN (
        'client_freelancer',
        'client',
        'talent',
        'consultant'
      )
      AND (
        NOT (settings->'onboarding' ? 'intent')
        OR (
          jsonb_typeof(settings->'onboarding'->'intent') = 'object'
          AND settings->'onboarding'->'intent'->>'freelancer' IN (
            'true',
            'false'
          )
          AND settings->'onboarding'->'intent'->>'client' IN ('true', 'false')
        )
      )
      AND (
        settings->'onboarding'->>'lane' <> 'client_freelancer'
        OR settings->'onboarding' ? 'intent'
      )
    )
  );

COMMENT ON COLUMN public.profiles.settings IS
  'JSONB user settings. Canonical onboarding lanes use lane + completed_at. Legacy client_freelancer rows also require intent {freelancer, client} for compatibility.';

COMMIT;
