-- Fix create_guest_user pgcrypto resolution under a locked search_path.
-- The function uses SET search_path = public, so pgcrypto helpers installed
-- in Supabase's extensions schema must be schema-qualified.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION create_guest_user(session_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  guest_id UUID;
  guest_email TEXT;
BEGIN
  guest_email := 'guest_' || session_id || '@temp.proyekto.local';

  -- Create the auth user (random, unused password; auto-confirmed).
  INSERT INTO auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    extensions.gen_random_uuid(),
    guest_email,
    extensions.crypt(extensions.gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('is_guest', true, 'guest_session_id', session_id),
    now(),
    now()
  ) RETURNING id INTO guest_id;

  -- Persist the guest profile ourselves. Do NOT depend on handle_new_user:
  -- its EXCEPTION-WHEN-OTHERS block is a savepoint, so a failure anywhere in
  -- it (e.g. wallet creation) silently rolls back the profile it just made.
  INSERT INTO public.profiles (
    id,
    email,
    is_guest,
    guest_session_id,
    display_name,
    active_persona
  ) VALUES (
    guest_id,
    guest_email,
    TRUE,
    session_id,
    'Guest User',
    'freelancer'
  )
  ON CONFLICT (id) DO UPDATE SET
    is_guest = TRUE,
    guest_session_id = EXCLUDED.guest_session_id,
    display_name = COALESCE(public.profiles.display_name, 'Guest User'),
    active_persona = COALESCE(public.profiles.active_persona, 'freelancer');

  RETURN guest_id;
END;
$$;

COMMENT ON FUNCTION create_guest_user IS
  'Creates a guest auth user AND its profile directly; schema-qualifies pgcrypto helpers because search_path is locked to public.';
