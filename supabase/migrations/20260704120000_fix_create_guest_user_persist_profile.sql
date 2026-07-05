-- Fix create_guest_user so the guest PROFILE reliably persists.
-- Migration: 20260704120000_fix_create_guest_user_persist_profile.sql
-- Date: July 4, 2026
--
-- Root cause (observed in the SG prod DB): create_guest_user inserted an
-- auth.users row and relied on the handle_new_user AFTER-INSERT trigger to
-- create the profile, then UPDATE'd it with guest fields. But handle_new_user
-- (20251229000007) wraps its body in `EXCEPTION WHEN OTHERS ... RETURN NEW`.
-- In PL/pgSQL a block with an exception handler is a savepoint, so when any
-- statement inside it raises (e.g. create_wallet_for_user for the synthetic
-- guest email), ALL of the trigger's work — including the profile INSERT — is
-- rolled back, while the auth.users row (the triggering statement) still
-- commits. Net: create_guest_user returned a UUID but no profile existed, so
-- the guest header never matched profiles.guest_session_id and every guest
-- API call 401'd.
--
-- Fix: create the profile DIRECTLY in create_guest_user (idempotent upsert),
-- independent of the trigger. The trigger may still create/roll back its own
-- row; ON CONFLICT (id) makes this correct either way.

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
    gen_random_uuid(),
    guest_email,
    crypt(gen_random_uuid()::text, gen_salt('bf')),
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
  'Creates a guest auth user AND its profile directly (does not rely on the '
  'handle_new_user trigger, whose exception handler can roll back the profile).';
