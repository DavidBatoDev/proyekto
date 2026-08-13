-- Normalize the personal-workspace identity out of projects while preserving
-- the existing one-workspace-per-user contract during a mixed-version deploy.

CREATE TABLE IF NOT EXISTS public.personal_workspaces (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.personal_workspaces IS
  'One-to-one identity link for the project provisioned as a user personal workspace. This is classification metadata, never an authorization source.';
COMMENT ON COLUMN public.personal_workspaces.user_id IS
  'The user whose personal workspace this is. At most one workspace per user.';
COMMENT ON COLUMN public.personal_workspaces.project_id IS
  'The backing execution project. Access remains governed exclusively by project_access.';

ALTER TABLE public.personal_workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS personal_workspaces_select_own ON public.personal_workspaces;
CREATE POLICY personal_workspaces_select_own
ON public.personal_workspaces
FOR SELECT
USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.personal_workspaces FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.personal_workspaces TO authenticated;
GRANT ALL ON TABLE public.personal_workspaces TO service_role;

INSERT INTO public.personal_workspaces (user_id, project_id, created_at)
SELECT p.owner_id, p.id, COALESCE(p.created_at, now())
FROM public.projects p
WHERE p.is_personal_workspace = true
ON CONFLICT (user_id) DO UPDATE
SET project_id = EXCLUDED.project_id;

CREATE OR REPLACE FUNCTION public.tg_sync_personal_workspace_mapping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.personal_workspaces
  WHERE project_id = NEW.id;

  IF NEW.is_personal_workspace = true THEN
    INSERT INTO public.personal_workspaces (user_id, project_id, created_at)
    VALUES (NEW.owner_id, NEW.id, COALESCE(NEW.created_at, now()))
    ON CONFLICT (user_id) DO UPDATE
    SET project_id = EXCLUDED.project_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_sync_personal_workspace_mapping ON public.projects;
CREATE TRIGGER projects_sync_personal_workspace_mapping
AFTER INSERT OR UPDATE OF owner_id, is_personal_workspace ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.tg_sync_personal_workspace_mapping();

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

    INSERT INTO public.projects (
      owner_id,
      title,
      status,
      is_personal_workspace
    )
    VALUES (
      p_user_id,
      v_name || '''s Workspace',
      'active'::public.project_status,
      true
    )
    RETURNING * INTO v_project;

    INSERT INTO public.personal_workspaces (user_id, project_id)
    VALUES (p_user_id, v_project.id)
    ON CONFLICT (user_id) DO UPDATE
    SET project_id = EXCLUDED.project_id;
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

COMMENT ON FUNCTION public.provision_personal_workspace(uuid) IS
  'Service-role-only, race-safe provisioning of one personal workspace project and its owner access row.';

REVOKE ALL ON FUNCTION public.provision_personal_workspace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_personal_workspace(uuid) TO service_role;
