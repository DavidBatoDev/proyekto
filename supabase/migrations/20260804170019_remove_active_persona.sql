-- Remove the retired global persona switch from profiles.
--
-- Authorization is now contextual:
--   * verified consultant capability: profiles.is_consultant_verified
--   * staff authority: admin_profiles / public.is_admin()
--   * project authority: project_access
--   * freelancer discovery: profiles.is_public through the go-live flow

BEGIN;

-- Replace the latest create_guest_user body before dropping the column it used.
CREATE OR REPLACE FUNCTION public.create_guest_user(session_id TEXT)
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

  INSERT INTO public.profiles (
    id,
    email,
    is_guest,
    guest_session_id,
    display_name
  ) VALUES (
    guest_id,
    guest_email,
    TRUE,
    session_id,
    'Guest User'
  )
  ON CONFLICT (id) DO UPDATE SET
    is_guest = TRUE,
    guest_session_id = EXCLUDED.guest_session_id,
    display_name = COALESCE(public.profiles.display_name, 'Guest User');

  RETURN guest_id;
END;
$$;

COMMENT ON FUNCTION public.create_guest_user(TEXT) IS
  'Creates a guest auth user and profile directly without a global persona; schema-qualifies pgcrypto helpers because search_path is locked to public.';

-- Replace the remaining persona-based admin policies with the durable staff
-- authority table. These names come from the original migrations and remain
-- live unless explicitly replaced.
DROP POLICY IF EXISTS "Admin can delete projects" ON public.projects;
CREATE POLICY "Admin can delete projects"
  ON public.projects FOR DELETE
  USING (public.is_admin());

DROP POLICY IF EXISTS "user_verifications: admin read"
  ON public.user_verifications;
CREATE POLICY "user_verifications: admin read"
  ON public.user_verifications FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "user_verifications: admin write"
  ON public.user_verifications;
CREATE POLICY "user_verifications: admin write"
  ON public.user_verifications FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "user_identity_documents: admin all"
  ON public.user_identity_documents;
CREATE POLICY "user_identity_documents: admin all"
  ON public.user_identity_documents FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS consultant_persona_requires_verification;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS active_persona;

DROP TYPE IF EXISTS public.persona_type;

COMMIT;
