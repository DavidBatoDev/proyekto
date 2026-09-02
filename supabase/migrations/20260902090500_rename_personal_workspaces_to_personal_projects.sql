-- "Workspace" now means the organization tier (20260902090000), so the personal
-- workspace — which was always just a project — is renamed to what it is.
--
-- Expand phase: the table is renamed, and a compat view plus a wrapper function
-- keep the still-running previous backend revision working through the deploy
-- window. 20260902130000 drops both once the new revision is live.
--
-- The provision_personal_project body starts from the NEWEST definition of
-- provision_personal_workspace (20260813131000_drop_legacy_project_metadata.sql,
-- NOT the 20260813130000 one, which still wrote the dropped
-- is_personal_workspace column). Three changes: the table name, the title
-- suffix, and stamping projects.workspace_id.
--
-- NOT renamed: the project_access.origin = 'personal_workspace' literal. It is
-- wired through resolvePermissions and its hand-maintained web mirrors and
-- snapshots; changing it is separate, deliberate work.

BEGIN;

-- ── Table rename ────────────────────────────────────────────────────────────

ALTER TABLE public.personal_workspaces RENAME TO personal_projects;

ALTER TABLE public.personal_projects
  RENAME CONSTRAINT personal_workspaces_pkey TO personal_projects_pkey;
ALTER TABLE public.personal_projects
  RENAME CONSTRAINT personal_workspaces_project_id_key TO personal_projects_project_id_key;

ALTER POLICY personal_workspaces_select_own
  ON public.personal_projects
  RENAME TO personal_projects_select_own;

COMMENT ON TABLE public.personal_projects IS
  'One-to-one identity link for the project provisioned as a user personal project (formerly "personal workspace"). This is classification metadata, never an authorization source.';
COMMENT ON COLUMN public.personal_projects.user_id IS
  'The user whose personal project this is. At most one per user.';
COMMENT ON COLUMN public.personal_projects.project_id IS
  'The backing execution project. Access remains governed exclusively by project_access.';

-- ── Mixed-version compatibility view ────────────────────────────────────────
-- The previous backend revision reads personal_workspaces directly in
-- PersonalWorkspaceService.findForUser and chat.repository.supabase.ts. Dropped
-- in 20260902130000.

CREATE OR REPLACE VIEW public.personal_workspaces
  WITH (security_invoker = true)
  AS SELECT * FROM public.personal_projects;

COMMENT ON VIEW public.personal_workspaces IS
  'Deprecated compatibility shim for the personal_projects rename. Dropped after the backend cutover (20260902130000).';

REVOKE ALL ON public.personal_workspaces FROM PUBLIC, anon;
GRANT SELECT ON public.personal_workspaces TO authenticated;
GRANT SELECT ON public.personal_workspaces TO service_role;

-- ── provision_personal_project ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.provision_personal_project(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  title text,
  owner_id uuid,
  status public.project_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_name text;
  v_workspace_id uuid;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT p.*
  INTO v_project
  FROM public.personal_projects pp
  JOIN public.projects p ON p.id = pp.project_id
  WHERE pp.user_id = p_user_id;

  IF NOT FOUND THEN
    SELECT COALESCE(
      NULLIF(btrim(p.first_name), ''),
      NULLIF(btrim(p.display_name), '')
    )
    INTO v_name
    FROM public.profiles p
    WHERE p.id = p_user_id;

    -- "'s Workspace" now names the organization tier, so the personal project
    -- takes a distinct suffix. A nameless profile gets "My Space" rather than
    -- the "My's Space" a bare possessive fallback would produce.
    INSERT INTO public.projects (owner_id, title, status)
    VALUES (
      p_user_id,
      CASE
        WHEN v_name IS NULL THEN 'My Space'
        ELSE v_name || '''s Space'
      END,
      'active'::public.project_status
    )
    RETURNING * INTO v_project;

    INSERT INTO public.personal_projects (user_id, project_id)
    VALUES (p_user_id, v_project.id);
  END IF;

  -- Place the personal project in the user's default workspace when it has no
  -- home yet. completeOnboarding provisions the workspace first, so this is
  -- normally set on the very first call.
  SELECT wm.workspace_id
  INTO v_workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = p_user_id
    AND wm.role = 'owner'
  ORDER BY wm.joined_at, wm.workspace_id
  LIMIT 1;

  -- Aliased: this function's RETURNS TABLE declares an OUT parameter named
  -- "id", so an unqualified WHERE id = ... is ambiguous and fails at runtime.
  IF v_workspace_id IS NOT NULL THEN
    UPDATE public.projects p
    SET workspace_id = v_workspace_id
    WHERE p.id = v_project.id
      AND p.workspace_id IS NULL;
  END IF;

  INSERT INTO public.project_access (
    project_id,
    user_id,
    role,
    origin,
    capabilities,
    granted_by,
    has_direct_grant
  )
  VALUES (
    v_project.id,
    p_user_id,
    'owner'::public.share_role,
    'personal_workspace',
    '{}'::jsonb,
    p_user_id,
    true
  )
  ON CONFLICT (project_id, user_id) DO UPDATE
  SET role = 'owner'::public.share_role,
      origin = 'personal_workspace',
      has_direct_grant = true,
      granted_by = p_user_id;

  RETURN QUERY
  SELECT v_project.id, v_project.title, v_project.owner_id, v_project.status;
END;
$$;

COMMENT ON FUNCTION public.provision_personal_project(uuid) IS
  'Service-role-only, race-safe provisioning of one personal project and its owner access row. Formerly provision_personal_workspace.';

REVOKE ALL ON FUNCTION public.provision_personal_project(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_personal_project(uuid) TO service_role;

-- ── Legacy wrapper ──────────────────────────────────────────────────────────
-- Keeps the previous backend revision's RPC call working. Dropped in
-- 20260902130000.

CREATE OR REPLACE FUNCTION public.provision_personal_workspace(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  title text,
  owner_id uuid,
  status public.project_status
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.provision_personal_project(p_user_id);
$$;

COMMENT ON FUNCTION public.provision_personal_workspace(uuid) IS
  'Deprecated compatibility wrapper delegating to provision_personal_project. Dropped after the backend cutover (20260902130000).';

REVOKE ALL ON FUNCTION public.provision_personal_workspace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_personal_workspace(uuid) TO service_role;

COMMIT;
