-- Restore public.set_profile_appearance_preferences.
--
-- The function was authored in 20260711130000_add_profile_appearance_preferences.sql
-- but that migration never reached either hosted project, so every call to
-- PUT /users/me/preferences/appearance failed with "Could not find the function
-- ... in the schema cache".
--
-- Only the function is restored here. That original migration ALSO rewrites
-- settings_onboarding_structure_check, and the live constraint has since moved
-- on (it permits the client/talent lanes and no longer requires `intent`), so
-- replaying the file wholesale would silently roll the constraint back.
--
-- Body is copied from the newest definition of the function, which is still the
-- one in 20260711130000.

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
