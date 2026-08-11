-- Phase 3 removes the final RLS dependencies on projects.consultant_id.
-- Every replacement uses project_access as the authorization source while
-- preserving the remaining predicate arms from each policy's latest body.
-- The files policy keeps its historical name for compatibility even though
-- project owner/admin access now replaces the consultant-column check.

BEGIN;

ALTER POLICY "Inviters can create project invites"
ON public.project_invites
WITH CHECK (
  project_invites.invited_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_invites.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (
        ARRAY['owner'::public.share_role, 'admin'::public.share_role]
      )
  )
);

ALTER POLICY "Inviter and invitee can view invites"
ON public.project_invites
USING (
  invited_by = auth.uid()
  OR invitee_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_invites.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (
        ARRAY['owner'::public.share_role, 'admin'::public.share_role]
      )
  )
);

DROP POLICY IF EXISTS "Inviter and project admins can delete invites"
ON public.project_invites;

CREATE POLICY "Inviter and project admins can delete invites"
ON public.project_invites
FOR DELETE
USING (
  invited_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_invites.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (
        ARRAY['owner'::public.share_role, 'admin'::public.share_role]
      )
  )
);

ALTER POLICY "Project members can insert project briefs"
ON public.project_briefs
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = project_briefs.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (
        ARRAY['admin'::public.share_role, 'editor'::public.share_role]
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
        ARRAY['admin'::public.share_role, 'editor'::public.share_role]
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
        ARRAY['admin'::public.share_role, 'editor'::public.share_role]
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_briefs.project_id
      AND p.owner_id = auth.uid()
  )
);

ALTER POLICY "Project members can view project briefs"
ON public.project_briefs
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
      AND p.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS meetings_delete ON public.meetings;
CREATE POLICY meetings_delete ON public.meetings
  FOR DELETE USING (
    auth.uid() = created_by
    OR auth.uid() = host_id
    OR (project_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.project_access pa
      WHERE pa.project_id = meetings.project_id
        AND pa.user_id = auth.uid()
        AND pa.role = ANY (
          ARRAY['owner'::public.share_role, 'admin'::public.share_role]
        )
    ))
  );

DROP POLICY IF EXISTS meeting_series_delete ON public.meeting_series;
CREATE POLICY meeting_series_delete ON public.meeting_series
  FOR DELETE USING (
    auth.uid() = created_by
    OR auth.uid() = host_id
    OR (project_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.project_access pa
      WHERE pa.project_id = meeting_series.project_id
        AND pa.user_id = auth.uid()
        AND pa.role = ANY (
          ARRAY['owner'::public.share_role, 'admin'::public.share_role]
        )
    ))
  );

DROP POLICY IF EXISTS "Consultant and uploader can delete files"
ON public.files;

CREATE POLICY "Consultant and uploader can delete files"
ON public.files
FOR DELETE
USING (
  auth.uid() = uploaded_by
  OR EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = files.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (
        ARRAY['owner'::public.share_role, 'admin'::public.share_role]
      )
  )
);

COMMIT;
