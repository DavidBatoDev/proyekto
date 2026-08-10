-- Account role is authoritative, so completed historical onboarding settings
-- can use the same canonical shape as new signups. The API still accepts the
-- legacy combined lane during rollout but resolves it before persistence.

BEGIN;

UPDATE public.profiles
SET settings = jsonb_set(
  settings,
  '{onboarding}',
  ((settings->'onboarding') - 'intent')
    || jsonb_build_object('lane', role::text)
)
WHERE settings->'onboarding'->>'lane' = 'client_freelancer';

COMMENT ON COLUMN public.profiles.settings IS
  'JSONB user settings. Persisted onboarding uses canonical lane + completed_at. Legacy client_freelancer intent is accepted only as transitional API input and is resolved before persistence.';

COMMIT;
