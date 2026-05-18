-- Fix create_guest_user function to work with handle_new_user trigger
-- Migration: 20260210000003_fix_create_guest_user.sql
-- Date: February 10, 2026
-- Description: Updates create_guest_user to let the trigger create the profile first

CREATE OR REPLACE FUNCTION create_guest_user(session_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  guest_id UUID;
  guest_email TEXT;
BEGIN
  -- Generate a unique email for the guest (not used for login)
  guest_email := 'guest_' || session_id || '@temp.proyekto.local';
  
  -- Create auth user with random password (they won't use it)
  -- The handle_new_user trigger will automatically create a basic profile
  INSERT INTO auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    guest_email,
    crypt(gen_random_uuid()::text, gen_salt('bf')), -- Random password
    now(), -- Auto-confirm email
    jsonb_build_object('is_guest', true, 'guest_session_id', session_id),
    now(),
    now()
  ) RETURNING id INTO guest_id;
  
  -- Wait a moment for trigger to complete (in case of async behavior)
  -- Then update the profile with guest-specific fields
  UPDATE profiles 
  SET 
    is_guest = TRUE,
    guest_session_id = session_id,
    display_name = 'Guest User',
    active_persona = 'freelancer'
  WHERE id = guest_id;
  
  RETURN guest_id;
END;
$$;

COMMENT ON FUNCTION create_guest_user IS 'Creates a guest user account - relies on handle_new_user trigger to create basic profile, then updates with guest fields';

