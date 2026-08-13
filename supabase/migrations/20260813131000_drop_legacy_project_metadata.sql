-- Contraction migration. Apply only after the junction-aware backend/web are
-- live and the mobile OTA compatibility window for direct column reads closes.

CREATE OR REPLACE FUNCTION public.provision_personal_workspace(p_user_id uuid)
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
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT p.*
  INTO v_project
  FROM public.personal_workspaces pw
  JOIN public.projects p ON p.id = pw.project_id
  WHERE pw.user_id = p_user_id;

  IF NOT FOUND THEN
    SELECT COALESCE(
      NULLIF(btrim(p.first_name), ''),
      NULLIF(btrim(p.display_name), ''),
      'My'
    )
    INTO v_name
    FROM public.profiles p
    WHERE p.id = p_user_id;

    INSERT INTO public.projects (owner_id, title, status)
    VALUES (
      p_user_id,
      v_name || '''s Workspace',
      'active'::public.project_status
    )
    RETURNING * INTO v_project;

    INSERT INTO public.personal_workspaces (user_id, project_id)
    VALUES (p_user_id, v_project.id);
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

REVOKE ALL ON FUNCTION public.provision_personal_workspace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_personal_workspace(uuid) TO service_role;

DROP TRIGGER IF EXISTS projects_sync_personal_workspace_mapping ON public.projects;
DROP FUNCTION IF EXISTS public.tg_sync_personal_workspace_mapping();

DROP INDEX IF EXISTS public.one_personal_workspace_per_user;
DROP INDEX IF EXISTS public.idx_projects_category;
DROP INDEX IF EXISTS public.idx_projects_budget_range;
DROP INDEX IF EXISTS public.idx_projects_project_state;

ALTER TABLE public.projects
  DROP COLUMN IF EXISTS funding_status,
  DROP COLUMN IF EXISTS budget_range,
  DROP COLUMN IF EXISTS start_date,
  DROP COLUMN IF EXISTS custom_start_date,
  DROP COLUMN IF EXISTS role_permissions_json,
  DROP COLUMN IF EXISTS is_personal_workspace,
  DROP COLUMN IF EXISTS skills,
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS project_state;
