-- Add account-level appearance preferences without coupling the rest of the
-- profiles.settings JSON document to onboarding completion.

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
      AND settings->'onboarding'->>'lane' IN ('client_freelancer', 'consultant')
    )
  );

COMMENT ON COLUMN public.profiles.settings IS
  'Versioned JSONB user settings. Supported keys include onboarding and appearance.';

CREATE OR REPLACE FUNCTION public.set_profile_appearance_preferences(
  p_user_id uuid,
  p_appearance jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appearance jsonb;
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.profiles
  SET settings = jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{appearance}',
    p_appearance,
    true
  )
  WHERE id = p_user_id
  RETURNING settings->'appearance' INTO v_appearance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  RETURN v_appearance;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_appearance_preferences(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_appearance_preferences(uuid, jsonb)
  TO service_role;

