-- Complete the projects.owner_id contract migration.
--
-- All application consumers now use owner_id. Repoint the remaining RLS
-- dependencies explicitly, then remove the compatibility trigger, indexes,
-- foreign key, and client_id column without CASCADE.

ALTER POLICY "Project editors can insert contracts" ON public.contracts
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['owner'::public.share_role, 'admin'::public.share_role, 'editor'::public.share_role])
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = contracts.project_id
      AND (p.owner_id = auth.uid() OR p.consultant_id = auth.uid())
  )
);

ALTER POLICY "Project editors can update contracts" ON public.contracts
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['owner'::public.share_role, 'admin'::public.share_role, 'editor'::public.share_role])
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = contracts.project_id
      AND (p.owner_id = auth.uid() OR p.consultant_id = auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['owner'::public.share_role, 'admin'::public.share_role, 'editor'::public.share_role])
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = contracts.project_id
      AND (p.owner_id = auth.uid() OR p.consultant_id = auth.uid())
  )
);

ALTER POLICY "Project members can view contracts" ON public.contracts
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = contracts.project_id
      AND (p.owner_id = auth.uid() OR p.consultant_id = auth.uid())
  )
  OR contracts.client_user_id = auth.uid()
);

ALTER POLICY "Project members can insert project briefs" ON public.project_briefs
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_briefs.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['admin'::public.share_role, 'editor'::public.share_role])
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_briefs.project_id
      AND (p.owner_id = auth.uid() OR p.consultant_id = auth.uid())
  )
);

ALTER POLICY "Project members can update project briefs" ON public.project_briefs
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_briefs.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['admin'::public.share_role, 'editor'::public.share_role])
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_briefs.project_id
      AND (p.owner_id = auth.uid() OR p.consultant_id = auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_briefs.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['admin'::public.share_role, 'editor'::public.share_role])
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_briefs.project_id
      AND (p.owner_id = auth.uid() OR p.consultant_id = auth.uid())
  )
);

ALTER POLICY "Project members can view project briefs" ON public.project_briefs
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_briefs.project_id
      AND pa.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_briefs.project_id
      AND (p.owner_id = auth.uid() OR p.consultant_id = auth.uid())
  )
);

ALTER POLICY "Inviters can create project invites" ON public.project_invites
WITH CHECK (
  project_invites.invited_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_invites.project_id
      AND (p.consultant_id = auth.uid() OR p.owner_id = auth.uid())
  )
);

DROP TRIGGER IF EXISTS projects_sync_owner_columns ON public.projects;
DROP FUNCTION IF EXISTS public.tg_projects_sync_owner_columns();

DROP INDEX IF EXISTS public.one_personal_workspace_per_user;
DROP INDEX IF EXISTS public.idx_projects_client;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_client_id_fkey;

ALTER TABLE public.projects
  DROP COLUMN IF EXISTS client_id;
