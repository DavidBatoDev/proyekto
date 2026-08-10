-- Move the project-level identity pointer from client_id to owner_id.
--
-- profiles.role describes an account's primary product identity. Project ownership
-- is contextual, so a client, talent, or consultant profile may own a project.
--
-- This is the expand half of an expand/contract rollout. client_id remains as a
-- synchronized compatibility column so the currently deployed services keep working
-- while every runtime moves to owner_id. A later migration may drop client_id after
-- the new backend and web builds are live.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_id uuid;

UPDATE public.projects
SET owner_id = client_id
WHERE owner_id IS NULL;

ALTER TABLE public.projects
  ALTER COLUMN owner_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.projects'::regclass
      AND conname = 'projects_owner_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_owner
  ON public.projects(owner_id);

CREATE UNIQUE INDEX IF NOT EXISTS one_personal_workspace_per_owner
  ON public.projects(owner_id)
  WHERE is_personal_workspace = true;

CREATE OR REPLACE FUNCTION public.tg_projects_sync_owner_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.owner_id IS NULL THEN
      NEW.owner_id := NEW.client_id;
    ELSIF NEW.client_id IS NULL THEN
      NEW.client_id := NEW.owner_id;
    ELSIF NEW.owner_id IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION 'projects.owner_id and deprecated client_id must match';
    END IF;
  ELSE
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
       AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
      NEW.client_id := NEW.owner_id;
    ELSIF NEW.client_id IS DISTINCT FROM OLD.client_id
       AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
      NEW.owner_id := NEW.client_id;
    ELSIF NEW.owner_id IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION 'projects.owner_id and deprecated client_id must match';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS projects_sync_owner_columns ON public.projects;
CREATE TRIGGER projects_sync_owner_columns
BEFORE INSERT OR UPDATE OF owner_id, client_id ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.tg_projects_sync_owner_columns();

COMMENT ON COLUMN public.projects.owner_id IS
  'Profile that owns the project. Ownership is contextual and does not imply profiles.role = client.';

ALTER POLICY "Clients can create projects" ON public.projects
  RENAME TO "Owners can create projects";

ALTER POLICY "Owners can create projects" ON public.projects
  WITH CHECK (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.get_or_create_default_project(
  user_id_param uuid,
  roadmap_name text DEFAULT 'My Project'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  project_id uuid;
  project_title text;
BEGIN
  project_title := COALESCE(roadmap_name, 'Untitled Project');

  INSERT INTO public.projects (
    id,
    title,
    status,
    owner_id,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    project_title,
    'draft',
    user_id_param,
    now(),
    now()
  ) RETURNING id INTO project_id;

  RETURN project_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_roadmap_to_project(
  roadmap_id_param uuid,
  project_id_param uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  existing_roadmap_id uuid;
  roadmap_owner_id uuid;
  project_owner_id uuid;
BEGIN
  SELECT owner_id INTO roadmap_owner_id
  FROM public.roadmaps
  WHERE id = roadmap_id_param;

  IF roadmap_owner_id IS NULL THEN
    RAISE EXCEPTION 'Roadmap not found';
  END IF;

  SELECT owner_id INTO project_owner_id
  FROM public.projects
  WHERE id = project_id_param;

  IF project_owner_id IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF roadmap_owner_id != project_owner_id THEN
    RAISE EXCEPTION 'Roadmap owner must match project owner';
  END IF;

  SELECT id INTO existing_roadmap_id
  FROM public.roadmaps
  WHERE project_id = project_id_param
    AND id != roadmap_id_param
  LIMIT 1;

  IF existing_roadmap_id IS NOT NULL THEN
    RAISE EXCEPTION 'Project already has a roadmap';
  END IF;

  UPDATE public.roadmaps
  SET project_id = project_id_param,
      updated_at = now()
  WHERE id = roadmap_id_param;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.project_chat_is_member(
  target_project_id uuid,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = target_project_id
      AND (p.owner_id = target_user_id OR p.consultant_id = target_user_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = target_project_id
      AND pa.user_id = target_user_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.project_chat_role(
  target_project_id uuid,
  target_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  project_row record;
  share_origin text;
BEGIN
  SELECT p.owner_id, p.consultant_id
  INTO project_row
  FROM public.projects p
  WHERE p.id = target_project_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF target_user_id = project_row.consultant_id THEN
    RETURN 'consultant';
  END IF;

  IF target_user_id = project_row.owner_id THEN
    RETURN 'client';
  END IF;

  SELECT pa.origin
  INTO share_origin
  FROM public.project_access pa
  WHERE pa.project_id = target_project_id
    AND pa.user_id = target_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF share_origin = 'consultant' THEN
    RETURN 'consultant';
  END IF;

  IF share_origin IN ('client', 'personal_workspace') THEN
    RETURN 'client';
  END IF;

  RETURN 'freelancer';
END;
$function$;

CREATE OR REPLACE FUNCTION public.project_chat_users_share_any_project(
  user_a uuid,
  user_b uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_access pa
    JOIN public.project_access pb ON pb.project_id = pa.project_id
    WHERE pa.user_id = user_a
      AND pb.user_id = user_b
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE (p.owner_id = user_a OR p.consultant_id = user_a)
      AND (p.owner_id = user_b OR p.consultant_id = user_b)
  );
$function$;
