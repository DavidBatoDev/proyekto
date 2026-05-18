-- Add Guest Users Support
-- Migration: 20260210000000_add_guest_users.sql
-- Date: February 10, 2026
-- Description: Adds support for anonymous guest users who can create roadmaps before signing up

-- ============================================================================
-- ALTER PROFILES TABLE FOR GUEST SUPPORT
-- ============================================================================

-- Add guest user fields
ALTER TABLE profiles
ADD COLUMN is_guest BOOLEAN DEFAULT FALSE,
ADD COLUMN guest_session_id TEXT UNIQUE;

-- Make email nullable for guest users (but still required for regular users)
ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL;

-- Add check constraint: regular users must have email
ALTER TABLE profiles
ADD CONSTRAINT profiles_email_required_for_non_guests
CHECK (is_guest = TRUE OR email IS NOT NULL);

-- Create index for guest session lookups
CREATE INDEX idx_profiles_guest_session_id ON profiles(guest_session_id) WHERE guest_session_id IS NOT NULL;
CREATE INDEX idx_profiles_is_guest ON profiles(is_guest) WHERE is_guest = TRUE;

-- ============================================================================
-- GUEST USER CREATION FUNCTION
-- ============================================================================

-- Function to create a guest user profile
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
  
  -- The handle_new_user trigger will create a basic profile
  -- Now update it with guest-specific fields
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

-- Function to get guest user ID by session ID
CREATE OR REPLACE FUNCTION get_guest_user_id(session_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_id UUID;
BEGIN
  SELECT id INTO user_id
  FROM profiles
  WHERE guest_session_id = session_id
  AND is_guest = TRUE;
  
  RETURN user_id;
END;
$$;

-- ============================================================================
-- GUEST DATA CLEANUP
-- ============================================================================

-- Function to clean up old guest users and their data
CREATE OR REPLACE FUNCTION cleanup_old_guest_users()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete guest profiles older than 30 days
  -- Cascade will handle roadmaps and related data
  DELETE FROM profiles
  WHERE is_guest = TRUE
  AND created_at < (now() - INTERVAL '30 days');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$;

-- Create a scheduled job to run cleanup daily (requires pg_cron extension)
-- Note: This requires pg_cron to be enabled in Supabase dashboard
-- Uncomment and enable after pg_cron is configured:
-- SELECT cron.schedule(
--   'cleanup-guest-users',
--   '0 2 * * *', -- Run at 2 AM daily
--   $$ SELECT cleanup_old_guest_users(); $$
-- );

-- ============================================================================
-- GUEST USER RLS HELPER FUNCTION
-- ============================================================================

-- Function to check if current session is a valid guest session
CREATE OR REPLACE FUNCTION is_valid_guest_session(session_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM profiles
    WHERE guest_session_id = session_id
    AND is_guest = TRUE
    AND created_at > (now() - INTERVAL '30 days')
  );
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN profiles.is_guest IS 'TRUE for anonymous guest users who have not signed up';
COMMENT ON COLUMN profiles.guest_session_id IS 'Unique session identifier for guest users, stored in browser localStorage';
COMMENT ON FUNCTION create_guest_user IS 'Creates a new guest user profile with the given session ID';
COMMENT ON FUNCTION get_guest_user_id IS 'Retrieves the user ID for a guest session ID';
COMMENT ON FUNCTION cleanup_old_guest_users IS 'Deletes guest users older than 30 days and their associated data';
COMMENT ON FUNCTION is_valid_guest_session IS 'Checks if a guest session ID is valid and not expired';

