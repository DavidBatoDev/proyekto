-- Race-safe, idempotent provisioning of a user's default workspace.
--
-- This is the server-side backstop behind the required "Create your workspace"
-- step at signup: AuthService.completeOnboarding calls it, so a user who
-- abandons the welcome deck still lands with a workspace. The deck's own
-- POST /workspaces racing this is harmless — whichever runs second finds the
-- existing owner membership and returns it.
--
-- The default-workspace rule, used identically here, in the backfill, and in
-- WorkspacesService.resolveWorkspaceForWrite: the earliest owner-role
-- membership by (joined_at, workspace_id). There is no is_default flag to keep
-- in sync.

CREATE OR REPLACE FUNCTION public.provision_default_workspace(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace public.workspaces%ROWTYPE;
  v_name text;
BEGIN
  -- Guests never get a workspace: they own nothing until they convert, and a
  -- guest profile is a throwaway identity.
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND COALESCE(p.is_guest, false) = false
  ) THEN
    RAISE EXCEPTION 'Profile not found or is a guest';
  END IF;

  -- Seed 1, not 0: seed 0 is provision_personal_project's lock keyspace, and
  -- completeOnboarding calls both in the same request.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  SELECT w.*
  INTO v_workspace
  FROM public.workspace_members wm
  JOIN public.workspaces w ON w.id = wm.workspace_id
  WHERE wm.user_id = p_user_id
    AND wm.role = 'owner'
  ORDER BY wm.joined_at, w.id
  LIMIT 1;

  IF NOT FOUND THEN
    -- Nameless profiles get "My Workspace", not the "My's Workspace" that a
    -- bare possessive fallback produces (the flaw in the older
    -- provision_personal_workspace body this is modelled on).
    SELECT COALESCE(
      NULLIF(btrim(p.first_name), ''),
      NULLIF(btrim(p.display_name), '')
    )
    INTO v_name
    FROM public.profiles p
    WHERE p.id = p_user_id;

    INSERT INTO public.workspaces (name, created_by)
    VALUES (
      CASE
        WHEN v_name IS NULL THEN 'My Workspace'
        ELSE v_name || '''s Workspace'
      END,
      p_user_id
    )
    RETURNING * INTO v_workspace;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace.id, p_user_id, 'owner');
  END IF;

  INSERT INTO public.workspace_subscriptions (workspace_id)
  VALUES (v_workspace.id)
  ON CONFLICT (workspace_id) DO NOTHING;

  RETURN QUERY
  SELECT v_workspace.id, v_workspace.name;
END;
$$;

COMMENT ON FUNCTION public.provision_default_workspace(uuid) IS
  'Service-role-only, race-safe provisioning of a user default workspace, its owner membership, and a free subscription row.';

REVOKE ALL ON FUNCTION public.provision_default_workspace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_default_workspace(uuid) TO service_role;
