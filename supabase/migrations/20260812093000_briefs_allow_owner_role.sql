-- Fix a consultant lockout introduced by 20260812090000: the brief
-- insert/update policies kept their role IN ('admin','editor') access branch
-- while dropping the projects.consultant_id arm — but the consultant of
-- record holds role='owner' (origin='consultant') and previously entered
-- through the deleted arm. Add 'owner' to both role arrays. This widens
-- nothing in practice: every other owner-role holder (client owners via the
-- legacy backfill, personal-workspace owners) is already admitted by the
-- p.owner_id arm these policies retain.

BEGIN;

ALTER POLICY "Project members can insert project briefs"
ON public.project_briefs
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_briefs.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (
        ARRAY[
          'owner'::public.share_role,
          'admin'::public.share_role,
          'editor'::public.share_role
        ]
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_briefs.project_id
      AND p.owner_id = auth.uid()
  )
);

ALTER POLICY "Project members can update project briefs"
ON public.project_briefs
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_briefs.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (
        ARRAY[
          'owner'::public.share_role,
          'admin'::public.share_role,
          'editor'::public.share_role
        ]
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_briefs.project_id
      AND p.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_briefs.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (
        ARRAY[
          'owner'::public.share_role,
          'admin'::public.share_role,
          'editor'::public.share_role
        ]
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_briefs.project_id
      AND p.owner_id = auth.uid()
  )
);

COMMIT;
